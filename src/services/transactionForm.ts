import {
  Account,
  AppSettings,
  BudgetPeriod,
  Category,
  MovementType,
  RecurrenceFrequency,
  RecurringException,
  RecurringRule,
  Transaction,
  TransactionStatus,
} from '../types/finance';
import { getDefaultAccount, getEffectiveAmountInHaler } from './accountScope';
import { czechStringCompare } from './categoryService';
import { halerToInputValue, parseInputToHaler } from './currencyService';
import { getEffectiveTransactionsForPeriod } from './financialEngine';
import { formatCzechDate, getDefaultDateForPeriod, getPeriodForDate } from './periodService';
import { getNextSequenceForDate } from './sequenceService';
import { getStatusForDate } from './statusService';
import type { DayPlacement, RecurringMode } from './transactionCommands';

/**
 * Formulář položky (nová, úprava, duplikace) jako čistá data: výchozí hodnoty, přechody
 * při změně polí, nabídky, validace a akce k uložení. Modal jen drží stav a volá příkazy.
 */

export type TxField = 'title' | 'amount' | 'source' | 'target' | 'endDate';
export type TransactionFormErrors = Partial<Record<TxField, string>>;

export interface TransactionFormState {
  title: string;
  amountStr: string;
  date: string;
  sequenceStr: string;
  type: MovementType;
  sourceAccountId: string;
  targetAccountId: string;
  categoryId: string;
  subcategoryId: string;
  status: TransactionStatus;
  note: string;
  isRecurring: boolean;
  frequency: RecurrenceFrequency;
  dayOfMonth: number;
  recurringEndDate: string;
  /** Rozsah úpravy pravidelné položky (výskyt / tento a budoucí / celá série). */
  recurringEditMode: RecurringMode;
}

/** Data, ze kterých formulář počítá výchozí hodnoty, pořadí a nabídky. */
export interface TransactionFormData {
  transactions: Transaction[];
  recurringRules: RecurringRule[];
  recurringExceptions: RecurringException[];
  accounts: Account[];
  categories: Category[];
  settings: Pick<AppSettings, 'budgetStartDay'>;
  today: string;
}

export type TransactionFormMode =
  | { kind: 'new'; initialType: MovementType; initialDate?: string; period: BudgetPeriod }
  /** Nová položka předvyplněná podle existující; datum, pořadí a stav jako u nové položky. */
  | { kind: 'duplicate'; source: Transaction; initialDate?: string; period: BudgetPeriod }
  /** periodKey: období, ve kterém se položka upravuje (výjimka nebo štěpení pravidla). */
  | { kind: 'edit'; transaction: Transaction; periodKey: string };

type TransactionInput = Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>;

export type TransactionSaveAction =
  | { kind: 'addTransaction'; transaction: TransactionInput }
  | { kind: 'updateTransaction'; transaction: Transaction }
  | {
      kind: 'addRecurringRule';
      rule: Omit<RecurringRule, 'id' | 'createdAt' | 'updatedAt'>;
      initialSequence: number;
      initialStatus: TransactionStatus;
      existingTransactionId?: string;
    }
  | {
      kind: 'updateRecurringRule';
      ruleId: string;
      mode: Exclude<RecurringMode, 'occurrence'>;
      periodKey: string;
      overrideData: Partial<Transaction>;
      originalTransactionId: string;
      placement?: DayPlacement;
    };

// ------------------- Pomocné funkce -------------------

const isLinkedToRecurring = (mode: TransactionFormMode) => mode.kind === 'edit' && !!mode.transaction.recurringRuleId;

/** Den v měsíci z data YYYY-MM-DD, nebo NaN. */
const dayOfDate = (date: string) => parseInt(date.split('-')[2], 10);

const isValidDay = (day: number) => !isNaN(day) && day >= 1 && day <= 31;

const parseSequence = (sequenceStr: string) => Math.max(1, parseInt(sequenceStr, 10) || 1);

/**
 * Další volné pořadí v daném dni. Počítá i s ještě nezhmotněnými (virtuálními) výskyty
 * opakujících se položek, jinak by nová položka v budoucím dni, kde zatím existuje jen
 * virtuální výskyt, dostala pořadí 1 místo posledního místa v tom dni.
 */
function getNextFormSequence(date: string, data: TransactionFormData, excludeId?: string): number {
  const baseTxs = excludeId ? data.transactions.filter(t => t.id !== excludeId) : data.transactions;
  const effectiveTxs = getEffectiveTransactionsForPeriod(
    getPeriodForDate(date, data.settings.budgetStartDay),
    baseTxs,
    data.recurringRules,
    data.recurringExceptions,
    undefined,
    data.accounts
  );
  return getNextSequenceForDate(date, effectiveTxs);
}

