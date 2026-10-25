import { BalanceCorrection, RecurringException, RecurringRule, Transaction, TransactionStatus } from '../types/finance';
import type { AppData } from './storageService';
import { generateOccurrenceForPeriod } from './financialEngine';
import { createBudgetPeriod, formatCzechDate, getDaysInMonth, getPeriodForDate, getPreviousDay } from './periodService';
import { autoExecuteDueTransactions, getStatusForDate } from './statusService';
import {
  applyRulePositions,
  deleteTransactionAndReorder,
  deleteTransactionsAndReorder,
  getNextSequenceForDate,
  insertOrUpdateWithSequence,
  reorderDayTransactions as reorderDaySequence,
} from './sequenceService';

/**
 * Příkazy nad daty položek a pravidelných plateb. Každý příkaz je čistá funkce:
 * dostane aktuální data a vrátí nová data a výsledek pro oznámení nebo „Vrátit“.
 * Když se nic nemění, vrací původní objekt dat.
 */

export interface CommandContext {
  nowIso: string;
  todayStr: string;
  newId: (prefix: string, suffix?: string) => string;
}

export interface CommandResult<O> {
  data: AppData;
  outcome: O;
}

export function createCommandContext(todayStr: string, now: Date = new Date()): CommandContext {
  return {
    nowIso: now.toISOString(),
    todayStr,
    newId: (prefix, suffix = '') => `${prefix}_${now.getTime()}_${Math.random().toString(36).substring(2, 7)}${suffix}`,
  };
}

export type RecurringMode = 'occurrence' | 'future' | 'series';

// ------------------- Pomocné funkce -------------------

/** Rozloží ID virtuálního výskytu (virtual_<ruleId>_<periodKey>); periodKey neobsahuje podtržítko. */
export function parseVirtualId(id: string): { ruleId: string; periodKey: string } | null {
  if (!id.startsWith('virtual_')) return null;
  const rest = id.slice('virtual_'.length);
  const cut = rest.lastIndexOf('_');
  return cut > 0 ? { ruleId: rest.slice(0, cut), periodKey: rest.slice(cut + 1) } : null;
}

/**
 * Zruší pevné pozice (overrideSequence) jednotlivých period u daných pravidel, aby pořadí
 * série platilo všude. Výjimky, které po tom nenesou žádnou jinou změnu, se odstraní.
 */
function clearSequenceOverrides(exceptions: RecurringException[], ruleIds: Set<string>, nowIso: string): RecurringException[] {
  return exceptions.flatMap(e => {
    if (!ruleIds.has(e.ruleId) || e.overrideSequence === undefined) return [e];
    const { overrideSequence: _removed, ...rest } = e;
    const carriesOtherChange = rest.isCancelled || rest.overrideDate !== undefined ||
      rest.overrideAmountInHaler !== undefined || rest.overrideSourceAccountId !== undefined ||
      rest.overrideTargetAccountId !== undefined || rest.overrideCategoryId !== undefined ||
      rest.overrideSubcategoryId !== undefined;
    return carriesOtherChange ? [{ ...rest, updatedAt: nowIso }] : [];
  });
}

/**
 * Pro každou opakující se položku dne: absolutní pozice ve dni (positions, pro jednu periodu)
 * a pořadí mezi opakovanými platbami (ranks, platné napříč obdobími). Klíčem je ID pravidla.
 */
function ruleOrderFromOrderedIds(
  orderedIds: string[],
  transactions: Transaction[],
  rules: RecurringRule[]
): { positions: Map<string, number>; ranks: Map<string, number> } {
  const positions = new Map<string, number>();
  const ranks = new Map<string, number>();
  orderedIds.forEach((id, idx) => {
    const ruleId = parseVirtualId(id)?.ruleId ?? transactions.find(t => t.id === id)?.recurringRuleId;
    if (ruleId && !positions.has(ruleId) && rules.some(r => r.id === ruleId)) {
      positions.set(ruleId, idx + 1);
      ranks.set(ruleId, ranks.size + 1);
    }
  });
  return { positions, ranks };
}

/** Spojí rank a pozici série podle ID pravidla (vstup pro applyRulePositions). */
function toRuleOrder(
  ranks: Map<string, number>,
  positions: Map<string, number>
): Map<string, { position: number; rank: number }> {
  const order = new Map<string, { position: number; rank: number }>();
  ranks.forEach((rank, ruleId) => order.set(ruleId, { rank, position: positions.get(ruleId) ?? rank }));
  return order;
}

/** Zapíše požadovanou pozici do výjimek dané periody (vytvoří je, pokud chybí). */
export function withSequenceExceptions(
  exceptions: RecurringException[],
  positions: Map<string, number>,
  periodKey: string,
  ctx: CommandContext
): RecurringException[] {
  const { nowIso } = ctx;
  let result = exceptions;
  positions.forEach((seq, ruleId) => {
    const idx = result.findIndex(e => e.ruleId === ruleId && e.periodKey === periodKey);
    result = idx >= 0
      ? result.map((e, i) => i === idx ? { ...e, overrideSequence: seq, updatedAt: nowIso } : e)
      : [...result, { id: ctx.newId('ex', `_${ruleId}`), ruleId, periodKey, overrideSequence: seq, createdAt: nowIso, updatedAt: nowIso }];
  });
  return result;
}

