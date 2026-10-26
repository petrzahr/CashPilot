import { Account, AccountPeriodBalance, PeriodSummary, PeriodView, Transaction } from '../types/finance';
import { addHaler, subHaler } from './currencyService';
import { getEffectiveAmountInHaler } from './accountScope';
import { isRemainingPlanned } from './financialEngine';

/**
 * Řádky obrazovky Majetek: tok jednoho období za zvolený pohled (Celkový majetek / Použitelné peníze)
 * a tok jednoho účtu v rozbaleném období. Bez Reactu, nad projektovaným souhrnem období.
 */

export type OverviewScope = 'all' | 'usable';

export interface OverviewScopeRow {
  openingInHaler: number;
  incomeInHaler: number;
  expenseInHaler: number;
  netTransfersInHaler: number;
  netChangeInHaler: number;
  closingInHaler: number;
}

export interface OverviewAccountRow {
  openingInHaler: number;
  /** Příjmy, kladné korekce a růst tržní hodnoty. */
  incomingInHaler: number;
  /** Výdaje, záporné korekce a pokles tržní hodnoty, jako kladné číslo. */
  outgoingInHaler: number;
  netTransfersInHaler: number;
  netChangeInHaler: number;
  closingInHaler: number;
}

export function getScopeRow(summary: PeriodSummary, accounts: Account[], scope: OverviewScope): OverviewScopeRow {
  // Příjmy, výdaje a čisté převody jen z účtů zvoleného pohledu, aby řádek seděl na Čistou změnu
  let incomeInHaler = 0;
  let expenseInHaler = 0;
  let netTransfersInHaler = 0;
  for (const [accountId, bal] of Object.entries(summary.accountBalances)) {
    if (scope === 'usable' && !accounts.find(a => a.id === accountId)?.isUsableCash) continue;
    incomeInHaler = addHaler(incomeInHaler, bal.incomeInHaler);
    expenseInHaler = addHaler(expenseInHaler, bal.expenseInHaler);
    netTransfersInHaler = addHaler(netTransfersInHaler, subHaler(bal.transfersInInHaler, bal.transfersOutInHaler));
  }

  const usable = scope === 'usable';
  return {
    openingInHaler: usable ? summary.usableOpeningInHaler : summary.openingBalanceInHaler,
    incomeInHaler,
    expenseInHaler,
    netTransfersInHaler,
    netChangeInHaler: usable ? summary.usableNetChangeInHaler : summary.netChangeInHaler,
    closingInHaler: usable ? summary.usableClosingInHaler : summary.closingBalanceInHaler,
  };
}

export function getAccountRow(account: Account, balance: AccountPeriodBalance): OverviewAccountRow {
  const netTransfersInHaler = subHaler(balance.transfersInInHaler, balance.transfersOutInHaler);
  const netChangeInHaler = subHaler(balance.closingBalanceInHaler, balance.openingBalanceInHaler);

  // Pro investiční/penzijní účty konečný stav zahrnuje i změnu tržní hodnoty,
  // kterou je nutné promítnout do pohybů, jinak počáteční + pohyby != konečný stav.
  const valuationChangeInHaler = (account.type === 'investment' || account.type === 'pension')
    ? subHaler(netChangeInHaler, addHaler(netTransfersInHaler, subHaler(balance.incomeInHaler, balance.expenseInHaler)))
    : 0;
  const corrections = balance.correctionsInHaler;

  return {
    openingInHaler: balance.openingBalanceInHaler,
    incomingInHaler: addHaler(balance.incomeInHaler, corrections > 0 ? corrections : 0, valuationChangeInHaler > 0 ? valuationChangeInHaler : 0),
    outgoingInHaler: addHaler(balance.expenseInHaler, corrections < 0 ? Math.abs(corrections) : 0, valuationChangeInHaler < 0 ? Math.abs(valuationChangeInHaler) : 0),
    netTransfersInHaler,
    netChangeInHaler,
    closingInHaler: balance.closingBalanceInHaler,
  };
}

/** Plánovaná (zbývající) část toků jednoho účtu v období. */
export interface PlannedFlows {
  incomeInHaler: number;
  expenseInHaler: number;
  netTransfersInHaler: number;
}

/** Provedená část řádku a dnešní stav, jen pro probíhající období. */
export interface ExecutedRow {
  incomingInHaler: number;
  outgoingInHaler: number;
  netTransfersInHaler: number;
  netChangeInHaler: number;
  nowInHaler: number;
}

export interface RowSplit {
  /** Období obsahuje plánované položky dotýkající se řádku. */
  hasPlanned: boolean;
  executed?: ExecutedRow;
}

