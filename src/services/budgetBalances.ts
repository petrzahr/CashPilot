import { IntraDaySummary, PeriodView, Transaction } from '../types/finance';
import { calculateIntraDayRunningBalances } from './sequenceService';

export interface DayGroup {
  date: string;
  txs: Transaction[];
  intraDay: IntraDaySummary;
}

/**
 * Seskupí položky po dnech (vzestupně) a provede denní průběžný zůstatek přes použitelné účty
 * od počátečního stavu období (z projekce). Položky dne zůstávají v pořadí vstupu.
 */
export function groupDaysWithRunningBalance(
  transactions: Transaction[],
  view: PeriodView | undefined,
  usableAccountIds: Set<string>
): DayGroup[] {
  const openingInHaler = view?.projected.usableOpeningInHaler ?? 0;
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
 * počátečního stavu (ze záznamu období, bez projekce investic) přes všechny dny a pořadí
 * v rámci dne; výsledek je jen pro položky, kde je účet zdrojem. Vstupem mají být
 * nefiltrované položky, aby filtr neovlivnil zůstatek.
 */
export function getSourceAccountBalanceByTxId(
  transactions: Transaction[],
  view: PeriodView | undefined
): Map<string, number> {
  const accountBalances = view?.recorded.accountBalances ?? {};
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