/**
 * Rozštěpí opakující se pravidlo na "starou" větev (končící den před effectiveDate)
 * a novou větev od effectiveDate dál, a přepojí na ni už materializované budoucí
 * transakce a výjimky. Sdíleno mezi editací obsahu (updateRecurringRule, mode 'future')
 * a přeuspořádáním pořadí (reorderRecurringItem, mode 'future').
 */
function splitRecurringRuleForFuture(
  rule: RecurringRule,
  effectiveDate: string,
  overrideData: Partial<Transaction>,
  originalTransactionId: string | undefined,
  prevTransactions: Transaction[],
  prevExceptions: RecurringException[],
  budgetStartDay: number,
  nowIso: string,
  newRuleId: string
): {
  updatedOldRule: RecurringRule;
  newFutureRule: RecurringRule;
  updatedTransactions: Transaction[];
  updatedExceptions: RecurringException[];
} {
  const cutOffDate = getPreviousDay(effectiveDate);
  const willBeActive = cutOffDate >= rule.startDate;

  const updatedOldRule: RecurringRule = {
    ...rule,
    endDate: cutOffDate,
    isActive: willBeActive ? rule.isActive : false,
    updatedAt: nowIso
  };

  const newDayOfMonth = parseInt(effectiveDate.split('-')[2], 10) || rule.dayOfMonth;
  const newFutureRule: RecurringRule = {
    ...rule,
    id: newRuleId,
    title: overrideData.title || rule.title,
    amountInHaler: overrideData.amountInHaler !== undefined ? overrideData.amountInHaler : rule.amountInHaler,
    dayOfMonth: newDayOfMonth,
    startDate: effectiveDate,
    sourceAccountId: overrideData.sourceAccountId || rule.sourceAccountId,
    targetAccountId: overrideData.targetAccountId || rule.targetAccountId,
    categoryId: overrideData.categoryId || rule.categoryId,
    subcategoryId: overrideData.subcategoryId || rule.subcategoryId,
    note: overrideData.note !== undefined ? overrideData.note : rule.note,
    updatedAt: nowIso,
    createdAt: nowIso
  };

  // Přepsat již materializované reálné transakce od editovaného výskytu dále,
  // ať se změna projeví okamžitě i u položek, které už nejsou pouze virtuální.
  const updatedTransactions = prevTransactions.map(t => {
    if (t.recurringRuleId !== rule.id || t.date < effectiveDate) return t;
    const isEditedOccurrence = originalTransactionId
      ? t.id === originalTransactionId
      : t.date === effectiveDate;
    return {
      ...t,
      recurringRuleId: newFutureRule.id,
      title: newFutureRule.title,
      amountInHaler: newFutureRule.amountInHaler,
      actualAmountInHaler: t.status === 'executed' ? newFutureRule.amountInHaler : t.actualAmountInHaler,
      sourceAccountId: newFutureRule.sourceAccountId,
      targetAccountId: newFutureRule.targetAccountId,
      categoryId: newFutureRule.categoryId,
      subcategoryId: newFutureRule.subcategoryId,
      note: newFutureRule.note,
      date: isEditedOccurrence ? effectiveDate : t.date,
      updatedAt: nowIso,
    };
  });

  // Výjimky pro periody od rozštěpení dál patří nově pod nové pravidlo -
  // jinak by se hledaly pod starým (už useknutým) ruleId a nikdy by se nenašly.
  const cutoffPeriodKey = getPeriodForDate(effectiveDate, budgetStartDay).key;
  const updatedExceptions = prevExceptions.map(e =>
    e.ruleId === rule.id && e.periodKey >= cutoffPeriodKey
      ? { ...e, ruleId: newFutureRule.id }
      : e
  );

  return { updatedOldRule, newFutureRule, updatedTransactions, updatedExceptions };
}

function periodFromKey(periodKey: string, budgetStartDay: number) {
  const [yStr, mStr] = periodKey.split('-');
  return createBudgetPeriod(parseInt(yStr, 10), parseInt(mStr, 10), budgetStartDay);
}

// ------------------- Položky -------------------

export type DeleteTransactionOutcome =
  | { kind: 'none' }
  | { kind: 'plain'; transaction: Transaction; correction?: BalanceCorrection }
  | { kind: 'recurring'; mode: RecurringMode; ruleTitle?: string };

/**
 * Smaže položku. Běžná položka zmizí (i s případnou korekcí stejného ID). U pravidelné:
 * - occurrence: zrušená výjimka pro dané období,
 * - future: pravidlo skončí den před výskytem; zůstane-li v sérii nejvýše jedna položka,
 *   převede se na běžnou a pravidlo zmizí,
 * - series: pravidlo i jeho výjimky zmizí.
 * Provedené položky série zůstávají, pokud není deleteHistoricalExecuted.
 */
