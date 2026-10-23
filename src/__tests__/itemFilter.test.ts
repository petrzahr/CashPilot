import { describe, it, expect } from 'vitest';
import {
  EMPTY_ITEM_FILTERS,
  ItemFilters,
  countActiveFilters,
  filterItems,
  getCorrectionDiffInHaler,
  getFilterOptions,
  getSignedItemAmountInHaler,
  sanitizeFilters,
  sumItemsInHaler,
} from '../services/itemFilter';
import { Account, Category, Transaction } from '../types/finance';

const acc = (id: string, name: string, status: Account['status'] = 'active'): Account => ({
  id, name, type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01',
  isUsableCash: true, isNetWorth: true, color: '', sortOrder: 1, status, createdAt: '', updatedAt: '',
});
const cat = (id: string, name: string, parentId: string | null = null, status: Category['status'] = 'active'): Category => ({
  id, name, type: 'expense', parentId, color: '', icon: '', sortOrder: 1, status, createdAt: '', updatedAt: '',
});
let seq = 0;
const tx = (partial: Partial<Transaction>): Transaction => ({
  id: `tx${++seq}`, title: 'Položka', type: 'expense', status: 'planned', date: '2026-09-20', sequence: 1,
  amountInHaler: 1000, sourceAccountId: 'chk', createdAt: '', updatedAt: '', ...partial,
} as Transaction);
const filters = (partial: Partial<ItemFilters>): ItemFilters => ({ ...EMPTY_ITEM_FILTERS, ...partial });

const categories = [
  cat('home', 'Domácnost'), cat('food', 'Stravování', 'home'), cat('drug', 'Drogerie', 'home'),
  cat('car', 'Auto'), cat('fuel', 'Palivo', 'car'), cat('old', 'Bydlení', null, 'archived'), cat('gas', 'Plyn', 'old', 'archived'),
];

describe('filterItems', () => {
  const items = [
    tx({ id: 'direct', categoryId: 'home', title: 'Nákup', note: 'Lidl' }),
    tx({ id: 'food', categoryId: 'home', subcategoryId: 'food' }),
    tx({ id: 'drug', categoryId: 'home', subcategoryId: 'drug', status: 'executed' }),
    tx({ id: 'fuel', categoryId: 'car', subcategoryId: 'fuel', sourceAccountId: 'sav', type: 'income' }),
    tx({ id: 'toChk', type: 'transfer', sourceAccountId: 'sav', targetAccountId: 'chk' }),
  ];
  const ids = (f: Partial<ItemFilters>) => filterItems(items, filters(f), categories).map(t => t.id);

  it('bez výběru vrací vše v původním pořadí', () => {
    expect(ids({})).toEqual(['direct', 'food', 'drug', 'fuel', 'toChk']);
  });

  it('účet odpovídá jako zdroj i cíl', () => {
    expect(ids({ accounts: ['sav'] })).toEqual(['fuel', 'toChk']);
    expect(ids({ accounts: ['chk'] })).toEqual(['direct', 'food', 'drug', 'toChk']);
  });

  it('hlavní kategorie zahrne své podkategorie, výběr podkategorie výsledek zúží', () => {
    expect(ids({ mainCategories: ['home'] })).toEqual(['direct', 'food', 'drug']);
    expect(ids({ mainCategories: ['home', 'car'] })).toEqual(['direct', 'food', 'drug', 'fuel']);
    expect(ids({ mainCategories: ['home', 'car'], subCategories: ['food'] })).toEqual(['food']);
  });

  it('typ a stav platí jako OR, filtry mezi sebou jako AND', () => {
    expect(ids({ types: ['income', 'transfer'] })).toEqual(['fuel', 'toChk']);
    expect(ids({ statuses: ['executed'] })).toEqual(['drug']);
    expect(ids({ mainCategories: ['home'], statuses: ['planned'], accounts: ['chk'] })).toEqual(['direct', 'food']);
  });

  it('hledá v názvu i poznámce bez ohledu na velikost písmen', () => {
    expect(ids({ search: '  lidl ' })).toEqual(['direct']);
    expect(ids({ search: 'NÁKUP' })).toEqual(['direct']);
  });
});

