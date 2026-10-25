import { Account, AccountPeriodBalance, PeriodSummary } from '../types/finance';
import { addHaler, subHaler } from './currencyService';

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