export function deleteTransaction(
  data: AppData,
  input: { id: string; mode: RecurringMode; deleteHistoricalExecuted: boolean },
  ctx: CommandContext
): CommandResult<DeleteTransactionOutcome> {
  const { id, mode, deleteHistoricalExecuted } = input;
  const none = { data, outcome: { kind: 'none' as const } };
  const isVirtual = id.startsWith('virtual_');
  let ruleId: string | undefined;
  let periodKey: string | undefined;
  let txDate: string | undefined;

  if (isVirtual) {
    const parsed = parseVirtualId(id);
    ruleId = parsed?.ruleId;
    periodKey = parsed?.periodKey;
  } else {
    const realTx = data.transactions.find(t => t.id === id);
    if (!realTx) return none;
    txDate = realTx.date;
    ruleId = realTx.recurringRuleId;
    periodKey = getPeriodForDate(realTx.date, data.settings.budgetStartDay).key;
  }

  const rule = ruleId ? data.recurringRules.find(r => r.id === ruleId) : undefined;

  // 1. BĚŽNÁ POLOŽKA (příjem, výdaj, převod) nebo položka bez aktivního pravidla
  if (!rule) {
    if (isVirtual) return none;
    return {
      data: {
        ...data,
        transactions: deleteTransactionAndReorder(id, data.transactions),
        corrections: data.corrections.filter(c => c.id !== id),
      },
      outcome: {
        kind: 'plain',
        transaction: data.transactions.find(t => t.id === id)!,
        correction: data.corrections.find(c => c.id === id),
      },
    };
  }

  const recurring = { kind: 'recurring' as const, mode, ruleTitle: rule.title };

  // 2A: POUZE TATO POLOŽKA (výjimka v sérii)
  if (mode === 'occurrence') {
    const targetPeriodKey = periodKey!;
    const existingExIndex = data.recurringExceptions.findIndex(
      e => e.ruleId === rule.id && e.periodKey === targetPeriodKey
    );
    const cancelledEx: RecurringException = {
      id: existingExIndex >= 0 ? data.recurringExceptions[existingExIndex].id : ctx.newId('ex'),
      ruleId: rule.id,
      periodKey: targetPeriodKey,
      isCancelled: true,
      createdAt: ctx.nowIso
    };
    return {
      data: {
        ...data,
        recurringExceptions: existingExIndex >= 0
          ? data.recurringExceptions.map((item, idx) => idx === existingExIndex ? cancelledEx : item)
          : [...data.recurringExceptions, cancelledEx],
        transactions: isVirtual ? data.transactions : deleteTransactionAndReorder(id, data.transactions),
      },
      outcome: recurring,
    };
  }

  // Ruční položky série, které se mažou: neprovedené (nebo všechny s deleteHistoricalExecuted)
  const idsToDelete = (from?: string) => {
    const ids = new Set<string>();
    for (const t of data.transactions) {
      if (t.recurringRuleId !== rule.id || (from && t.date < from)) continue;
      if (deleteHistoricalExecuted || t.status !== 'executed') ids.add(t.id);
    }
    if (!isVirtual) ids.add(id);
    return ids;
  };

  // 2B: TATO A VŠECHNY BUDOUCÍ POLOŽKY (ukončení pravidla)
  if (mode === 'future') {
    let occDate = txDate;
    if (!occDate && isVirtual && periodKey) {
      const period = periodFromKey(periodKey, data.settings.budgetStartDay);
      const occ = generateOccurrenceForPeriod(rule, period, data.recurringExceptions);
      occDate = occ?.date || period.startDate;
    }
    if (!occDate) occDate = ctx.nowIso.slice(0, 10);

    const cutOffDate = getPreviousDay(occDate);
    let updatedTxs = deleteTransactionsAndReorder(idsToDelete(occDate), data.transactions);

    // Pokud po smazání budoucích výskytů zůstává v sérii nejvýše jedna položka,
    // pravidlo už nemá smysl udržovat jako opakující se - převést zbylou položku
    // na běžnou (nepravidelnou) a pravidlo odstranit.
    if (updatedTxs.filter(t => t.recurringRuleId === rule.id).length <= 1) {
      updatedTxs = updatedTxs.map(t =>
        t.recurringRuleId === rule.id
          ? { ...t, recurringRuleId: undefined, isException: false, updatedAt: ctx.nowIso }
          : t
      );
      return {
        data: {
          ...data,
          recurringRules: data.recurringRules.filter(r => r.id !== rule.id),
          recurringExceptions: data.recurringExceptions.filter(e => e.ruleId !== rule.id),
          transactions: updatedTxs,
        },
        outcome: recurring,
      };
    }

    return {
      data: {
        ...data,
        recurringRules: data.recurringRules.map(r => r.id !== rule.id ? r : {
          ...r,
          endDate: cutOffDate,
          isActive: cutOffDate >= r.startDate ? r.isActive : false,
          updatedAt: ctx.nowIso
        }),
        transactions: updatedTxs,
      },
      outcome: recurring,
    };
  }

  // 2C: CELÁ SÉRIE (smazání pravidla a všech neuskutečněných výskytů)
  return {
    data: {
      ...data,
      recurringRules: data.recurringRules.filter(r => r.id !== rule.id),
      recurringExceptions: data.recurringExceptions.filter(e => e.ruleId !== rule.id),
      transactions: deleteTransactionsAndReorder(idsToDelete(), data.transactions),
    },
    outcome: recurring,
  };
}

/**
 * „Vrátit“ po smazání běžné položky: vrátí ji na původní místo v dni. Nové updatedAt je
 * pozdější než záznam o smazání, takže synchronizace položku zase přijme. Opakované
 * vrácení nic nezdvojí.
 */
