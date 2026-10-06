import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createBudgetPeriodInfo } from '../services/analyticsEngine';
import { calculateCategoryBreakdown, NO_SUBCATEGORY_LABEL } from '../services/categoryBreakdownService';
import { createBudgetPeriod } from '../services/periodService';
import { Account, Category, Transaction } from '../types/finance';
import { CategoryBreakdownTable } from '../components/analytics/CategoryBreakdownTable';

const today = '2026-09-13';

const cat = (id: string, name: string, type: Category['type'], parentId: string | null = null): Category => ({
  id, name, type, parentId, color: '#000000', icon: '', sortOrder: 0, status: 'active', createdAt: '', updatedAt: '',
});

const acc = (id: string, name: string, type: Account['type']): Account => ({
  id, name, type, currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2025-01-01',
  isUsableCash: type === 'checking', isNetWorth: true, color: '#000000', sortOrder: 1, status: 'active',
  createdAt: '', updatedAt: '',
});

let txSeq = 0;
const tx = (partial: Partial<Transaction>): Transaction => ({
  id: `tx_${++txSeq}`,
  title: 'Položka',
  type: 'expense',
  status: 'executed',
  date: '2026-07-20',
  amountInHaler: 0,
  sourceAccountId: 'chk',
  createdAt: '',
  updatedAt: '',
  ...partial,
} as Transaction);

describe('Přehled podle kategorií (calculateCategoryBreakdown)', () => {
  const periods = [
    createBudgetPeriodInfo(createBudgetPeriod(2026, 7, 15), today),
    createBudgetPeriodInfo(createBudgetPeriod(2026, 8, 15), today),
  ];
  const accounts = [acc('chk', 'Běžný', 'checking'), acc('sav', 'Spořicí', 'savings')];
  const categories = [
    cat('salary', 'Mzda', 'income'),
    cat('housing', 'Bydlení', 'expense'),
    cat('rent', 'Nájem', 'expense', 'housing'),
    cat('energy', 'Energie', 'expense', 'housing'),
    cat('auto', 'Auto', 'expense'),
    cat('empty', 'Prázdná', 'expense'),
  ];

  const transactions = [
    tx({ type: 'income', categoryId: 'salary', amountInHaler: 9500000, date: '2026-07-20' }),
    tx({ type: 'income', categoryId: 'salary', amountInHaler: 9600000, date: '2026-08-20' }),
    tx({ categoryId: 'housing', subcategoryId: 'rent', amountInHaler: 2200000, date: '2026-07-21' }),
    tx({ categoryId: 'housing', subcategoryId: 'energy', amountInHaler: 600000, actualAmountInHaler: 650000, date: '2026-08-21' }),
    tx({ categoryId: 'housing', amountInHaler: 10000, date: '2026-08-22' }),
    tx({ categoryId: 'auto', amountInHaler: 100000, status: 'cancelled', date: '2026-07-22' }),
    tx({ categoryId: 'auto', amountInHaler: 300000, status: 'planned', date: '2026-09-10' }),
    tx({ type: 'transfer', targetAccountId: 'sav', amountInHaler: 1000000, actualAmountInHaler: 1200000, date: '2026-08-25' }),
  ];

  const result = calculateCategoryBreakdown(periods, transactions, [], [], categories, accounts, 15);

  it('řadí příjmové a pak výdajové kategorie abecedně, prázdné vynechá, převody na konec', () => {
    expect(result.rows.map((r) => r.label)).toEqual(['Mzda', 'Auto', 'Bydlení', 'Spoření & Převody']);
  });

  it('sčítá částky po obdobích, používá skutečnou částku a vynechává zrušené položky', () => {
    const housing = result.rows.find((r) => r.key === 'housing')!;
    expect(housing.amountsInHaler).toEqual([2200000, 660000]);
    expect(housing.children.map((c) => c.label)).toEqual(['Energie', 'Nájem', NO_SUBCATEGORY_LABEL]);

    const auto = result.rows.find((r) => r.key === 'auto')!;
    expect(auto.amountsInHaler).toEqual([0, 300000]);
  });

  it('počítá součty příjmů a výdajů a rozpad převodů podle cílového účtu', () => {
    expect(result.incomeTotalsInHaler).toEqual([9500000, 9600000]);
    expect(result.expenseTotalInHaler).toBe(2200000 + 660000 + 300000);

    // Provedený převod se počítá se skutečnou částkou
    const transfers = result.rows.find((r) => r.group === 'transfer')!;
    expect(transfers.amountsInHaler).toEqual([0, 1200000]);
    expect(transfers.children.map((c) => c.label)).toEqual(['Spořicí']);
  });

  it('tabulka se renderuje sbalená s přepínačem Rozbalit vše', () => {
    const html = renderToStaticMarkup(React.createElement(CategoryBreakdownTable, { periods, data: result }));
    expect(html).toContain('Přehled podle kategorií');
    expect(html).toContain('Rozbalit vše');
    expect(html).toContain('Příjmy celkem');
    expect(html).not.toContain('Nájem');
  });
});
