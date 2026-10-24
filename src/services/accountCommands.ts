import { Account, BalanceCorrection, InvestmentFee, MarketValueSnapshot, RecurringException, Transaction } from '../types/finance';
import type { AppData } from './storageService';
import type { CommandContext, CommandResult } from './transactionCommands';
import { getAccountBalanceAtDate } from './accountBalance';
import { subHaler } from './currencyService';
import { getAccountFees } from './investmentPerformanceService';
import { mutateMarketValueHistory, reconcileMarketValueHistory } from './marketValueHistoryService';
import { formatCzechDate } from './periodService';
import { getNextSequenceForDate, insertOrUpdateWithSequence } from './sequenceService';

/**
 * Příkazy nad účty, korekcemi zůstatku, tržními hodnotami a poplatky. Stejně jako
 * transactionCommands: čisté funkce (data, vstup, ctx) → { data, outcome }; kontroly
 * běží nad aktuálními daty a outcome nese vše potřebné pro oznámení a „Vrátit“.
 */

const isAssetAccount = (account: Account) => account.type === 'investment' || account.type === 'pension';

const inactiveMessage = (initialBalanceDate: string) =>
  `Tento účet je aktivní až od ${formatCzechDate(initialBalanceDate)}. Zvolte stejné nebo pozdější datum.`;

const unchanged = <O,>(data: AppData, outcome: O): CommandResult<O> => ({ data, outcome });

// ------------------- Účty -------------------

/** Vytvoří účet na konci uživatelského pořadí; výchozí účet zruší příznak u ostatních. */
export function addAccount(
  data: AppData,
  accData: Omit<Account, 'id' | 'createdAt' | 'updatedAt'>,
  ctx: CommandContext
): CommandResult<{ account: Account }> {
  const isDefault = Boolean(accData.isDefault);
  let accounts = data.accounts;
  if (isDefault) {
    accounts = accounts.map(a => a.isDefault ? { ...a, isDefault: false, updatedAt: ctx.nowIso } : a);
  }
  const maxSortOrder = accounts.reduce((max, a) => Math.max(max, a.sortOrder ?? 0), 0);
  const account: Account = {
    ...accData,
    isDefault,
    id: ctx.newId('acc'),
    sortOrder: maxSortOrder + 1,
    createdAt: ctx.nowIso,
    updatedAt: ctx.nowIso,
  };
  return { data: { ...data, accounts: [...accounts, account] }, outcome: { account } };
}

/** Nejdřívější pohyb účtu: položka (mimo zrušené), korekce, ocenění nebo začátek aktivního pravidla. */
function getEarliestMovementDate(data: AppData, accountId: string): string | null {
  const dates: string[] = [];
  for (const t of data.transactions) {
    if (t.status !== 'cancelled' && (t.sourceAccountId === accountId || t.targetAccountId === accountId)) dates.push(t.date);
  }
  for (const c of data.corrections) if (c.accountId === accountId) dates.push(c.checkDate);
  for (const s of data.marketValueSnapshots || []) if (s.accountId === accountId) dates.push(s.date);
  for (const r of data.recurringRules || []) {
    if (r.isActive && (r.sourceAccountId === accountId || r.targetAccountId === accountId)) dates.push(r.startDate);
  }
  return dates.length > 0 ? dates.reduce((min, d) => (d < min ? d : min)) : null;
}

/** Upraví účet. Počáteční zůstatek nesmí začínat později než první pohyb účtu. */
export function updateAccount(
  data: AppData,
  acc: Account,
  ctx: CommandContext
): CommandResult<{ error: string } | { account: Account }> {
  const earliest = acc.initialBalanceDate ? getEarliestMovementDate(data, acc.id) : null;
  if (earliest && acc.initialBalanceDate > earliest) {
    return unchanged(data, {
      error: `Počáteční zůstatek nemůže začínat později než první položka účtu (${formatCzechDate(earliest)}). Zvolte dřívější datum, nebo nejdřív posuňte či smažte starší položky.`,
    });
  }

  const isDefault = Boolean(acc.isDefault);
  const updated: Account = { ...acc, isDefault, updatedAt: ctx.nowIso };
  // Older clients copied the initial balance into an undated market value on create; drop that copy so it does not go stale
  const before = data.accounts.find(a => a.id === acc.id);
  if (before && !acc.marketValueUpdatedAt && acc.currentMarketValueInHaler !== undefined &&
    acc.currentMarketValueInHaler === before.initialBalanceInHaler &&
    acc.initialBalanceInHaler !== before.initialBalanceInHaler) {
    updated.currentMarketValueInHaler = undefined;
  }
  return {
    data: {
      ...data,
      accounts: data.accounts.map(a => {
        if (a.id === acc.id) return updated;
        if (isDefault && a.isDefault) return { ...a, isDefault: false, updatedAt: ctx.nowIso };
        return a;
      }),
    },
    outcome: { account: updated },
  };
}