export function restoreDeletedTransaction(
  data: AppData,
  input: { transaction: Transaction; correction?: BalanceCorrection },
  ctx: CommandContext
): CommandResult<{ restored: boolean }> {
  const { transaction: tx, correction } = input;
  if (data.transactions.some(t => t.id === tx.id)) return { data, outcome: { restored: false } };
  return {
    data: {
      ...data,
      transactions: insertOrUpdateWithSequence({ ...tx, updatedAt: ctx.nowIso }, tx.sequence ?? 1, data.transactions),
      corrections: correction && !data.corrections.some(c => c.id === correction.id)
        ? [...data.corrections, { ...correction, updatedAt: ctx.nowIso }]
        : data.corrections,
    },
    outcome: { restored: true },
  };
}

/** Chybová hláška, když zdrojový nebo (u převodu) cílový účet k datu položky ještě není aktivní. */
function inactiveAccountError(
  data: AppData,
  tx: Pick<Transaction, 'date' | 'type' | 'sourceAccountId' | 'targetAccountId'>
): string | undefined {
  const inactiveFrom = (accountId?: string) => {
    const acc = data.accounts.find(a => a.id === accountId);
    return acc?.initialBalanceDate && tx.date < acc.initialBalanceDate ? acc.initialBalanceDate : undefined;
  };
  const inactiveDate = inactiveFrom(tx.sourceAccountId)
    ?? (tx.type === 'transfer' && tx.targetAccountId ? inactiveFrom(tx.targetAccountId) : undefined);
  return inactiveDate
    ? `Tento účet je aktivní až od ${formatCzechDate(inactiveDate)}. Zvolte stejné nebo pozdější datum.`
    : undefined;
}

/**
 * Přidá běžnou položku. Bez zadaného pořadí dostane místo na konci dne; bez stavu
 * se stav určí podle data. Provedená položka nese skutečnou částku.
 */
export function addTransaction(
  data: AppData,
  txData: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>,
  ctx: CommandContext
): CommandResult<{ transaction: Transaction; sequence: number } | { error: string }> {
  const error = inactiveAccountError(data, txData);
  if (error) return { data, outcome: { error } };

  const sequence = txData.sequence && txData.sequence > 0
    ? txData.sequence
    : getNextSequenceForDate(txData.date, data.transactions);
  const status = txData.status || getStatusForDate(txData.date, ctx.todayStr);
  const actualAmountInHaler = status === 'executed'
    ? (txData.actualAmountInHaler !== undefined ? txData.actualAmountInHaler : (txData.plannedAmountInHaler ?? txData.amountInHaler))
    : undefined;

  const transaction: Transaction = {
    ...txData,
    sequence,
    status,
    actualAmountInHaler,
    id: ctx.newId('tx'),
    createdAt: ctx.nowIso,
    updatedAt: ctx.nowIso,
  };

  return {
    data: { ...data, transactions: insertOrUpdateWithSequence(transaction, sequence, data.transactions) },
    outcome: { transaction, sequence },
  };
}

/**
 * Upraví položku. Virtuální výskyt se zhmotní jako reálná položka a výjimka jeho období
 * se odstraní. Při změně data bez jiného zadaného pořadí jde položka na konec nového dne.
 */
export function updateTransaction(
  data: AppData,
  updatedTx: Transaction,
  ctx: CommandContext
): CommandResult<{ title: string } | { error: string }> {
  const error = inactiveAccountError(data, updatedTx);
  if (error) return { data, outcome: { error } };

  if (updatedTx.id.startsWith('virtual_')) {
    const parsed = parseVirtualId(updatedTx.id);
    const ruleId = parsed?.ruleId || updatedTx.recurringRuleId;
    const periodKey = parsed?.periodKey ?? '';
    const assignedSeq = updatedTx.sequence || getNextSequenceForDate(updatedTx.date, data.transactions);
    const realTx: Transaction = {
      ...updatedTx,
      id: ctx.newId('tx_real'),
      recurringRuleId: ruleId,
      sequence: assignedSeq,
      createdAt: ctx.nowIso,
      updatedAt: ctx.nowIso,
    };
    return {
      data: {
        ...data,
        recurringExceptions: data.recurringExceptions.filter(e => !(e.ruleId === ruleId && e.periodKey === periodKey)),
        transactions: insertOrUpdateWithSequence(realTx, assignedSeq, data.transactions),
      },
      outcome: { title: updatedTx.title },
    };
  }

  const oldTx = data.transactions.find(t => t.id === updatedTx.id);
  let targetSeq = updatedTx.sequence;
  if (oldTx && oldTx.date !== updatedTx.date && (!updatedTx.sequence || updatedTx.sequence === oldTx.sequence)) {
    targetSeq = getNextSequenceForDate(updatedTx.date, data.transactions.filter(t => t.id !== updatedTx.id));
  }

  return {
    data: {
      ...data,
      transactions: insertOrUpdateWithSequence(
        { ...updatedTx, sequence: targetSeq, updatedAt: ctx.nowIso },
        targetSeq,
        data.transactions,
        oldTx?.date
      ),
    },
    outcome: { title: updatedTx.title },
  };
}

/**
 * Uloží pořadí položek dne. Virtuální (ještě nezhmotněné) opakované výskyty si pozici
 * pamatují přes výjimku periody, jinak by se při dalším výpočtu vrátily na konec dne.
 */
