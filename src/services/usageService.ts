import { Category, RecurringRule, Transaction } from '../types/finance';

export interface UsageCount {
  transactions: number;
  rules: number;
}

export const isInUse = (usage: UsageCount) => usage.transactions > 0 || usage.rules > 0;

/** Kolik položek a pravidelných položek používá účet (jako zdroj i cíl převodu). */
export function getAccountUsage(
  accountId: string,
  transactions: Transaction[],
  recurringRules: RecurringRule[]
): UsageCount {
  return {
    transactions: transactions.filter(t => t.sourceAccountId === accountId || t.targetAccountId === accountId).length,
    rules: recurringRules.filter(r => r.sourceAccountId === accountId || r.targetAccountId === accountId).length,
  };
}

/**
 * Kolik položek a pravidelných položek používá kategorii včetně jejích podkategorií –
 * smazání hlavní kategorie maže i podkategorie, takže se musí počítat i jejich použití.
 */
export function getCategoryUsage(
  categoryId: string,
  categories: Category[],
  transactions: Transaction[],
  recurringRules: RecurringRule[]
): UsageCount {
  const ids = new Set([categoryId, ...categories.filter(c => c.parentId === categoryId).map(c => c.id)]);
  const uses = (item: { categoryId?: string | null; subcategoryId?: string | null }) =>
    (!!item.categoryId && ids.has(item.categoryId)) || (!!item.subcategoryId && ids.has(item.subcategoryId));
  return {
    transactions: transactions.filter(uses).length,
    rules: recurringRules.filter(uses).length,
  };
}

/** „214 položek a 3 pravidelné položky“ – česká čísla a tvary slov. */
export function describeUsage(usage: UsageCount): string {
  const plural = (n: number, one: string, few: string, many: string) =>
    `${n.toLocaleString('cs-CZ')} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;
  const parts: string[] = [];
  if (usage.transactions > 0) parts.push(plural(usage.transactions, 'položka', 'položky', 'položek'));
  if (usage.rules > 0) parts.push(plural(usage.rules, 'pravidelná položka', 'pravidelné položky', 'pravidelných položek'));
  return parts.join(' a ');
}
