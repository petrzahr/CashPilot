import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MultiSelectDropdown } from '../components/shared/MultiSelectDropdown';
import { Account, AccountType, Category, Transaction } from '../types/finance';

describe('MultiSelectDropdown - popisek tlačítka podle výběru', () => {
  const options = [
    { value: 'a', label: 'Alfa' },
    { value: 'b', label: 'Beta' },
    { value: 'c', label: 'Gama' },
  ];

  it('zobrazí placeholder, když není nic vybráno (bez omezení)', () => {
    const html = renderToStaticMarkup(
      <MultiSelectDropdown options={options} selected={[]} onChange={vi.fn()} placeholder="Vše" />
    );
    expect(html).toContain('>Vše<');
  });

  it('zobrazí popisek jediné vybrané položky', () => {
    const html = renderToStaticMarkup(
      <MultiSelectDropdown options={options} selected={['b']} onChange={vi.fn()} placeholder="Vše" />
    );
    expect(html).toContain('>Beta<');
    expect(html).not.toContain('>Vše<');
  });

  it('při výběru více hodnot zobrazí jejich počet', () => {
    const html = renderToStaticMarkup(
      <MultiSelectDropdown options={options} selected={['a', 'c']} onChange={vi.fn()} placeholder="Vše" />
    );
    expect(html).toContain('Vybráno: 2');
  });

  it('v disabled stavu zobrazí disabledPlaceholder a tlačítko je vypnuté', () => {
    const html = renderToStaticMarkup(
      <MultiSelectDropdown
        options={[]}
        selected={[]}
        onChange={vi.fn()}
        placeholder="Vše"
        disabled
        disabledPlaceholder="Nejprve vyberte hlavní kategorii"
      />
    );
    expect(html).toContain('Nejprve vyberte hlavní kategorii');
    expect(html).toContain('disabled=""');
  });
});

/** Replikuje predikát filtru účtu z MonthlyBudgetScreen/TransactionsScreen (prázdný výběr = bez omezení, OR přes zdrojový i cílový účet). */
function matchesAccountFilter(tx: Transaction, filterAccounts: string[]): boolean {
  if (filterAccounts.length === 0) return true;
  return filterAccounts.includes(tx.sourceAccountId) ||
         (!!tx.targetAccountId && filterAccounts.includes(tx.targetAccountId));
}

/** Replikuje predikát filtru kategorie/podkategorie (multi-select hlavní kategorie i podkategorie). */
function matchesCategoryFilter(
  tx: Transaction,
  filterMainCategories: string[],
  filterSubCategories: string[],
  childSubCategoryIds: Set<string>,
): boolean {
  if (filterMainCategories.length === 0) return true;
  if (filterSubCategories.length > 0) {
    return (!!tx.subcategoryId && filterSubCategories.includes(tx.subcategoryId)) ||
           (!!tx.categoryId && filterSubCategories.includes(tx.categoryId));
  }
  const matchesMain = !!tx.categoryId && filterMainCategories.includes(tx.categoryId);
  const matchesChildSub = (!!tx.subcategoryId && childSubCategoryIds.has(tx.subcategoryId)) ||
                          (!!tx.categoryId && childSubCategoryIds.has(tx.categoryId));
  return matchesMain || matchesChildSub;
}

let txSeq = 0;
const makeTx = (overrides: Partial<Transaction> & Pick<Transaction, 'sourceAccountId'>): Transaction => ({
  id: `tx${txSeq++}`, title: 'Test', amountInHaler: 1000, date: '2026-09-16', sequence: 1,
  type: 'expense', status: 'planned', createdAt: '', updatedAt: '',
  ...overrides,
});

describe('Filtr účtu - multi-select (OR přes vybrané účty)', () => {
  it('bez výběru procházejí všechny položky', () => {
    const tx = makeTx({ sourceAccountId: 'acc_a' });
    expect(matchesAccountFilter(tx, [])).toBe(true);
  });

  it('vybere položky ze zdrojového i cílového účtu, a jen z vybraných účtů', () => {
    const txFromA = makeTx({ sourceAccountId: 'acc_a' });
    const txFromB = makeTx({ sourceAccountId: 'acc_b' });
    const txFromC = makeTx({ sourceAccountId: 'acc_c' });
    const txTransferToA = makeTx({ sourceAccountId: 'acc_b', type: 'transfer', targetAccountId: 'acc_a' });

    const selected = ['acc_a', 'acc_c'];
    expect(matchesAccountFilter(txFromA, selected)).toBe(true);
    expect(matchesAccountFilter(txFromC, selected)).toBe(true);
    expect(matchesAccountFilter(txFromB, selected)).toBe(false);
    // Převod na vybraný cílový účet acc_a musí procházet, i když zdroj (acc_b) není vybraný.
    expect(matchesAccountFilter(txTransferToA, selected)).toBe(true);
  });
});