export function reorderDayTransactions(
  data: AppData,
  input: { date: string; orderedIds: string[] },
  ctx: CommandContext
): CommandResult<null> {
  const { date, orderedIds } = input;
  const virtualPositions = new Map<string, number>();
  orderedIds.forEach((id, idx) => {
    const ruleId = parseVirtualId(id)?.ruleId;
    if (ruleId && data.recurringRules.some(r => r.id === ruleId)) virtualPositions.set(ruleId, idx + 1);
  });
  return {
    data: {
      ...data,
      transactions: reorderDaySequence(date, orderedIds, data.transactions),
      recurringExceptions: virtualPositions.size > 0
        ? withSequenceExceptions(
            data.recurringExceptions,
            virtualPositions,
            getPeriodForDate(date, data.settings.budgetStartDay).key,
            ctx
          )
        : data.recurringExceptions,
    },
    outcome: null,
  };
}

/** Označí splatné plánované položky a výskyty k ctx.todayStr jako provedené. */
export function autoExecute(data: AppData, ctx: CommandContext): CommandResult<{ executedCount: number }> {
  const { transactions, hasChanges, executedCount } = autoExecuteDueTransactions(
    data.transactions,
    data.recurringRules,
    data.recurringExceptions,
    data.settings.budgetStartDay,
    ctx.todayStr
  );
  return { data: hasChanges ? { ...data, transactions } : data, outcome: { executedCount } };
}

export interface StatusUpdates {
  actualAmountInHaler?: number;
  date?: string;
  sourceAccountId?: string;
  categoryId?: string;
}

/**
 * Změní stav položky. Virtuální výskyt se zhmotní jako reálná položka (s pořadím na konci
 * dne) a výjimka jeho období se odstraní. Provedená položka nese skutečnou částku,
 * plánovaná ji ztrácí.
 */
export function setTransactionStatus(
  data: AppData,
  input: { id: string; status: TransactionStatus; updates?: StatusUpdates },
  ctx: CommandContext
): CommandResult<{ title: string } | null> {
  const { id, status: newStatus, updates } = input;

  if (id.startsWith('virtual_')) {
    const parsed = parseVirtualId(id);
    if (!parsed) return { data, outcome: null };
    const { ruleId, periodKey } = parsed;
    const rule = data.recurringRules.find(r => r.id === ruleId);
    if (!rule) return { data, outcome: null };

    const period = periodFromKey(periodKey, data.settings.budgetStartDay);
    const occurrence = generateOccurrenceForPeriod(rule, period, data.recurringExceptions);

    const effectiveDate = updates?.date || occurrence?.date || ctx.todayStr;
    const baseAmount = occurrence?.amountInHaler ?? rule.amountInHaler;
    const effectiveActualAmount = newStatus === 'executed'
      ? (updates?.actualAmountInHaler !== undefined ? updates.actualAmountInHaler : (occurrence?.actualAmountInHaler || baseAmount))
      : undefined;

    const assignedSeq = getNextSequenceForDate(effectiveDate, data.transactions);

    const realTx: Transaction = {
      id: ctx.newId('tx_real'),
      title: rule.title,
      amountInHaler: baseAmount,
      plannedAmountInHaler: baseAmount,
      actualAmountInHaler: effectiveActualAmount,
      date: effectiveDate,
      sequence: assignedSeq,
      type: rule.type,
      sourceAccountId: updates?.sourceAccountId || occurrence?.sourceAccountId || rule.sourceAccountId,
      targetAccountId: occurrence?.targetAccountId || rule.targetAccountId,
      categoryId: updates?.categoryId || occurrence?.categoryId || rule.categoryId,
      subcategoryId: occurrence?.subcategoryId || rule.subcategoryId,
      status: newStatus,
      recurringRuleId: rule.id,
      note: rule.note,
      createdAt: ctx.nowIso,
      updatedAt: ctx.nowIso,
    };

    return {
      data: {
        ...data,
        recurringExceptions: data.recurringExceptions.filter(e => !(e.ruleId === ruleId && e.periodKey === periodKey)),
        transactions: insertOrUpdateWithSequence(realTx, assignedSeq, data.transactions)
      },
      outcome: { title: rule.title },
    };
  }

  const tx = data.transactions.find(t => t.id === id);
  if (!tx) return { data, outcome: null };

  let effectiveActualAmount = tx.actualAmountInHaler;
  if (newStatus === 'executed') {
    effectiveActualAmount = updates?.actualAmountInHaler !== undefined
      ? updates.actualAmountInHaler
      : (tx.actualAmountInHaler || tx.amountInHaler);
  } else if (newStatus === 'planned') {
    effectiveActualAmount = undefined;
  }

  const updated: Transaction = {
    ...tx,
    status: newStatus,
    actualAmountInHaler: effectiveActualAmount,
    date: updates?.date || tx.date,
    sourceAccountId: updates?.sourceAccountId || tx.sourceAccountId,
    categoryId: updates?.categoryId || tx.categoryId,
    updatedAt: ctx.nowIso
  };

  return {
    data: { ...data, transactions: data.transactions.map(t => t.id === id ? updated : t) },
    outcome: { title: tx.title },
  };
}

// ------------------- Pravidelné platby -------------------

export type AddRecurringRuleOutcome =
  | { rule: RecurringRule }
  | { error: string; kind: 'inactiveAccount' | 'invalidSource' };

/**
 * Vytvoří pravidlo a jeho první výskyt k datu začátku. S existingTransactionId převezme
 * existující běžnou položku jako první výskyt. Účet musí být k datu začátku aktivní.
 */