/** Archivuje účet (přestane být výchozí). Účet s aktivní pravidelnou položkou archivovat nejde. */
export function archiveAccount(
  data: AppData,
  id: string,
  ctx: CommandContext
): CommandResult<{ error: string } | { before?: Account }> {
  const activeRules = data.recurringRules.filter(r => r.isActive && (r.sourceAccountId === id || r.targetAccountId === id));
  if (activeRules.length > 0) {
    return unchanged(data, {
      error: `Účet nelze archivovat, protože je navázán na ${activeRules.length} aktivní pravidelné položky (např. ${activeRules[0].title}). Nejdřív u nich změňte účet nebo opakování ukončete.`,
    });
  }
  const before = data.accounts.find(a => a.id === id);
  return {
    data: {
      ...data,
      accounts: data.accounts.map(a => a.id === id ? { ...a, status: 'archived', isDefault: false, updatedAt: ctx.nowIso } : a),
    },
    outcome: { before },
  };
}

/** „Vrátit“ archivaci: účet dostane zpět původní stav i příznak výchozího účtu. */
export function undoArchiveAccount(data: AppData, before: Account, ctx: CommandContext): CommandResult<null> {
  return {
    data: {
      ...data,
      accounts: data.accounts.map(a => {
        if (a.id === before.id) return { ...a, status: before.status, isDefault: before.isDefault, updatedAt: ctx.nowIso };
        return before.isDefault && a.isDefault ? { ...a, isDefault: false, updatedAt: ctx.nowIso } : a;
      }),
    },
    outcome: null,
  };
}

/** Obnoví účet z archivu (jako nevýchozí). */
export function restoreAccount(data: AppData, id: string, ctx: CommandContext): CommandResult<{ name?: string }> {
  return {
    data: {
      ...data,
      accounts: data.accounts.map(a => a.id === id ? { ...a, status: 'active', isDefault: false, updatedAt: ctx.nowIso } : a),
    },
    outcome: { name: data.accounts.find(a => a.id === id)?.name },
  };
}

/** Účet a vše, co se smazalo s ním - pro „Vrátit“. */
export interface RemovedAccount {
  account: Account;
  corrections: BalanceCorrection[];
  snapshots: MarketValueSnapshot[];
  fees: InvestmentFee[];
  exceptions: RecurringException[];
  usableOverride: boolean | undefined;
}

export const ACCOUNT_IN_USE_MESSAGE =
  'Účet má položky, pravidelné položky nebo korekce, a proto ho nejde smazat. Můžete ho archivovat – zmizí z nabídek, ale historie zůstane.';

/**
 * Smaže účet bez historie i s jeho korekcemi, oceněními, poplatky a výjimkami, které na
 * něj odkazují. Účet s položkami, pravidly nebo platnou korekcí smazat nejde. Osiřelý záznam
 * korekce bez položky na prázdném účtu smazání nebrání.
 */
