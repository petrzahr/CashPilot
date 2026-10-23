import { useCallback, useEffect, useMemo, useState } from 'react';
import { Account, Category, Transaction } from '../types/finance';
import {
  EMPTY_ITEM_FILTERS,
  ItemFilters,
  countActiveFilters,
  filterItems,
  getFilterOptions,
  sanitizeFilters,
  sumItemsInHaler,
} from '../services/itemFilter';

/**
 * Stav filtrů seznamu položek nad modulem itemFilter (Měsíční rozpočet, Všechny položky).
 * Vrací nabídky, vyfiltrované položky v původním pořadí a jejich součet; výběr, který
 * přestal být platný, se sám ořeže. Změna hlavních kategorií vyprázdní výběr podkategorií.
 */
export function useItemFilters(items: Transaction[], accounts: Account[], categories: Category[]) {
  const [filters, setFilters] = useState<ItemFilters>(EMPTY_ITEM_FILTERS);

  const options = useMemo(
    () => getFilterOptions(items, accounts, categories, filters.mainCategories),
    [items, accounts, categories, filters.mainCategories]
  );

  useEffect(() => {
    setFilters(prev => sanitizeFilters(prev, options));
  }, [options]);

  const filtered = useMemo(() => filterItems(items, filters, categories), [items, filters, categories]);
  const sumInHaler = useMemo(() => sumItemsInHaler(filtered), [filtered]);

  const update = useCallback(<K extends keyof ItemFilters>(key: K, value: ItemFilters[K]) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  return {
    filters,
    options,
    filtered,
    sumInHaler,
    activeCount: countActiveFilters(filters),
    setSearch: useCallback((search: string) => update('search', search), [update]),
    setAccounts: useCallback((ids: string[]) => update('accounts', ids), [update]),
    setMainCategories: useCallback((ids: string[]) => setFilters(prev => ({ ...prev, mainCategories: ids, subCategories: [] })), []),
    setSubCategories: useCallback((ids: string[]) => update('subCategories', ids), [update]),
    setTypes: useCallback((ids: string[]) => update('types', ids), [update]),
    setStatuses: useCallback((ids: string[]) => update('statuses', ids), [update]),
    clear: useCallback(() => setFilters(EMPTY_ITEM_FILTERS), []),
  };
}
