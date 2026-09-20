import { Account, Transaction } from '../types/finance';
import { addHaler, subHaler } from './currencyService';

/**
 * Signed effect of a transaction on an investment/pension account value:
 * transfers in / income add, transfers out / expenses subtract.
 */
export function getAssetFlowInHaler(tx: Transaction, accountId: string, amountInHaler: number): number {
  if (tx.type === 'transfer') {
    let flow = 0;
    if (tx.targetAccountId === accountId) flow = addHaler(flow, amountInHaler);
    if (tx.sourceAccountId === accountId) flow = subHaler(flow, amountInHaler);
    return flow;
  }
  if (tx.sourceAccountId !== accountId) return 0;
  if (tx.type === 'income') return amountInHaler;
  if (tx.type === 'expense') return subHaler(0, amountInHaler);
  return 0;
}

/** Apply the optional cost-basis correction without changing balances or cash flows. */
export function getEffectiveInvestedAmount(account: Account, calculatedAmountInHaler: number): number {
  if (account.type !== 'investment' && account.type !== 'pension') return calculatedAmountInHaler;
  return addHaler(calculatedAmountInHaler, account.investedAmountAdjustmentInHaler ?? 0);
}

/**
 * Seřadí účty podle uživatelem definovaného pořadí (sortOrder).
 * Při shodě rozhodne datum vytvoření a následně id, aby bylo řazení deterministické.
 * Původní pole nemutuje.
 */
export function sortAccountsByOrder(accounts: Account[]): Account[] {
  return [...accounts].sort((a, b) => {
    const orderA = a.sortOrder ?? 0;
    const orderB = b.sortOrder ?? 0;
    if (orderA !== orderB) return orderA - orderB;
    const createdCmp = (a.createdAt || '').localeCompare(b.createdAt || '');
    if (createdCmp !== 0) return createdCmp;
    return (a.id || '').localeCompare(b.id || '');
  });
}

/**
 * Přepíše pořadí účtů podle zadaného seznamu id (drag-and-drop).
 * Účty, které v seznamu chybí, zůstávají na konci v původním relativním pořadí.
 */
export function applyAccountOrder(orderedIds: string[], allAccounts: Account[]): Account[] {
  const remaining = new Map(allAccounts.map(a => [a.id, a]));
  const ordered: Account[] = [];

  for (const id of orderedIds) {
    const acc = remaining.get(id);
    if (acc) {
      ordered.push(acc);
      remaining.delete(id);
    }
  }
  for (const acc of sortAccountsByOrder([...remaining.values()])) {
    ordered.push(acc);
  }

  const nowIso = new Date().toISOString();
  return ordered.map((acc, index) => {
    const sortOrder = index + 1;
    return acc.sortOrder === sortOrder ? acc : { ...acc, sortOrder, updatedAt: nowIso };
  });
}