/**
 * Údaje nové položky převzaté při duplikaci (datum, pořadí a stav se určí jako u nové položky).
 * Archivované účty a kategorie se v nové položce nenabízejí, proto se nepředvyplní.
 */
export function getDuplicateDraft(source: Transaction, accounts: Account[], categories: Category[]) {
  const isActiveAcc = (id?: string | null) => !!id && accounts.some(a => a.id === id && a.status === 'active');
  const isActiveCat = (id?: string | null) => !!id && categories.some(c => c.id === id && c.status === 'active');
  const haler = getEffectiveAmountInHaler(source);
  const categoryId = isActiveCat(source.categoryId) ? source.categoryId! : '';
  return {
    title: source.title,
    amountStr: halerToInputValue(haler),
    type: source.type,
    sourceAccountId: isActiveAcc(source.sourceAccountId) ? source.sourceAccountId : '',
    targetAccountId: isActiveAcc(source.targetAccountId) ? source.targetAccountId! : '',
    categoryId,
    subcategoryId: categoryId && isActiveCat(source.subcategoryId) ? source.subcategoryId! : '',
    note: source.note || '',
  };
}

// ------------------- Výchozí stav -------------------

/** Naplní formulář pro novou položku, úpravu nebo duplikaci. */
export function createFormState(mode: TransactionFormMode, data: TransactionFormData): TransactionFormState {
  const recurrenceDefaults = {
    isRecurring: false,
    frequency: 'monthly' as RecurrenceFrequency,
    recurringEndDate: '',
    recurringEditMode: 'occurrence' as RecurringMode,
  };

  if (mode.kind === 'edit') {
    const tx = mode.transaction;
    return {
      ...recurrenceDefaults,
      title: tx.title,
      amountStr: halerToInputValue(getEffectiveAmountInHaler(tx)),
      date: tx.date,
      sequenceStr: tx.sequence?.toString() || '1',
      type: tx.type,
      sourceAccountId: tx.sourceAccountId,
      targetAccountId: tx.targetAccountId || '',
      categoryId: tx.categoryId || '',
      subcategoryId: tx.subcategoryId || '',
      status: tx.status,
      note: tx.note || '',
      dayOfMonth: dayOfDate(tx.date) || 1,
    };
  }

  const date = mode.initialDate || getDefaultDateForPeriod(mode.period, data.today);
  const common = {
    ...recurrenceDefaults,
    date,
    sequenceStr: getNextFormSequence(date, data).toString(),
    status: getStatusForDate(date, data.today),
    dayOfMonth: dayOfDate(date) || 1,
  };

  if (mode.kind === 'duplicate') {
    return { ...common, ...getDuplicateDraft(mode.source, data.accounts, data.categories) };
  }

  // Výchozí účet se předvybere jen tehdy, když je k datu položky už aktivní
  const defaultAcc = getDefaultAccount(data.accounts);
  const isDefaultValid = defaultAcc && (!defaultAcc.initialBalanceDate || defaultAcc.initialBalanceDate <= date);
  return {
    ...common,
    title: '',
    amountStr: '',
    type: mode.initialType,
    sourceAccountId: isDefaultValid ? defaultAcc.id : '',
    targetAccountId: '',
    categoryId: '',
    subcategoryId: '',
    note: '',
  };
}

/** Shoda dvou stavů formuláře (rozepsaný formulář se před zavřením ptá). */
export function isSameForm(a: TransactionFormState, b: TransactionFormState): boolean {
  return (Object.keys(a) as (keyof TransactionFormState)[]).every(key => a[key] === b[key]);
}

// ------------------- Přechody polí -------------------

/**
 * Nové datum: den opakování (mimo pravidelné položky), pořadí na konci nového dne a u nové
 * položky stav podle data. Úprava vrácená na původní den si drží původní pořadí.
 * Účet se nemaže - neplatný účet k datu ohlásí getAccountActivationErrors.
 */