export function addRecurringRule(
  data: AppData,
  input: {
    ruleData: Omit<RecurringRule, 'id' | 'createdAt' | 'updatedAt'>;
    initialSequence?: number;
    initialStatus?: TransactionStatus;
    existingTransactionId?: string;
  },
  ctx: CommandContext
): CommandResult<AddRecurringRuleOutcome> {
  const { ruleData, initialSequence, initialStatus, existingTransactionId } = input;

  const inactiveFrom = (accountId?: string) => {
    const acc = accountId ? data.accounts.find(a => a.id === accountId) : undefined;
    return acc?.initialBalanceDate && ruleData.startDate < acc.initialBalanceDate ? acc.initialBalanceDate : undefined;
  };
  const inactiveDate = inactiveFrom(ruleData.sourceAccountId)
    ?? (ruleData.type === 'transfer' ? inactiveFrom(ruleData.targetAccountId) : undefined);
  if (inactiveDate) {
    return {
      data,
      outcome: {
        kind: 'inactiveAccount',
        error: `Tento účet je aktivní až od ${formatCzechDate(inactiveDate)}. Zvolte stejné nebo pozdější datum.`,
      },
    };
  }

  const existingTx = existingTransactionId
    ? data.transactions.find(t => t.id === existingTransactionId)
    : undefined;
  if (existingTransactionId && (!existingTx || existingTx.recurringRuleId)) {
    return { data, outcome: { kind: 'invalidSource', error: 'Položka již patří do pravidelné série nebo neexistuje.' } };
  }

  const newRule: RecurringRule = {
    ...ruleData,
    id: ctx.newId('rec'),
    createdAt: ctx.nowIso,
    updatedAt: ctx.nowIso,
  };
  const effectiveStatus: TransactionStatus = initialStatus || getStatusForDate(newRule.startDate, ctx.todayStr);

  const targetSeq = initialSequence && initialSequence > 0
    ? Math.round(initialSequence)
    : getNextSequenceForDate(newRule.startDate, data.transactions);

  const firstOccurrenceTx: Transaction = {
    ...existingTx,
    id: existingTx?.id || ctx.newId('tx'),
    title: newRule.title,
    amountInHaler: newRule.amountInHaler,
    plannedAmountInHaler: existingTx ? existingTx.plannedAmountInHaler : newRule.amountInHaler,
    actualAmountInHaler: effectiveStatus === 'executed' ? newRule.amountInHaler : (effectiveStatus === 'planned' ? undefined : existingTx?.actualAmountInHaler),
    date: newRule.startDate,
    sequence: targetSeq,
    type: newRule.type,
    sourceAccountId: newRule.sourceAccountId,
    targetAccountId: newRule.targetAccountId,
    categoryId: newRule.categoryId,
    subcategoryId: newRule.subcategoryId,
    status: effectiveStatus,
    recurringRuleId: newRule.id,
    note: newRule.note,
    createdAt: existingTx?.createdAt || ctx.nowIso,
    updatedAt: ctx.nowIso,
  };

  return {
    data: {
      ...data,
      recurringRules: [...data.recurringRules, newRule],
      transactions: insertOrUpdateWithSequence(firstOccurrenceTx, targetSeq, data.transactions, existingTx?.date),
    },
    outcome: { rule: newRule },
  };
}

/**
 * Upraví pravidelnou platbu:
 * - occurrence: výjimka jen pro dané období,
 * - future: pravidlo se rozštěpí k datu výskytu a nová větev nese změny (její ID vrací outcome),
 * - series: změna celé série včetně už zhmotněných výskytů; změna dne v měsíci posune
 *   i začátek pravidla a přečísluje přesunuté výskyty.
 */
