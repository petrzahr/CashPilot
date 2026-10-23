import { Account, AccountPeriodBalance, AppSettings, BudgetPeriod, IntraDaySummary, Transaction } from '../types/finance';
import { calculateIntraDayRunningBalances } from './sequenceService';

/** Souhrn výchozího účtu za období pro dlaždice rozpočtu. */
export interface DefaultAccountPeriodTotals {
  openingInHaler: number;
  incomeInHaler: number;
  expenseInHaler: number;
  netTransfersInHaler: number;
  netChangeInHaler: number;
  closingInHaler: number;
  /** Konečný stav včetně kontokorentu */
  withOverdraftInHaler: number;
  isOverdraftExceeded: boolean;
}

export interface DayGroup {
  date: string;
  txs: Transaction[];
  intraDay: IntraDaySummary;
}

/** Limit kontokorentu z nastavení; starší data mají jen minimální rezervu. */
export function getOverdraftLimitInHaler(settings: Pick<AppSettings, 'overdraftLimitInHaler' | 'minReserveInHaler'>): number {
  return settings.overdraftLimitInHaler ?? settings.minReserveInHaler ?? 0;
}

/**
 * Dlaždice výchozího účtu. Změna za období přičítá počáteční zůstatek účtu aktivovaného
 * uvnitř období po jeho prvním dni (stejné pravidlo jako baseInitialToAdd ve forecastu).
 * Konečný stav se bere z forecastu; dopočítá se jen, když účet v souhrnu chybí.
 */
export function getDefaultAccountPeriodTotals(
  defaultAccount: Account | undefined,
  balance: AccountPeriodBalance | null | undefined,
  period: Pick<BudgetPeriod, 'startDate' | 'endDate'>,
  overdraftLimitInHaler: number
): DefaultAccountPeriodTotals {
  const opening = balance?.openingBalanceInHaler ?? 0;
  const income = balance?.incomeInHaler ?? 0;
  const expense = balance?.expenseInHaler ?? 0;
  const netTransfers = (balance?.transfersInInHaler ?? 0) - (balance?.transfersOutInHaler ?? 0);
  const corrections = balance?.correctionsInHaler ?? 0;
  const initDate = defaultAccount?.initialBalanceDate || '1970-01-01';
  const baseInitialToAdd = (initDate > period.startDate && initDate <= period.endDate)
    ? (defaultAccount?.initialBalanceInHaler || 0)
    : 0;
  const netChange = income - expense + netTransfers + corrections + baseInitialToAdd;
  const closing = balance?.closingBalanceInHaler ?? (opening + netChange);
  const withOverdraft = closing + overdraftLimitInHaler;
  return {
    openingInHaler: opening,
    incomeInHaler: income,
    expenseInHaler: expense,
    netTransfersInHaler: netTransfers,
    netChangeInHaler: netChange,
    closingInHaler: closing,
    withOverdraftInHaler: withOverdraft,
    isOverdraftExceeded: withOverdraft < 0,
  };
}

/**
 * Seskupí položky po dnech (vzestupně) a provede denní průběžný zůstatek přes použitelné účty
 * od počátečního stavu období. Položky dne zůstávají v pořadí vstupu.
 */
export function groupDaysWithRunningBalance(
  transactions: Transaction[],
  openingInHaler: number,
  usableAccountIds: Set<string>
): DayGroup[] {
  const dateMap = new Map<string, Transaction[]>();
  transactions.forEach(tx => {
    const existing = dateMap.get(tx.date) || [];
    existing.push(tx);
    dateMap.set(tx.date, existing);
  });

  let runningBalance = openingInHaler;
  return Array.from(dateMap.keys()).sort().map(date => {
    const txs = dateMap.get(date)!;
    const intraDay = calculateIntraDayRunningBalances(runningBalance, txs, undefined, usableAccountIds);
    runningBalance = intraDay.endOfDayBalanceInHaler;
    return { date, txs, intraDay };
  });
}

/**
 * Zůstatek zdrojového účtu po každé položce období. Každý účet se přehraje od svého
 * počátečního stavu přes všechny dny a pořadí v rámci dne; výsledek je jen pro položky,
 * kde je účet zdrojem. Vstupem mají být nefiltrované položky, aby filtr neovlivnil zůstatek.
 */
export function getSourceAccountBalanceByTxId(
  transactions: Transaction[],
  accountBalances: Record<string, AccountPeriodBalance>
): Map<string, number> {
  const txsByAccount = new Map<string, Transaction[]>();
  transactions.forEach(tx => {
    [tx.sourceAccountId, tx.targetAccountId].forEach(id => {
      if (!id) return;
      const list = txsByAccount.get(id) || [];
      if (!list.includes(tx)) list.push(tx);
      txsByAccount.set(id, list);
    });
  });

  const result = new Map<string, number>();
  txsByAccount.forEach((accTxs, accountId) => {
    let running = accountBalances[accountId]?.openingBalanceInHaler ?? 0;
    const dates = Array.from(new Set(accTxs.map(t => t.date))).sort();
    for (const date of dates) {
      const intraDay = calculateIntraDayRunningBalances(running, accTxs.filter(t => t.date === date), accountId);
      intraDay.steps.forEach(step => {
        if (step.transaction.sourceAccountId === accountId) {
          result.set(step.transaction.id, step.runningBalanceInHaler);
        }
      });
      running = intraDay.endOfDayBalanceInHaler;
    }
  });
  return result;
}