/**
 * Zbývající položky (isRemainingPlanned) účtu se stejnými pravidly aktivace jako souhrn období:
 * příjem, výdaj a odchozí převod od data aktivace zdrojového účtu, příchozí převod od aktivace cílového.
 * Korekce a změny tržní hodnoty jsou vždy uskutečněné.
 */
export function getAccountPlannedFlows(items: Transaction[], account: Account, today: string): PlannedFlows {
  const activeFrom = account.initialBalanceDate;
  let incomeInHaler = 0;
  let expenseInHaler = 0;
  let netTransfersInHaler = 0;
  for (const tx of items) {
    if (!isRemainingPlanned(tx, today) || (activeFrom && tx.date < activeFrom)) continue;
    const amount = getEffectiveAmountInHaler(tx);
    if (tx.sourceAccountId === account.id) {
      if (tx.type === 'income') incomeInHaler = addHaler(incomeInHaler, amount);
      else if (tx.type === 'expense') expenseInHaler = addHaler(expenseInHaler, amount);
      else if (tx.type === 'transfer') netTransfersInHaler = subHaler(netTransfersInHaler, amount);
    }
    if (tx.type === 'transfer' && tx.targetAccountId === account.id) {
      netTransfersInHaler = addHaler(netTransfersInHaler, amount);
    }
  }
  return { incomeInHaler, expenseInHaler, netTransfersInHaler };
}

const hasAnyFlow = (p: PlannedFlows) => p.incomeInHaler !== 0 || p.expenseInHaler !== 0 || p.netTransfersInHaler !== 0;

/**
 * Rozdělení řádku pohledu na provedenou část (řádek − plán) a dnešní stav. Plán se sčítá po účtech
 * pohledu stejně jako getScopeRow; Čistá změna pohledu „all“ převody neobsahuje, proto ani její plán.
 */
export function getScopeSplit(view: PeriodView, accounts: Account[], scope: OverviewScope, today: string): RowSplit {
  const row = getScopeRow(view.projected, accounts, scope);
  const planned: PlannedFlows = { incomeInHaler: 0, expenseInHaler: 0, netTransfersInHaler: 0 };
  let hasPlanned = false;
  let nowInHaler = 0;
  for (const accountId of Object.keys(view.projected.accountBalances)) {
    const account = accounts.find(a => a.id === accountId);
    if (!account || (scope === 'usable' && !account.isUsableCash)) continue;
    const flows = getAccountPlannedFlows(view.items, account, today);
    hasPlanned ||= hasAnyFlow(flows);
    planned.incomeInHaler = addHaler(planned.incomeInHaler, flows.incomeInHaler);
    planned.expenseInHaler = addHaler(planned.expenseInHaler, flows.expenseInHaler);
    planned.netTransfersInHaler = addHaler(planned.netTransfersInHaler, flows.netTransfersInHaler);
    nowInHaler = addHaler(nowInHaler, view.actual?.accountBalances[accountId] ?? 0);
  }
  if (!view.actual) return { hasPlanned };

  const plannedNetChange = addHaler(
    subHaler(planned.incomeInHaler, planned.expenseInHaler),
    scope === 'usable' ? planned.netTransfersInHaler : 0
  );
  return {
    hasPlanned,
    executed: {
      incomingInHaler: subHaler(row.incomeInHaler, planned.incomeInHaler),
      outgoingInHaler: subHaler(row.expenseInHaler, planned.expenseInHaler),
      netTransfersInHaler: subHaler(row.netTransfersInHaler, planned.netTransfersInHaler),
      netChangeInHaler: subHaler(row.netChangeInHaler, plannedNetChange),
      nowInHaler,
    },
  };
}

/** Rozdělení řádku účtu v rozbaleném období; přírůstky a úbytky z korekcí a tržní hodnoty jsou provedené. */
export function getAccountSplit(view: PeriodView, account: Account, today: string): RowSplit {
  const balance = view.projected.accountBalances[account.id];
  const planned = getAccountPlannedFlows(view.items, account, today);
  const hasPlanned = hasAnyFlow(planned);
  if (!balance || !view.actual) return { hasPlanned };

  const row = getAccountRow(account, balance);
  return {
    hasPlanned,
    executed: {
      incomingInHaler: subHaler(row.incomingInHaler, planned.incomeInHaler),
      outgoingInHaler: subHaler(row.outgoingInHaler, planned.expenseInHaler),
      netTransfersInHaler: subHaler(row.netTransfersInHaler, planned.netTransfersInHaler),
      netChangeInHaler: subHaler(row.netChangeInHaler, addHaler(subHaler(planned.incomeInHaler, planned.expenseInHaler), planned.netTransfersInHaler)),
      nowInHaler: view.actual.accountBalances[account.id] ?? 0,
    },
  };
}
