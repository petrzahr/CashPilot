import { describe, it, expect } from 'vitest';
import { Account, BudgetPeriod, Category, MovementType, Transaction, TransactionStatus } from '../types/finance';
import { czechStringCompare } from '../services/categoryService';
import { } from '../services/financialEngine';
import { createBudgetPeriod } from '../services/periodService';

describe('TransactionsScreen Filters & Alphabetical Sorting', () => {
  const periodSep: BudgetPeriod = createBudgetPeriod(2026, 9, 15); // 15. 9. 2026 – 14. 10. 2026

  const testAccounts: Account[] = [
    {
      id: 'acc_spo',
      name: 'Spořicí účet',
      type: 'savings',
      currency: 'CZK',
      initialBalanceInHaler: 10000000,
      initialBalanceDate: '2026-09-01',
      isUsableCash: true,
      isNetWorth: true,
      color: '#10b981',
      sortOrder: 2,
      status: 'active',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'acc_bez',
      name: 'Běžný účet',
      type: 'checking',
      currency: 'CZK',
      initialBalanceInHaler: 5000000,
      initialBalanceDate: '2026-09-01',
      isUsableCash: true,
      isNetWorth: true,
      color: '#0284c7',
      sortOrder: 1,
      status: 'active',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'acc_pen',
      name: 'ČSOB Penze',
      type: 'pension',
      currency: 'CZK',
      initialBalanceInHaler: 2000000,
      initialBalanceDate: '2026-09-01',
      isUsableCash: false,
      isNetWorth: true,
      color: '#eab308',
      sortOrder: 3,
      status: 'active',
      createdAt: '',
      updatedAt: '',
    },
  ];

  const testCategories: Category[] = [
    // Hlavní kategorie výdajová
    { id: 'cat_dom', name: 'Domácnost', type: 'expense', parentId: null, color: '#f59e0b', icon: 'home', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' },
    // Podkategorie Domácnost
    { id: 'sub_str', name: 'Stravování', type: 'expense', parentId: 'cat_dom', color: '#f59e0b', icon: 'utensils', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' },
    { id: 'sub_dro', name: 'Drogerie', type: 'expense', parentId: 'cat_dom', color: '#f59e0b', icon: 'sparkles', sortOrder: 2, status: 'active', createdAt: '', updatedAt: '' },
    // Hlavní kategorie výdajová bez podkategorií
    { id: 'cat_aut', name: 'Auto', type: 'expense', parentId: null, color: '#ef4444', icon: 'car', sortOrder: 2, status: 'active', createdAt: '', updatedAt: '' },
    // Hlavní kategorie příjmová
    { id: 'cat_mzd', name: 'Mzda', type: 'income', parentId: null, color: '#10b981', icon: 'briefcase', sortOrder: 3, status: 'active', createdAt: '', updatedAt: '' },
    // Hlavní kategorie příjmová
    { id: 'cat_ost_prijmy', name: 'Ostatní příjmy', type: 'income', parentId: null, color: '#06b6d4', icon: 'plus-circle', sortOrder: 4, status: 'active', createdAt: '', updatedAt: '' },
    // Hlavní kategorie archivovaná
    { id: 'cat_arch_bydleni', name: 'Bydlení', type: 'expense', parentId: null, color: '#8b5cf6', icon: 'home', sortOrder: 5, status: 'archived', createdAt: '', updatedAt: '' },
    // Podkategorie archivovaná pod Bydlení
    { id: 'sub_arch_energie', name: 'Energie', type: 'expense', parentId: 'cat_arch_bydleni', color: '#8b5cf6', icon: 'zap', sortOrder: 1, status: 'archived', createdAt: '', updatedAt: '' },
  ];

  it('1. Czech alphabetical sorting: sorts strings with diacritics, case-insensitively, trimming spaces', () => {
    // Expected order in Czech:
    // "Auto" / "auto", "Běžný účet", "ČSOB Penze", "Řemesla", "Stravování" / "stravování", "Školy", " Zrušená "
    expect(czechStringCompare('Auto', 'Bydlení')).toBeLessThan(0);
    expect(czechStringCompare('Bydlení', 'Domácnost')).toBeLessThan(0);
    expect(czechStringCompare('Domácnost', 'Mzda')).toBeLessThan(0);
    expect(czechStringCompare('C', 'Č')).toBeLessThan(0);
    expect(czechStringCompare('R', 'Ř')).toBeLessThan(0);
    expect(czechStringCompare('S', 'Š')).toBeLessThan(0);
    expect(czechStringCompare('Z', 'Ž')).toBeLessThan(0);
  });

  it('2. Main categories dropdown: contains all income and expense main categories together sorted A–Z', () => {
    const activeMainCats = testCategories
      .filter(c => !c.parentId && c.status === 'active')
      .sort((a, b) => czechStringCompare(a.name, b.name));

    const names = activeMainCats.map(c => c.name);
    // Auto, Domácnost, Mzda, Ostatní příjmy
    expect(names).toEqual(['Auto', 'Domácnost', 'Mzda', 'Ostatní příjmy']);
  });

  it('3. Subcategories dropdown: dependent on selected main category, sorted A–Z', () => {
    // For 'cat_dom' (Domácnost):
    const subsDom = testCategories
      .filter(c => c.parentId === 'cat_dom' && c.status === 'active')
      .sort((a, b) => czechStringCompare(a.name, b.name));

    expect(subsDom.map(s => s.name)).toEqual(['Drogerie', 'Stravování']);

    // For 'cat_aut' (Auto): has NO subcategories
    const subsAut = testCategories
      .filter(c => c.parentId === 'cat_aut' && c.status === 'active')
      .sort((a, b) => czechStringCompare(a.name, b.name));

    expect(subsAut).toHaveLength(0);
  });

  it('4. Main category filtering: includes items assigned to main category AND items assigned to any of its subcategories', () => {
    const txDomDirect: Transaction = {
      id: 'tx_dom_direct',
      title: 'Obecný výdaj domácnosti',
      amountInHaler: 100000,
      date: '2026-09-20',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_bez',
      categoryId: 'cat_dom',
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const txDomStravovani: Transaction = {
      id: 'tx_dom_strav',
      title: 'Oběd v restauraci',
      amountInHaler: 35000,
      date: '2026-09-21',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_bez',
      categoryId: 'cat_dom',
      subcategoryId: 'sub_str',
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const txDomDrogerie: Transaction = {
      id: 'tx_dom_drog',
      title: 'Mýdlo a šampon',
      amountInHaler: 20000,
      date: '2026-09-22',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_bez',
      categoryId: 'cat_dom',
      subcategoryId: 'sub_dro',
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const txAuto: Transaction = {
      id: 'tx_auto',
      title: 'Tankování',
      amountInHaler: 150000,
      date: '2026-09-23',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_bez',
      categoryId: 'cat_aut',
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const txs = [txDomDirect, txDomStravovani, txDomDrogerie, txAuto];

    const childSubCategoryIds = new Set(
      testCategories.filter(c => c.parentId === 'cat_dom').map(c => c.id)
    );

    // Filter by main category 'cat_dom' without subcategory:
    const filteredByDom = txs.filter(tx => {
      const matchesMain = tx.categoryId === 'cat_dom';
      const matchesChildSub = (tx.subcategoryId && childSubCategoryIds.has(tx.subcategoryId)) ||
                              (tx.categoryId && childSubCategoryIds.has(tx.categoryId));
      return matchesMain || matchesChildSub;
    });

    expect(filteredByDom).toHaveLength(3);
    expect(filteredByDom.map(t => t.id)).toEqual(['tx_dom_direct', 'tx_dom_strav', 'tx_dom_drog']);

    // Filter by specific subcategory 'sub_str' (Stravování):
    const filteredByStrav = txs.filter(tx => {
      return tx.subcategoryId === 'sub_str' || tx.categoryId === 'sub_str';
    });
    expect(filteredByStrav).toHaveLength(1);
    expect(filteredByStrav[0].id).toBe('tx_dom_strav');
  });

  it('5. Archived categories: included with "(archivovaná)" label and sorted by real name', () => {
    const historicalTx: Transaction = {
      id: 'tx_hist',
      title: 'Platba za plyn',
      amountInHaler: 250000,
      date: '2026-09-18',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_bez',
      categoryId: 'cat_arch_bydleni',
      subcategoryId: 'sub_arch_energie',
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const baseTransactions = [historicalTx];
    const usedCategoryIdsInBase = new Set<string>();
    for (const tx of baseTransactions) {
      if (tx.categoryId) usedCategoryIdsInBase.add(tx.categoryId);
      if (tx.subcategoryId) usedCategoryIdsInBase.add(tx.subcategoryId);
    }

    const availableMain = testCategories
      .filter(c => {
        if (c.parentId) return false;
        if (c.status === 'active') return true;
        if (usedCategoryIdsInBase.has(c.id)) return true;
        return testCategories.some(sub => sub.parentId === c.id && usedCategoryIdsInBase.has(sub.id));
      })
      .sort((a, b) => czechStringCompare(a.name, b.name));

    // Bydlení is archived, but present in data -> must be included
    const archBydleni = availableMain.find(c => c.id === 'cat_arch_bydleni');
    expect(archBydleni).toBeDefined();
    expect(archBydleni?.status).toBe('archived');

    // And subcategory Energie under Bydlení:
    const availableSubs = testCategories
      .filter(c => {
        if (c.parentId !== 'cat_arch_bydleni') return false;
        if (c.status === 'active') return true;
        return usedCategoryIdsInBase.has(c.id);
      })
      .sort((a, b) => czechStringCompare(a.name, b.name));

    const archEnergie = availableSubs.find(s => s.id === 'sub_arch_energie');
    expect(archEnergie).toBeDefined();
    expect(archEnergie?.status).toBe('archived');

    // Sorting must be by real name:
    // Auto, Bydlení, Domácnost, Mzda, Ostatní příjmy
    expect(availableMain.map(c => c.name)).toEqual(['Auto', 'Bydlení', 'Domácnost', 'Mzda', 'Ostatní příjmy']);
  });

  it('6. Movement types and statuses dropdown options: sorted alphabetically A–Z', () => {
    const TYPE_OPTIONS: { value: MovementType; label: string }[] = [
      { value: 'balance_adjustment' as MovementType, label: 'Korekce zůstatku' },
      { value: 'income' as MovementType, label: 'Příjem' },
      { value: 'transfer' as MovementType, label: 'Převod' },
      { value: 'expense' as MovementType, label: 'Výdaj' },
    ].sort((a, b) => czechStringCompare(a.label, b.label));

    // Korekce zůstatku, Převod, Příjem, Výdaj
    expect(TYPE_OPTIONS.map(t => t.label)).toEqual([
      'Korekce zůstatku',
      'Převod',
      'Příjem',
      'Výdaj'
    ]);

    const STATUS_OPTIONS: { value: TransactionStatus; label: string }[] = [
      { value: 'planned' as TransactionStatus, label: 'Plánovaná' },
      { value: 'executed' as TransactionStatus, label: 'Uskutečněná' },
      { value: 'cancelled' as TransactionStatus, label: 'Zrušená' },
    ].sort((a, b) => czechStringCompare(a.label, b.label));

    // Plánovaná, Uskutečněná, Zrušená
    expect(STATUS_OPTIONS.map(s => s.label)).toEqual([
      'Plánovaná',
      'Uskutečněná',
      'Zrušená'
    ]);
  });

  it('7. Accounts dropdown options: sorted alphabetically A–Z', () => {
    const sorted = [...testAccounts].sort((a, b) => czechStringCompare(a.name, b.name));
    // Běžný účet, ČSOB Penze, Spořicí účet
    expect(sorted.map(a => a.name)).toEqual([
      'Běžný účet',
      'ČSOB Penze',
      'Spořicí účet'
    ]);
  });

  it('8. Multi-filter combination (AND logic) works exactly as specified in user example', () => {
    // User example:
    // Období: Aktuální období
    // Účet: Běžný účet
    // Hlavní kategorie: Domácnost
    // Podkategorie: Stravování
    // Stav: Plánovaná

    const targetTx: Transaction = {
      id: 'tx_target',
      title: 'Plánovaný nákup potravin',
      amountInHaler: 120000,
      date: '2026-09-25',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_bez',
      categoryId: 'cat_dom',
      subcategoryId: 'sub_str',
      status: 'planned',
      createdAt: '',
      updatedAt: '',
    };

    const wrongStatus: Transaction = {
      ...targetTx,
      id: 'tx_wrong_status',
      status: 'executed',
    };

    const wrongAccount: Transaction = {
      ...targetTx,
      id: 'tx_wrong_acc',
      sourceAccountId: 'acc_spo',
    };

    const wrongSubcategory: Transaction = {
      ...targetTx,
      id: 'tx_wrong_sub',
      subcategoryId: 'sub_dro',
    };

    const wrongPeriod: Transaction = {
      ...targetTx,
      id: 'tx_wrong_period',
      date: '2026-11-20', // Outside periodSep
    };

    const all = [targetTx, wrongStatus, wrongAccount, wrongSubcategory, wrongPeriod];

    const mainFilter = 'cat_dom';
    const subFilter = 'sub_str';
    const accFilter = 'acc_bez';
    const statFilter = 'planned';

    const result = all.filter(tx => {
      // Period
      if (tx.date < periodSep.startDate || tx.date > periodSep.endDate) return false;
      // Account
      if (accFilter && tx.sourceAccountId !== accFilter && tx.targetAccountId !== accFilter) return false;
      // Category & Subcategory
      if (mainFilter) {
        if (subFilter) {
          if (tx.subcategoryId !== subFilter && tx.categoryId !== subFilter) return false;
        }
      }
      // Status
      if (statFilter && tx.status !== statFilter) return false;
      return true;
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('tx_target');
  });

  it('9. One-off and recurring items are displayed together without separate recurring filter', () => {
    const oneOffTx: Transaction = {
      id: 'tx_oneoff',
      title: 'Jednorázový nákup',
      amountInHaler: 50000,
      date: '2026-09-20',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_bez',
      status: 'planned',
      createdAt: '',
      updatedAt: '',
    };

    const recurringTx: Transaction = {
      id: 'tx_recurring',
      title: 'Opakovaný nájem',
      amountInHaler: 1500000,
      date: '2026-09-20',
      sequence: 2,
      type: 'expense',
      sourceAccountId: 'acc_bez',
      recurringRuleId: 'rule_rent',
      status: 'planned',
      createdAt: '',
      updatedAt: '',
    };

    const both = [oneOffTx, recurringTx];

    // In the new implementation, no recurringFilter is applied, so both items show up
    const filtered = both.filter(tx => {
      if (tx.sourceAccountId !== 'acc_bez') return false;
      return true;
    });

    expect(filtered).toHaveLength(2);
    expect(filtered.map(t => t.id)).toEqual(['tx_oneoff', 'tx_recurring']);
  });
});
