import { Account, Category, MovementType, Transaction, TransactionStatus } from '../types/finance';
import { getEffectiveAmountInHaler } from './accountScope';
import { czechStringCompare } from './categoryService';
import { addHaler } from './currencyService';

/** Nabídka filtru Typ seřazená A–Z. */
export const TYPE_OPTIONS: { value: MovementType; label: string }[] = [
  { value: 'balance_adjustment' as MovementType, label: 'Korekce zůstatku' },
  { value: 'income' as MovementType, label: 'Příjem' },
  { value: 'transfer' as MovementType, label: 'Převod' },
  { value: 'expense' as MovementType, label: 'Výdaj' },
].sort((a, b) => czechStringCompare(a.label, b.label));

/** Nabídka filtru Stav seřazená A–Z. */
export const STATUS_OPTIONS: { value: TransactionStatus; label: string }[] = [
  { value: 'planned' as TransactionStatus, label: 'Plánovaná' },
  { value: 'executed' as TransactionStatus, label: 'Uskutečněná' },
  { value: 'cancelled' as TransactionStatus, label: 'Zrušená' },
].sort((a, b) => czechStringCompare(a.label, b.label));

/**
 * Filtrování seznamu položek (Měsíční rozpočet, Všechny položky). Prázdný výběr = bez omezení;
 * v rámci jednoho filtru platí OR, mezi filtry AND.
 */
export interface ItemFilters {
  search: string;
  accounts: string[];
  mainCategories: string[];
  subCategories: string[];
  types: string[];
  statuses: string[];
}

export const EMPTY_ITEM_FILTERS: ItemFilters = {
  search: '',
  accounts: [],
  mainCategories: [],
  subCategories: [],
  types: [],
  statuses: [],
};

export interface FilterOptions {
  accounts: Account[];
  mainCategories: Category[];
  subCategories: Category[];
}

/**
 * Nabídky filtrů seřazené A–Z: aktivní účty a kategorie vždy, archivované jen pokud je
 * položky používají (u hlavní kategorie stačí použitá podkategorie). Podkategorie jen pro
 * vybrané hlavní kategorie.
 */
export function getFilterOptions(
  items: Transaction[],
  accounts: Account[],
  categories: Category[],
  selectedMainIds: string[]
): FilterOptions {
  const usedCategoryIds = new Set<string>();
  for (const tx of items) {
    if (tx.categoryId) usedCategoryIds.add(tx.categoryId);
    if (tx.subcategoryId) usedCategoryIds.add(tx.subcategoryId);
  }
  const byName = <T extends { name: string }>(a: T, b: T) => czechStringCompare(a.name, b.name);

  return {
    accounts: accounts
      .filter(a => a.status === 'active' || items.some(t => t.sourceAccountId === a.id || t.targetAccountId === a.id))
      .sort(byName),
    mainCategories: categories
      .filter(c => {
        if (c.parentId) return false;
        if (c.status === 'active' || usedCategoryIds.has(c.id)) return true;
        return categories.some(sub => sub.parentId === c.id && usedCategoryIds.has(sub.id));
      })
      .sort(byName),
    subCategories: selectedMainIds.length === 0 ? [] : categories
      .filter(c => !!c.parentId && selectedMainIds.includes(c.parentId) && (c.status === 'active' || usedCategoryIds.has(c.id)))
      .sort(byName),
  };
}

/**
 * Odstraní z výběru hodnoty, které v nabídkách už nejsou. Zmizí-li některá vybraná hlavní
 * kategorie, vyprázdní se i výběr podkategorií. Beze změny vrací původní objekt.
 */
export function sanitizeFilters(filters: ItemFilters, options: FilterOptions): ItemFilters {
  const keep = (ids: string[], available: { id: string }[]) => ids.filter(id => available.some(o => o.id === id));
  const accounts = keep(filters.accounts, options.accounts);
  const mainCategories = keep(filters.mainCategories, options.mainCategories);
  const mainChanged = mainCategories.length !== filters.mainCategories.length;
  const subCategories = mainChanged ? [] : keep(filters.subCategories, options.subCategories);

  if (
    accounts.length === filters.accounts.length &&
    !mainChanged &&
    subCategories.length === filters.subCategories.length
  ) {
    return filters;
  }
  return { ...filters, accounts, mainCategories, subCategories };
}