export function deleteAccount(
  data: AppData,
  id: string
): CommandResult<{ error: string } | { removed: RemovedAccount | null }> {
  const hasTransactions = data.transactions.some(t => t.sourceAccountId === id || t.targetAccountId === id);
  const hasRules = data.recurringRules.some(r => r.sourceAccountId === id || r.targetAccountId === id);
  const hasActiveCorrections = data.corrections.some(c =>
    c.accountId === id && (
      hasTransactions ||
      data.transactions.some(t => t.id === c.id || (t.type === 'balance_adjustment' && t.sourceAccountId === id))
    )
  );
  if (hasTransactions || hasRules || hasActiveCorrections) return unchanged(data, { error: ACCOUNT_IN_USE_MESSAGE });

  const account = data.accounts.find(a => a.id === id);
  if (!account) return unchanged(data, { removed: null });

  const isRemovedException = (e: RecurringException) => e.overrideSourceAccountId === id || e.overrideTargetAccountId === id;
  const removed: RemovedAccount = {
    account,
    corrections: data.corrections.filter(c => c.accountId === id),
    snapshots: (data.marketValueSnapshots || []).filter(s => s.accountId === id),
    fees: (data.investmentFees || []).filter(f => f.accountId === id),
    exceptions: (data.recurringExceptions || []).filter(isRemovedException),
    usableOverride: data.settings?.accountUsableOverrides?.[id],
  };
  const overrides = { ...(data.settings?.accountUsableOverrides || {}) };
  delete overrides[id];

  return {
    data: {
      ...data,
      accounts: data.accounts.filter(a => a.id !== id),
      corrections: data.corrections.filter(c => c.accountId !== id),
      marketValueSnapshots: (data.marketValueSnapshots || []).filter(s => s.accountId !== id),
      investmentFees: (data.investmentFees || []).filter(f => f.accountId !== id),
      recurringExceptions: (data.recurringExceptions || []).filter(e => !isRemovedException(e)),
      settings: { ...data.settings, accountUsableOverrides: overrides },
    },
    outcome: { removed },
  };
}

/**
 * „Vrátit“ smazání účtu. Nové updatedAt je pozdější než záznam o smazání, takže
 * synchronizace obnovu přijme. Opakované vrácení nic nezdvojí.
 */
export function restoreDeletedAccount(data: AppData, removed: RemovedAccount, ctx: CommandContext): CommandResult<null> {
  if (data.accounts.some(a => a.id === removed.account.id)) return unchanged(data, null);
  const touch = <T,>(items: T[]): T[] => items.map(item => ({ ...item, updatedAt: ctx.nowIso }));
  const overrides = { ...(data.settings?.accountUsableOverrides || {}) };
  if (removed.usableOverride !== undefined) overrides[removed.account.id] = removed.usableOverride;
  return {
    data: reconcileMarketValueHistory({
      ...data,
      accounts: [...data.accounts, { ...removed.account, updatedAt: ctx.nowIso }],
      corrections: [...data.corrections, ...touch(removed.corrections)],
      marketValueSnapshots: [...(data.marketValueSnapshots || []), ...touch(removed.snapshots)],
      investmentFees: [...(data.investmentFees || []), ...touch(removed.fees)],
      recurringExceptions: [...(data.recurringExceptions || []), ...touch(removed.exceptions)],
      settings: { ...data.settings, accountUsableOverrides: overrides },
    }),
    outcome: null,
  };
}

// ------------------- Korekce zůstatku -------------------

export type ReconcileOutcome =
  | { kind: 'none' }
  | { kind: 'warning'; message: string }
  | { kind: 'unchanged' }
  | { kind: 'corrected'; diffInHaler: number };

/**
 * Srovná zůstatek běžného účtu s bankou: rozdíl proti vypočtenému stavu (včetně plánovaných
 * položek, před novou korekcí v daném dni) se uloží jako korekce a zároveň jako položka
 * balance_adjustment na konci dne. Nulový rozdíl nic neukládá.
 */
export function reconcileBalance(
  data: AppData,
  input: { accountId: string; actualBalanceInHaler: number; checkDate: string; note?: string },
  ctx: CommandContext
): CommandResult<ReconcileOutcome> {
  const { accountId, actualBalanceInHaler, checkDate } = input;
  const account = data.accounts.find(a => a.id === accountId);
  if (!account) return unchanged(data, { kind: 'none' });

  if (account.initialBalanceDate && checkDate < account.initialBalanceDate) {
    return unchanged(data, { kind: 'warning', message: inactiveMessage(account.initialBalanceDate) });
  }
  if (isAssetAccount(account)) {
    return unchanged(data, { kind: 'warning', message: 'U investičních a penzijních účtů se místo korekce zadává tržní hodnota.' });
  }

  const nextSeq = getNextSequenceForDate(checkDate, data.transactions);
  const calculated = getAccountBalanceAtDate(
    account,
    checkDate,
    { transactions: data.transactions, corrections: data.corrections },
    { includePlanned: true, beforeSequence: nextSeq }
  );
  const diffInHaler = subHaler(actualBalanceInHaler, calculated);
  if (diffInHaler === 0) return unchanged(data, { kind: 'unchanged' });

  const id = ctx.newId('corr');
  const note = input.note && input.note.trim() ? input.note.trim() : 'Aktualizace skutečného stavu';

  const correction: BalanceCorrection = {
    id,
    accountId,
    checkDate,
    sequence: nextSeq,
    type: 'balance_adjustment',
    calculatedBalanceInHaler: calculated,
    actualBalanceInHaler,
    diffInHaler,
    note,
    createdAt: ctx.nowIso,
    updatedAt: ctx.nowIso
  };
  const correctionTx: Transaction = {
    id,
    title: 'Korekce zůstatku',
    amountInHaler: Math.abs(diffInHaler),
    date: checkDate,
    sequence: nextSeq,
    type: 'balance_adjustment',
    sourceAccountId: accountId,
    status: 'executed',
    actualAmountInHaler: Math.abs(diffInHaler),
    calculatedBalanceInHaler: calculated,
    actualBalanceInHaler,
    diffInHaler,
    note,
    createdAt: ctx.nowIso,
    updatedAt: ctx.nowIso
  };

  return {
    data: {
      ...data,
      corrections: [...data.corrections, correction],
      transactions: insertOrUpdateWithSequence(correctionTx, nextSeq, data.transactions),
    },
    outcome: { kind: 'corrected', diffInHaler },
  };
}