export function updateRecurringRule(
  data: AppData,
  input: {
    ruleId: string;
    mode: RecurringMode;
    periodKey: string;
    overrideData: Partial<Transaction>;
    originalTransactionId?: string;
    /** ID nové větve v režimu future; volající ho zná předem (např. pro následné pořadí). */
    futureRuleId?: string;
  },
  ctx: CommandContext
): CommandResult<{ ruleTitle?: string }> {
  const { ruleId, mode, periodKey, overrideData, originalTransactionId } = input;
  const rule = data.recurringRules.find(r => r.id === ruleId);
  const outcome = { ruleTitle: overrideData.title ?? rule?.title };
  if (!rule) return { data, outcome };

  if (mode === 'occurrence') {
    const existingExIndex = data.recurringExceptions.findIndex(e => e.ruleId === ruleId && e.periodKey === periodKey);
    const ex: RecurringException = {
      id: existingExIndex >= 0 ? data.recurringExceptions[existingExIndex].id : ctx.newId('ex'),
      ruleId,
      periodKey,
      overrideAmountInHaler: overrideData.amountInHaler,
      overrideDate: overrideData.date,
      overrideSourceAccountId: overrideData.sourceAccountId,
      overrideTargetAccountId: overrideData.targetAccountId,
      overrideCategoryId: overrideData.categoryId,
      overrideSubcategoryId: overrideData.subcategoryId,
      createdAt: ctx.nowIso
    };
    return {
      data: {
        ...data,
        recurringExceptions: existingExIndex >= 0
          ? data.recurringExceptions.map((item, idx) => idx === existingExIndex ? ex : item)
          : [...data.recurringExceptions, ex],
      },
      outcome,
    };
  }

  const nowIso = ctx.nowIso;

  if (mode === 'future') {
    const originalTx = originalTransactionId
      ? data.transactions.find(t => t.id === originalTransactionId)
      : undefined;
    const effectiveDate = overrideData.date || originalTx?.date || periodKey + '-15';
    const { updatedOldRule, newFutureRule, updatedTransactions, updatedExceptions } = splitRecurringRuleForFuture(
      rule,
      effectiveDate,
      overrideData,
      originalTransactionId,
      data.transactions,
      data.recurringExceptions,
      data.settings.budgetStartDay,
      nowIso,
      input.futureRuleId ?? ctx.newId('rec', '_split')
    );
    return {
      data: {
        ...data,
        recurringRules: [...data.recurringRules.map(r => r.id === ruleId ? updatedOldRule : r), newFutureRule],
        recurringExceptions: updatedExceptions,
        transactions: updatedTransactions,
      },
      outcome,
    };
  }

  // Změna data u celé série = nový den v měsíci pro všechny výskyty. Začátek pravidla
  // se posune na nový den ve stejném měsíci, aby první výskyt nevypadl (occDate < startDate).
  const newDay = overrideData.date ? parseInt(overrideData.date.split('-')[2], 10) : NaN;
  const dayChanged = !isNaN(newDay) && newDay >= 1 && newDay <= 31;
  const withDay = (dateStr: string): string => {
    const [y, m] = dateStr.split('-').map(Number);
    const day = Math.min(newDay, getDaysInMonth(y, m));
    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const updatedSeries: RecurringRule = {
    ...rule,
    dayOfMonth: dayChanged ? newDay : rule.dayOfMonth,
    startDate: dayChanged ? withDay(rule.startDate) : rule.startDate,
    title: overrideData.title || rule.title,
    amountInHaler: overrideData.amountInHaler !== undefined ? overrideData.amountInHaler : rule.amountInHaler,
    sourceAccountId: overrideData.sourceAccountId || rule.sourceAccountId,
    targetAccountId: overrideData.targetAccountId || rule.targetAccountId,
    categoryId: overrideData.categoryId || rule.categoryId,
    subcategoryId: overrideData.subcategoryId || rule.subcategoryId,
    note: overrideData.note !== undefined ? overrideData.note : rule.note,
    updatedAt: nowIso
  };

  // "Včetně minulých" - promítnout změnu i do už materializovaných transakcí série.
  let updatedTxs = data.transactions.map(t => {
    if (t.recurringRuleId !== ruleId) return t;
    return {
      ...t,
      title: updatedSeries.title,
      amountInHaler: updatedSeries.amountInHaler,
      actualAmountInHaler: t.status === 'executed' ? updatedSeries.amountInHaler : t.actualAmountInHaler,
      sourceAccountId: updatedSeries.sourceAccountId,
      targetAccountId: updatedSeries.targetAccountId,
      categoryId: updatedSeries.categoryId,
      subcategoryId: updatedSeries.subcategoryId,
      note: updatedSeries.note,
      date: !dayChanged ? t.date : (t.id === originalTransactionId ? overrideData.date! : withDay(t.date)),
      updatedAt: nowIso,
    };
  });

  // Přesunuté výskyty dostanou pořadí v novém dni (na jeho konec) a ve starém dni
  // se zbylé položky přečíslují - jinak by si nesly původní pořadí (např. #13 v prázdném dni).
  if (dayChanged) {
    for (const oldTx of data.transactions) {
      if (oldTx.recurringRuleId !== ruleId) continue;
      const moved = updatedTxs.find(t => t.id === oldTx.id);
      if (!moved || moved.date === oldTx.date) continue;
      const seq = getNextSequenceForDate(moved.date, updatedTxs.filter(t => t.id !== moved.id));
      updatedTxs = insertOrUpdateWithSequence(moved, seq, updatedTxs, oldTx.date);
    }
    if (updatedSeries.orderPosition !== undefined) {
      updatedTxs = applyRulePositions(updatedTxs, new Map([[ruleId, {
        position: updatedSeries.orderPosition,
        rank: updatedSeries.orderRank ?? updatedSeries.orderPosition,
      }]]));
    }
  }

  return {
    data: {
      ...data,
      recurringRules: data.recurringRules.map(r => r.id === ruleId ? updatedSeries : r),
      transactions: updatedTxs,
    },
    outcome,
  };
}

/**
 * Uloží nové pořadí opakující se položky v daném dni:
 * - occurrence: pevná pozice jen pro dané období,
 * - future: pravidla dne se od tohoto dne rozštěpí a nové větve nesou pořadí,
 * - series: pořadí se uloží do pravidel a propíše do všech zhmotněných výskytů.
 */
export function reorderRecurringItem(
  data: AppData,
  input: {
    ruleId: string;
    mode: RecurringMode;
    date: string;
    periodKey: string;
    orderedIds: string[];
    movedTransactionId: string;
  },
  ctx: CommandContext
): CommandResult<{ reordered: boolean }> {
  const { ruleId, mode, date, periodKey, orderedIds, movedTransactionId } = input;
  const rule = data.recurringRules.find(r => r.id === ruleId);
  if (!rule) return { data, outcome: { reordered: false } };

  const nowIso = ctx.nowIso;

  // Pozice VŠECH opakujících se položek toho dne (ne jen přetažené). Kdyby měla pozici jen
  // přetažená, při posunu dolů pod jinou opakovanou platbu by se její index zkrátil na
  // začátek dne a původní pořadí by se vrátilo.
  const { positions, ranks } = ruleOrderFromOrderedIds(orderedIds, data.transactions, data.recurringRules);
  if (!ranks.has(ruleId)) {
    positions.set(ruleId, Math.max(1, orderedIds.indexOf(movedTransactionId) + 1));
    ranks.set(ruleId, ranks.size + 1);
  }
  const involvedRuleIds = Array.from(ranks.keys());

  // Zhmotněné (reálné) transakce toho dne se přeuspořádají i fyzicky - hinty ovlivňují
  // jen generování virtuálních výskytů.
  const reorderRealToday = (txs: Transaction[]) => reorderDaySequence(date, orderedIds, txs);

  if (mode === 'occurrence') {
    return {
      data: {
        ...data,
        recurringExceptions: withSequenceExceptions(data.recurringExceptions, positions, periodKey, ctx),
        transactions: reorderRealToday(data.transactions),
      },
      outcome: { reordered: true },
    };
  }

  if (mode === 'future') {
    let rules = data.recurringRules;
    let txs = data.transactions;
    let exceptions = data.recurringExceptions;
    const newRanks = new Map<string, number>();
    const newPositions = new Map<string, number>();
    involvedRuleIds.forEach((rid, i) => {
      const current = rules.find(r => r.id === rid);
      if (!current) return;
      // Pravidlo, které začíná až tímto dnem (např. právě odštěpená větev), nemá žádnou
      // minulost k zachování - pořadí se nastaví přímo, bez dalšího štěpení.
      if (current.startDate >= date) {
        rules = rules.map(r => r.id === rid
          ? { ...r, orderRank: ranks.get(rid), orderPosition: positions.get(rid), orderRankUpdatedAt: nowIso, updatedAt: nowIso }
          : r);
        newRanks.set(rid, ranks.get(rid) as number);
        if (positions.has(rid)) newPositions.set(rid, positions.get(rid) as number);
        return;
      }
      const split = splitRecurringRuleForFuture(
        current, date, {}, undefined, txs, exceptions, data.settings.budgetStartDay, nowIso, ctx.newId('rec', `_${i}_split`)
      );
      const hinted: RecurringRule = {
        ...split.newFutureRule,
        orderRank: ranks.get(rid),
        orderPosition: positions.get(rid),
        orderRankUpdatedAt: nowIso,
      };
      rules = [...rules.map(r => r.id === rid ? split.updatedOldRule : r), hinted];
      txs = split.updatedTransactions;
      exceptions = split.updatedExceptions;
      newRanks.set(hinted.id, ranks.get(rid) as number);
      if (positions.has(rid)) newPositions.set(hinted.id, positions.get(rid) as number);
    });

    // Už zhmotněné výskyty od tohoto dne dál (provedené i plánované) dostanou nové pořadí hned.
    // Přetažený den si navíc drží přesné pozice (i vůči ručním položkám) - samotný rank
    // řadí jen opakované platby mezi sebou a virtuální výskyt by jinak skočil zpět za ruční.
    return {
      data: {
        ...data,
        recurringRules: rules,
        recurringExceptions: withSequenceExceptions(
          clearSequenceOverrides(exceptions, new Set(newRanks.keys()), nowIso), newPositions, periodKey, ctx
        ),
        transactions: applyRulePositions(reorderRealToday(txs), toRuleOrder(newRanks, newPositions), date),
      },
      outcome: { reordered: true },
    };
  }

  // mode === 'series' - pořadí se uloží do pravidel a propíše i do všech už zhmotněných výskytů.
  return {
    data: {
      ...data,
      recurringRules: data.recurringRules.map(r => ranks.has(r.id)
        ? { ...r, orderRank: ranks.get(r.id), orderPosition: positions.get(r.id), orderRankUpdatedAt: nowIso, updatedAt: nowIso }
        : r),
      recurringExceptions: withSequenceExceptions(
        clearSequenceOverrides(data.recurringExceptions, new Set(ranks.keys()), nowIso), positions, periodKey, ctx
      ),
      transactions: applyRulePositions(reorderRealToday(data.transactions), toRuleOrder(ranks, positions)),
    },
    outcome: { reordered: true },
  };
}

/** Smaže pravidlo, jeho výjimky a neprovedené zhmotněné výskyty; provedené zůstávají jako historie. */
export function deleteRecurringRule(data: AppData, id: string): CommandResult<{ ruleTitle?: string }> {
  const idsToDelete = new Set<string>();
  for (const t of data.transactions) {
    if (t.recurringRuleId === id && t.status !== 'executed') idsToDelete.add(t.id);
  }
  return {
    data: {
      ...data,
      recurringRules: data.recurringRules.filter(r => r.id !== id),
      recurringExceptions: data.recurringExceptions.filter(e => e.ruleId !== id),
      transactions: idsToDelete.size > 0 ? deleteTransactionsAndReorder(idsToDelete, data.transactions) : data.transactions,
    },
    outcome: { ruleTitle: data.recurringRules.find(r => r.id === id)?.title },
  };
}