/**
 * Položky odpovídající filtrům (pořadí zachová). Účet odpovídá jako zdroj i cíl; hlavní
 * kategorie zahrne i položky svých podkategorií, vybraná podkategorie výsledek zúží jen na ni.
 * Hledání bere název i poznámku bez ohledu na velikost písmen.
 */
export function filterItems(items: Transaction[], filters: ItemFilters, categories: Category[]): Transaction[] {
  const search = filters.search.trim().toLowerCase();
  const childSubCategoryIds = filters.mainCategories.length === 0
    ? new Set<string>()
    : new Set(categories.filter(c => c.parentId && filters.mainCategories.includes(c.parentId)).map(c => c.id));

  return items.filter(tx => {
    if (search) {
      const matchTitle = tx.title.toLowerCase().includes(search);
      const matchNote = tx.note?.toLowerCase().includes(search);
      if (!matchTitle && !matchNote) return false;
    }
    if (filters.accounts.length > 0) {
      const matchesAccount = filters.accounts.includes(tx.sourceAccountId) ||
        (!!tx.targetAccountId && filters.accounts.includes(tx.targetAccountId));
      if (!matchesAccount) return false;
    }
    if (filters.mainCategories.length > 0) {
      if (filters.subCategories.length > 0) {
        const matchesSub = (!!tx.subcategoryId && filters.subCategories.includes(tx.subcategoryId)) ||
          (!!tx.categoryId && filters.subCategories.includes(tx.categoryId));
        if (!matchesSub) return false;
      } else {
        const matchesMain = !!tx.categoryId && filters.mainCategories.includes(tx.categoryId);
        const matchesChildSub = (!!tx.subcategoryId && childSubCategoryIds.has(tx.subcategoryId)) ||
          (!!tx.categoryId && childSubCategoryIds.has(tx.categoryId));
        if (!matchesMain && !matchesChildSub) return false;
      }
    }
    if (filters.types.length > 0 && !filters.types.includes(tx.type)) return false;
    if (filters.statuses.length > 0 && !filters.statuses.includes(tx.status)) return false;
    return true;
  });
}

/** Počet aktivních filtrů (hledání se počítá jako jeden). */
export function countActiveFilters(filters: ItemFilters): number {
  return [
    filters.search.trim(), filters.accounts, filters.mainCategories, filters.subCategories, filters.types, filters.statuses,
  ].filter(f => f.length > 0).length;
}

/**
 * Rozdíl korekce zůstatku: uložený rozdíl, jinak skutečný − vypočtený stav, jinak částka.
 */
export function getCorrectionDiffInHaler(tx: Transaction): number {
  return tx.diffInHaler ?? (
    tx.actualBalanceInHaler !== undefined && tx.calculatedBalanceInHaler !== undefined
      ? tx.actualBalanceInHaler - tx.calculatedBalanceInHaler
      : tx.amountInHaler
  );
}

/**
 * Znaménková částka položky ve výpisu: výdaj −, korekce podle rozdílu, příjem a převod +.
 * Používá efektivní částku (provedená skutečnou, ostatní plánovanou).
 */
export function getSignedItemAmountInHaler(tx: Transaction): number {
  if (tx.type === 'balance_adjustment') return getCorrectionDiffInHaler(tx);
  const amount = getEffectiveAmountInHaler(tx);
  return tx.type === 'expense' ? -amount : amount;
}

/** Součet vyfiltrovaných položek tak, jak je ukazuje výpis. */
export function sumItemsInHaler(items: Transaction[]): number {
  return items.reduce((sum, tx) => addHaler(sum, getSignedItemAmountInHaler(tx)), 0);
}