/** Uloží poznámku ke korekci (u položky i u záznamu korekce). */
export function updateCorrectionNote(data: AppData, input: { id: string; note: string }, ctx: CommandContext): CommandResult<null> {
  const { id, note } = input;
  return {
    data: {
      ...data,
      transactions: data.transactions.map(t => t.id === id ? { ...t, note, updatedAt: ctx.nowIso } : t),
      corrections: data.corrections.map(c => c.id === id ? { ...c, note, updatedAt: ctx.nowIso } : c),
    },
    outcome: null,
  };
}

/** Smaže samostatnou korekci (bez položky v seznamu); korekci s položkou maže deleteTransaction. */
export function deleteStandaloneCorrection(data: AppData, id: string): CommandResult<{ deleted?: BalanceCorrection }> {
  return {
    data: { ...data, corrections: data.corrections.filter(c => c.id !== id) },
    outcome: { deleted: data.corrections.find(c => c.id === id) },
  };
}

/** „Vrátit“ smazání samostatné korekce. */
export function restoreCorrection(data: AppData, correction: BalanceCorrection, ctx: CommandContext): CommandResult<null> {
  if (data.corrections.some(c => c.id === correction.id)) return unchanged(data, null);
  return {
    data: { ...data, corrections: [...data.corrections, { ...correction, updatedAt: ctx.nowIso }] },
    outcome: null,
  };
}

// ------------------- Tržní hodnoty -------------------

export type AddMarketValueOutcome =
  | { kind: 'none' }
  | { kind: 'warning'; message: string }
  | { kind: 'saved'; accountType: Account['type'] };

/**
 * Uloží ocenění investičního nebo penzijního účtu (bez data = dnes). Aktuální tržní hodnota
 * účtu se změní jen u ocenění, které není starší než poslední známé.
 */
export function addMarketValue(
  data: AppData,
  input: { accountId: string; marketValueInHaler: number; date?: string; note?: string },
  ctx: CommandContext
): CommandResult<AddMarketValueOutcome> {
  const { accountId, marketValueInHaler } = input;
  const account = data.accounts.find(a => a.id === accountId);
  if (!account) return unchanged(data, { kind: 'none' });

  if (!isAssetAccount(account)) {
    return unchanged(data, { kind: 'warning', message: 'Tržní hodnota jde zadat jen u investičních a penzijních účtů.' });
  }

  const valuationDate = input.date && input.date.trim() ? input.date.trim() : ctx.todayStr;
  if (account.initialBalanceDate && valuationDate < account.initialBalanceDate) {
    return unchanged(data, { kind: 'warning', message: inactiveMessage(account.initialBalanceDate) });
  }

  // Ocenění téhož účtu mají rostoucí createdAt, aby se zachovalo pořadí záznamů ze stejného dne
  const createdAt = new Date(data.marketValueSnapshots.filter(s => s.accountId === accountId)
    .reduce((time, s) => Math.max(time, (Date.parse(s.createdAt) || 0) + 1), Date.parse(ctx.nowIso))).toISOString();
  const snapshot: MarketValueSnapshot = {
    id: ctx.newId('mvs'),
    accountId,
    date: valuationDate,
    marketValueInHaler,
    note: input.note && input.note.trim() ? input.note.trim() : undefined,
    createdAt,
    updatedAt: ctx.nowIso
  };
  const isLatest = !account.marketValueUpdatedAt || valuationDate >= account.marketValueUpdatedAt;

  return {
    data: reconcileMarketValueHistory({
      ...data,
      marketValueSnapshots: [...data.marketValueSnapshots, snapshot],
      accounts: data.accounts.map(a => a.id === accountId ? {
        ...a,
        currentMarketValueInHaler: isLatest ? marketValueInHaler : a.currentMarketValueInHaler,
        marketValueUpdatedAt: isLatest ? valuationDate : a.marketValueUpdatedAt,
        updatedAt: ctx.nowIso
      } : a)
    }),
    outcome: { kind: 'saved', accountType: account.type },
  };
}