describe('Filtr kategorie/podkategorie - multi-select', () => {
  const mainCat1: Category = { id: 'main1', name: 'Domácnost', type: 'expense', parentId: null, color: '', icon: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' };
  const mainCat2: Category = { id: 'main2', name: 'Auto', type: 'expense', parentId: null, color: '', icon: '', sortOrder: 2, status: 'active', createdAt: '', updatedAt: '' };
  const mainCat3: Category = { id: 'main3', name: 'Mzda', type: 'income', parentId: null, color: '', icon: '', sortOrder: 3, status: 'active', createdAt: '', updatedAt: '' };
  const sub1a: Category = { id: 'sub1a', name: 'Stravování', type: 'expense', parentId: 'main1', color: '', icon: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' };
  const sub2a: Category = { id: 'sub2a', name: 'Palivo', type: 'expense', parentId: 'main2', color: '', icon: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' };
  const categories = [mainCat1, mainCat2, mainCat3, sub1a, sub2a];

  const childSubCategoryIds = (mainIds: string[]) =>
    new Set(categories.filter(c => c.parentId && mainIds.includes(c.parentId)).map(c => c.id));

  it('bez výběru hlavní kategorie procházejí všechny položky', () => {
    const tx = makeTx({ sourceAccountId: 'acc', categoryId: 'main3' });
    expect(matchesCategoryFilter(tx, [], [], new Set())).toBe(true);
  });

  it('výběr dvou hlavních kategorií zahrne přímé položky i položky jejich podkategorií (sjednocení)', () => {
    const txDirectMain1 = makeTx({ sourceAccountId: 'acc', categoryId: 'main1' });
    const txSub1a = makeTx({ sourceAccountId: 'acc', categoryId: 'main1', subcategoryId: 'sub1a' });
    const txSub2a = makeTx({ sourceAccountId: 'acc', categoryId: 'main2', subcategoryId: 'sub2a' });
    const txOtherMain = makeTx({ sourceAccountId: 'acc', categoryId: 'main3' });

    const selectedMains = ['main1', 'main2'];
    const childIds = childSubCategoryIds(selectedMains);

    expect(matchesCategoryFilter(txDirectMain1, selectedMains, [], childIds)).toBe(true);
    expect(matchesCategoryFilter(txSub1a, selectedMains, [], childIds)).toBe(true);
    expect(matchesCategoryFilter(txSub2a, selectedMains, [], childIds)).toBe(true);
    expect(matchesCategoryFilter(txOtherMain, selectedMains, [], childIds)).toBe(false);
  });

  it('výběr konkrétních podkategorií zúží výsledek jen na ně, i když je vybráno více hlavních kategorií', () => {
    const txSub1a = makeTx({ sourceAccountId: 'acc', categoryId: 'main1', subcategoryId: 'sub1a' });
    const txSub2a = makeTx({ sourceAccountId: 'acc', categoryId: 'main2', subcategoryId: 'sub2a' });
    const txDirectMain1 = makeTx({ sourceAccountId: 'acc', categoryId: 'main1' });

    const selectedMains = ['main1', 'main2'];
    const selectedSubs = ['sub1a'];
    const childIds = childSubCategoryIds(selectedMains);

    expect(matchesCategoryFilter(txSub1a, selectedMains, selectedSubs, childIds)).toBe(true);
    expect(matchesCategoryFilter(txSub2a, selectedMains, selectedSubs, childIds)).toBe(false);
    // Přímá položka hlavní kategorie bez podkategorie neodpovídá vybrané konkrétní podkategorii.
    expect(matchesCategoryFilter(txDirectMain1, selectedMains, selectedSubs, childIds)).toBe(false);
  });
});

describe('Filtr typu a stavu - multi-select (OR přes vybrané hodnoty)', () => {
  it('bez výběru procházejí všechny typy/stavy', () => {
    const filterTypes: string[] = [];
    const tx = makeTx({ sourceAccountId: 'acc', type: 'expense' });
    expect(filterTypes.length === 0 || filterTypes.includes(tx.type)).toBe(true);
  });

  it('výběr více typů zahrne položky odpovídající kterémukoli z nich', () => {
    const filterTypes = ['income', 'transfer'];
    const txIncome = makeTx({ sourceAccountId: 'acc', type: 'income' });
    const txTransfer = makeTx({ sourceAccountId: 'acc', type: 'transfer' });
    const txExpense = makeTx({ sourceAccountId: 'acc', type: 'expense' });

    expect(filterTypes.includes(txIncome.type)).toBe(true);
    expect(filterTypes.includes(txTransfer.type)).toBe(true);
    expect(filterTypes.includes(txExpense.type)).toBe(false);
  });

  it('výběr více stavů zahrne položky odpovídající kterémukoli z nich', () => {
    const filterStatuses = ['planned', 'cancelled'];
    const txPlanned = makeTx({ sourceAccountId: 'acc', status: 'planned' });
    const txCancelled = makeTx({ sourceAccountId: 'acc', status: 'cancelled' });
    const txExecuted = makeTx({ sourceAccountId: 'acc', status: 'executed' });

    expect(filterStatuses.includes(txPlanned.status)).toBe(true);
    expect(filterStatuses.includes(txCancelled.status)).toBe(true);
    expect(filterStatuses.includes(txExecuted.status)).toBe(false);
  });
});

describe('AccountsScreen - multi-select filtr typu účtu', () => {
  const makeAccount = (id: string, type: AccountType): Account => ({
    id, name: id, type, currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01',
    isUsableCash: false, isNetWorth: true, color: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '',
  });

  const accounts = [
    makeAccount('a1', 'checking'),
    makeAccount('a2', 'savings'),
    makeAccount('a3', 'investment'),
    makeAccount('a4', 'pension'),
  ];

  it('bez výběru zobrazuje všechny typy účtů', () => {
    const typeFilters: AccountType[] = [];
    const result = accounts.filter(a => typeFilters.length === 0 || typeFilters.includes(a.type));
    expect(result).toHaveLength(4);
  });

  it('výběr více typů zobrazí účty odpovídající kterémukoli z nich', () => {
    const typeFilters: AccountType[] = ['savings', 'investment'];
    const result = accounts.filter(a => typeFilters.length === 0 || typeFilters.includes(a.type));
    expect(result.map(a => a.id)).toEqual(['a2', 'a3']);
  });
});