export function changeDate(
  form: TransactionFormState,
  date: string,
  mode: TransactionFormMode,
  data: TransactionFormData
): TransactionFormState {
  const next = { ...form, date };
  if (!isLinkedToRecurring(mode) && isValidDay(dayOfDate(date))) next.dayOfMonth = dayOfDate(date);
  if (mode.kind !== 'edit') {
    next.sequenceStr = getNextFormSequence(date, data).toString();
    next.status = getStatusForDate(date, data.today);
  } else if (date === mode.transaction.date) {
    next.sequenceStr = (mode.transaction.sequence || 1).toString();
  } else {
    next.sequenceStr = getNextFormSequence(date, data, mode.transaction.id).toString();
  }
  return next;
}

/** Nový typ: kategorie, která k typu nepatří nebo je archivovaná, se zruší i s podkategorií. */
export function changeType(form: TransactionFormState, type: MovementType, categories: Category[]): TransactionFormState {
  const selectedCat = categories.find(c => c.id === form.categoryId);
  const keepCategory = type !== 'transfer' && !!selectedCat && selectedCat.type === type && selectedCat.status !== 'archived';
  return keepCategory ? { ...form, type } : { ...form, type, categoryId: '', subcategoryId: '' };
}

/** Nová kategorie vždy zruší podkategorii. */
export function changeCategory(form: TransactionFormState, categoryId: string): TransactionFormState {
  return { ...form, categoryId, subcategoryId: '' };
}

/** Zapnutí opakování převezme den v měsíci z data položky. */
export function setRecurring(form: TransactionFormState, isRecurring: boolean): TransactionFormState {
  const day = dayOfDate(form.date);
  return isRecurring && isValidDay(day) ? { ...form, isRecurring, dayOfMonth: day } : { ...form, isRecurring };
}

/** „Uložit a další“: datum, typ, účet a kategorie zůstávají, vyplňuje se jen částka a název. */
export function resetForAnother(form: TransactionFormState): TransactionFormState {
  return { ...form, title: '', amountStr: '', note: '', sequenceStr: String(parseSequence(form.sequenceStr) + 1) };
}

// ------------------- Nabídky -------------------

/**
 * Účty a kategorie pro výběr seřazené A–Z. Nová položka nabízí jen aktivní; úprava navíc
 * ponechá právě vybrané (i archivované), aby se výběr neztratil.
 */
export function getFormOptions(
  form: TransactionFormState,
  mode: TransactionFormMode,
  data: Pick<TransactionFormData, 'accounts' | 'categories'>
) {
  const isEditing = mode.kind === 'edit';
  const offered = (status: string, isSelected: boolean) => status === 'active' || (isEditing && isSelected);
  const byName = (a: { name: string }, b: { name: string }) => czechStringCompare(a.name, b.name);

  return {
    accounts: data.accounts
      .filter(a => offered(a.status, a.id === form.sourceAccountId || a.id === form.targetAccountId))
      .sort(byName),
    categories: data.categories
      .filter(c => !c.parentId && form.type !== 'transfer' && c.type === form.type && offered(c.status, c.id === form.categoryId))
      .sort(byName),
    subcategories: data.categories
      .filter(c => c.parentId === form.categoryId && offered(c.status, c.id === form.subcategoryId))
      .sort(byName),
  };
}

// ------------------- Validace -------------------

/** Chyba účtu, který k datu položky ještě není aktivní (zdroj, u převodu i cíl). */
export function getAccountActivationErrors(
  form: TransactionFormState,
  accounts: Account[]
): { source: string | null; target: string | null } {
  const inactiveError = (accountId: string) => {
    const acc = accounts.find(a => a.id === accountId);
    return acc?.initialBalanceDate && form.date < acc.initialBalanceDate
      ? `Tento účet je aktivní až od ${formatCzechDate(acc.initialBalanceDate)}. Zvolte stejné nebo pozdější datum.`
      : null;
  };
  return {
    source: inactiveError(form.sourceAccountId),
    target: form.type === 'transfer' ? inactiveError(form.targetAccountId) : null,
  };
}

export function validateForm(
  form: TransactionFormState,
  mode: TransactionFormMode,
  accounts: Account[]
): TransactionFormErrors {
  const errors: TransactionFormErrors = {};
  const activation = getAccountActivationErrors(form, accounts);
  if (!form.title.trim()) errors.title = 'Zadejte prosím název položky.';
  if (parseInputToHaler(form.amountStr) <= 0) errors.amount = 'Zadejte částku větší než 0.';
  if (!form.sourceAccountId) errors.source = 'Vyberte prosím účet.';
  else if (activation.source) errors.source = activation.source;
  if (form.type === 'transfer') {
    if (!form.targetAccountId) errors.target = 'Pro převod vyberte cílový účet.';
    else if (form.sourceAccountId === form.targetAccountId) errors.target = 'Vyberte jiný účet, než ze kterého peníze odcházejí.';
    else if (activation.target) errors.target = activation.target;
  }
  if (form.isRecurring && !isLinkedToRecurring(mode) && form.recurringEndDate && form.recurringEndDate < form.date) {
    errors.endDate = 'Konec opakování musí být stejný den jako datum položky, nebo pozdější.';
  }
  return errors;
}