/** Smaže ocenění; outcome nese smazaný záznam pro „Vrátit“. */
export function deleteMarketValue(data: AppData, id: string): CommandResult<{ deleted?: MarketValueSnapshot }> {
  return {
    data: mutateMarketValueHistory(data, id),
    outcome: { deleted: data.marketValueSnapshots.find(s => s.id === id) },
  };
}

/** „Vrátit“ smazání ocenění: vloží záznam zpět s původním createdAt (zachová pořadí ve dni). */
export function restoreMarketValue(data: AppData, snapshot: MarketValueSnapshot, ctx: CommandContext): CommandResult<null> {
  if (data.marketValueSnapshots.some(s => s.id === snapshot.id)) return unchanged(data, null);
  return {
    data: reconcileMarketValueHistory({
      ...data,
      marketValueSnapshots: [...data.marketValueSnapshots, { ...snapshot, updatedAt: ctx.nowIso }],
    }),
    outcome: null,
  };
}

// ------------------- Poplatky -------------------

/** Uloží poplatek za období; nejvýše jeden za účet a období, existující se přepíše. */
export function saveInvestmentFee(
  data: AppData,
  input: { accountId: string; periodKey: string; amountInHaler: number; note?: string },
  ctx: CommandContext
): CommandResult<{ error: string } | { fee: InvestmentFee }> {
  const { accountId, periodKey, amountInHaler } = input;
  if (!/^\d{4}-\d{2}$/.test(periodKey) || !Number.isSafeInteger(amountInHaler) || amountInHaler < 0) {
    return unchanged(data, { error: 'Zadejte částku poplatku (0 nebo více).' });
  }
  const note = input.note && input.note.trim() ? input.note.trim() : undefined;
  const fees = data.investmentFees || [];
  const existing = getAccountFees(fees, accountId).find(f => f.periodKey === periodKey);
  const others = fees.filter(f => !(f.accountId === accountId && f.periodKey === periodKey));
  const fee: InvestmentFee = existing
    ? { ...existing, amountInHaler, note, updatedAt: ctx.nowIso }
    : { id: ctx.newId('fee'), accountId, periodKey, amountInHaler, note, createdAt: ctx.nowIso, updatedAt: ctx.nowIso };
  return { data: { ...data, investmentFees: [...others, fee] }, outcome: { fee } };
}

/** Smaže poplatek (i případné další záznamy téhož období); outcome nese smazané pro „Vrátit“. */
export function deleteInvestmentFee(
  data: AppData,
  id: string
): CommandResult<{ target?: InvestmentFee; deleted: InvestmentFee[] }> {
  const fees = data.investmentFees || [];
  const target = fees.find(f => f.id === id);
  if (!target) return unchanged(data, { deleted: [] });
  const samePeriod = (f: InvestmentFee) => f.accountId === target.accountId && f.periodKey === target.periodKey;
  return {
    data: { ...data, investmentFees: fees.filter(f => !samePeriod(f)) },
    outcome: { target, deleted: fees.filter(samePeriod) },
  };
}

/** „Vrátit“ smazání poplatku - jen pokud mezitím pro stejné období nevznikl nový. */
export function restoreInvestmentFees(data: AppData, deleted: InvestmentFee[], ctx: CommandContext): CommandResult<null> {
  const fees = data.investmentFees || [];
  if (deleted.length === 0 || fees.some(f => f.accountId === deleted[0].accountId && f.periodKey === deleted[0].periodKey)) {
    return unchanged(data, null);
  }
  return {
    data: { ...data, investmentFees: [...fees, ...deleted.map(f => ({ ...f, updatedAt: ctx.nowIso }))] },
    outcome: null,
  };
}