describe('getFilterOptions', () => {
  const accounts = [acc('sav', 'Spořicí'), acc('chk', 'Běžný'), acc('arch', 'Archiv', 'archived'), acc('used', 'Účet starý', 'archived')];

  it('archivované účty a kategorie nabízí jen s použitím, vše řadí A–Z s diakritikou', () => {
    const options = getFilterOptions([tx({ sourceAccountId: 'used', categoryId: 'old', subcategoryId: 'gas' })], accounts, categories, []);
    expect(options.accounts.map(a => a.id)).toEqual(['chk', 'sav', 'used']);
    expect(options.mainCategories.map(c => c.name)).toEqual(['Auto', 'Bydlení', 'Domácnost']);
    expect(options.subCategories).toEqual([]);

    const unused = getFilterOptions([], accounts, categories, []);
    expect(unused.mainCategories.map(c => c.name)).toEqual(['Auto', 'Domácnost']);
  });

  it('podkategorie nabízí jen pro vybrané hlavní kategorie', () => {
    expect(getFilterOptions([], accounts, categories, ['home']).subCategories.map(c => c.name)).toEqual(['Drogerie', 'Stravování']);
  });
});

describe('sanitizeFilters', () => {
  const options = getFilterOptions([], [acc('chk', 'Běžný')], categories, ['home']);

  it('platný výběr vrací beze změny', () => {
    const f = filters({ accounts: ['chk'], mainCategories: ['home'], subCategories: ['food'] });
    expect(sanitizeFilters(f, options)).toBe(f);
  });

  it('neplatné hodnoty odstraní; zmizí-li hlavní kategorie, vyprázdní i podkategorie', () => {
    expect(sanitizeFilters(filters({ accounts: ['chk', 'gone'] }), options).accounts).toEqual(['chk']);
    expect(sanitizeFilters(filters({ mainCategories: ['home', 'gone'], subCategories: ['food'] }), options))
      .toMatchObject({ mainCategories: ['home'], subCategories: [] });
    expect(sanitizeFilters(filters({ mainCategories: ['home'], subCategories: ['food', 'fuel'] }), options).subCategories)
      .toEqual(['food']);
  });
});

describe('znaménková částka a součet', () => {
  it('výdaj −, příjem a převod +, provedená položka se skutečnou částkou', () => {
    expect(getSignedItemAmountInHaler(tx({ type: 'expense', status: 'executed', actualAmountInHaler: 1200 }))).toBe(-1200);
    expect(getSignedItemAmountInHaler(tx({ type: 'income' }))).toBe(1000);
    expect(getSignedItemAmountInHaler(tx({ type: 'transfer' }))).toBe(1000);
  });

  it('korekce podle uloženého rozdílu, jinak skutečný − vypočtený stav, jinak částka', () => {
    expect(getCorrectionDiffInHaler(tx({ type: 'balance_adjustment', diffInHaler: -300 }))).toBe(-300);
    expect(getCorrectionDiffInHaler(tx({ type: 'balance_adjustment', actualBalanceInHaler: 500, calculatedBalanceInHaler: 800 }))).toBe(-300);
    expect(getCorrectionDiffInHaler(tx({ type: 'balance_adjustment', amountInHaler: 70 }))).toBe(70);
  });

  it('součet sčítá znaménkové částky; počet filtrů bere hledání jako jeden', () => {
    expect(sumItemsInHaler([tx({ type: 'income', amountInHaler: 5000 }), tx({ amountInHaler: 1500 }), tx({ type: 'balance_adjustment', diffInHaler: -200 })]))
      .toBe(3300);
    expect(countActiveFilters(filters({ search: ' x ', types: ['income'] }))).toBe(2);
    expect(countActiveFilters(filters({ search: '   ' }))).toBe(0);
  });
});