// ------------------- Uložení -------------------

/**
 * Akce, kterou formulář uloží (předpokládá platný formulář):
 * - nové opakování (i z existující běžné položky): addRecurringRule,
 * - výskyt pravidelné položky: zhmotnění virtuálního (addTransaction) nebo úprava reálného,
 * - tento a budoucí / celá série: updateRecurringRule, s pozicí v dni jen při změně pořadí nebo dne,
 * - jinak úprava nebo přidání běžné položky.
 * Provedená položka nese skutečnou částku, plánovaná ne, zrušená si drží původní.
 */
export function toSaveAction(form: TransactionFormState, mode: TransactionFormMode): TransactionSaveAction {
  const amountInHaler = parseInputToHaler(form.amountStr);
  const sequence = parseSequence(form.sequenceStr);
  const isTransfer = form.type === 'transfer';
  const fields = {
    title: form.title,
    amountInHaler,
    date: form.date,
    sequence,
    type: form.type,
    sourceAccountId: form.sourceAccountId,
    targetAccountId: isTransfer ? form.targetAccountId : undefined,
    categoryId: !isTransfer && form.categoryId ? form.categoryId : null,
    subcategoryId: !isTransfer && form.subcategoryId ? form.subcategoryId : null,
    status: form.status,
    note: form.note,
  };
  const executedAmount = form.status === 'executed' ? amountInHaler : undefined;
  const edited = mode.kind === 'edit' ? mode.transaction : undefined;
  const updated = (tx: Transaction): TransactionSaveAction => ({
    kind: 'updateTransaction',
    transaction: {
      ...tx,
      ...fields,
      actualAmountInHaler: form.status === 'planned' ? undefined : (executedAmount ?? tx.actualAmountInHaler),
    },
  });

  if (form.isRecurring && !isLinkedToRecurring(mode)) {
    const day = isValidDay(form.dayOfMonth) ? form.dayOfMonth : (dayOfDate(form.date) || 1);
    return {
      kind: 'addRecurringRule',
      rule: {
        title: form.title,
        amountInHaler,
        type: form.type,
        frequency: form.frequency,
        dayOfMonth: day,
        endDate: form.recurringEndDate || null,
        startDate: form.date,
        sourceAccountId: form.sourceAccountId,
        targetAccountId: fields.targetAccountId,
        categoryId: fields.categoryId,
        subcategoryId: fields.subcategoryId,
        note: form.note,
        isActive: true,
      },
      initialSequence: sequence,
      initialStatus: form.status,
      existingTransactionId: edited?.id,
    };
  }

  if (!edited || mode.kind !== 'edit') {
    return { kind: 'addTransaction', transaction: { ...fields, plannedAmountInHaler: amountInHaler, actualAmountInHaler: executedAmount } };
  }
  if (!edited.recurringRuleId) return updated(edited);

  if (form.recurringEditMode === 'occurrence') {
    if (!edited.id.startsWith('virtual_')) return updated(edited);
    return {
      kind: 'addTransaction',
      transaction: {
        ...fields,
        plannedAmountInHaler: edited.amountInHaler,
        actualAmountInHaler: executedAmount,
        recurringRuleId: edited.recurringRuleId,
      },
    };
  }

  const positionChanged = sequence !== (edited.sequence || 1) || form.date !== edited.date;
  return {
    kind: 'updateRecurringRule',
    ruleId: edited.recurringRuleId,
    mode: form.recurringEditMode,
    periodKey: mode.periodKey,
    overrideData: {
      title: form.title,
      amountInHaler,
      // U celé série se datum posílá jen při skutečné změně - jinak by se přesunutý
      // jednotlivý výskyt propsal jako nový den celé série.
      date: form.recurringEditMode === 'series' && form.date === edited.date ? undefined : form.date,
      sourceAccountId: form.sourceAccountId,
      targetAccountId: fields.targetAccountId,
      categoryId: fields.categoryId,
      subcategoryId: fields.subcategoryId,
      note: form.note,
    },
    originalTransactionId: edited.id,
    placement: positionChanged ? { date: form.date, position: sequence } : undefined,
  };
}
