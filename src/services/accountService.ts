import { Account } from '../types/finance';

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
