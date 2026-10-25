import { describe, it, expect } from 'vitest';
import { Account, Category, Transaction } from '../types/finance';
import { buildItemRow, formatAccountPath, formatCategoryPath, formatItemAmount } from '../services/itemRow';
import { formatCurrency } from '../services/currencyService';

const account = (id: string, name: string): Account => ({
  id, name, type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01',
  isUsableCash: true, isNetWorth: true, color: '#0284c7', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '',
});

const accounts = [account('acc_a', 'Běžný účet'), account('acc_b', 'Spořicí účet')];

const categories: Category[] = [
  { id: 'cat_dom', name: 'Domácnost', type: 'expense', parentId: null, color: '#f59e0b', icon: 'home', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' },
  { id: 'sub_str', name: 'Stravování', type: 'expense', parentId: 'cat_dom', color: '#f59e0b', icon: 'utensils', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' },
];

const tx = (overrides: Partial<Transaction>): Transaction => ({
  id: 'tx_1', title: 'Položka', amountInHaler: 10000, date: '2026-10-01', sequence: 1, type: 'expense',
  sourceAccountId: 'acc_a', status: 'planned', createdAt: '', updatedAt: '', ...overrides,
});

const ctx = { accounts, categories };

describe('itemRow', () => {
  it('signs income +, expense − and leaves a transfer unsigned', () => {
    const income = buildItemRow(tx({ type: 'income' }), ctx).amount;
    const expense = buildItemRow(tx({ type: 'expense' }), ctx).amount;
    const transfer = buildItemRow(tx({ type: 'transfer', targetAccountId: 'acc_b' }), ctx).amount;

    expect(income).toMatchObject({ sign: '+', tone: 'positive' });
    expect(expense).toMatchObject({ sign: '−', tone: 'negative' });
    expect(transfer).toMatchObject({ sign: '', tone: 'neutral' });
    expect(formatItemAmount(expense)).toBe(`−${formatCurrency(10000)}`);
  });

  it('uses the effective amount: actual when executed, planned otherwise', () => {
    expect(buildItemRow(tx({ status: 'executed', actualAmountInHaler: 12000 }), ctx).amount.valueInHaler).toBe(12000);
    expect(buildItemRow(tx({ status: 'planned', actualAmountInHaler: 12000 }), ctx).amount.valueInHaler).toBe(10000);
  });

  it('shows a correction as its signed diff with a plus sign', () => {
    const up = buildItemRow(tx({ type: 'balance_adjustment', diffInHaler: 500 }), ctx);
    const down = buildItemRow(tx({ type: 'balance_adjustment', diffInHaler: -500 }), ctx);
    const derived = buildItemRow(tx({ type: 'balance_adjustment', actualBalanceInHaler: 900, calculatedBalanceInHaler: 1000 }), ctx);

    expect(up.isCorrection).toBe(true);
    expect(up.amount.tone).toBe('positive');
    expect(formatItemAmount(up.amount)).toBe(formatCurrency(500, { showPlus: true }));
    expect(down.amount.tone).toBe('negative');
    expect(derived.amount.valueInHaler).toBe(-100);
  });

  it('signs a transfer from the perspective account', () => {
    const transfer = tx({ type: 'transfer', sourceAccountId: 'acc_a', targetAccountId: 'acc_b' });
    expect(buildItemRow(transfer, { ...ctx, perspectiveAccountId: 'acc_b' }).amount).toMatchObject({ sign: '+', tone: 'neutral' });
    expect(buildItemRow(transfer, { ...ctx, perspectiveAccountId: 'acc_a' }).amount).toMatchObject({ sign: '−', tone: 'neutral' });
  });

  it('labels the category with fallbacks', () => {
    const withSub = buildItemRow(tx({ categoryId: 'cat_dom', subcategoryId: 'sub_str' }), ctx).category;
    expect(withSub).toEqual({ kind: 'category', name: 'Domácnost', subName: 'Stravování', color: '#f59e0b' });
    if (withSub.kind === 'category') expect(formatCategoryPath(withSub)).toBe('Domácnost › Stravování');

    expect(buildItemRow(tx({ type: 'balance_adjustment', categoryId: 'cat_dom' }), ctx).category.kind).toBe('correction');
    expect(buildItemRow(tx({ type: 'transfer', targetAccountId: 'acc_b' }), ctx).category).toEqual({ kind: 'transfer', label: 'Převod' });
    expect(buildItemRow(tx({ categoryId: 'missing' }), ctx).category).toEqual({ kind: 'none', label: 'Bez kategorie' });
  });

  it('labels accounts as source → target', () => {
    expect(formatAccountPath(buildItemRow(tx({ type: 'transfer', targetAccountId: 'acc_b' }), ctx))).toBe('Běžný účet → Spořicí účet');
    expect(formatAccountPath(buildItemRow(tx({}), ctx))).toBe('Běžný účet');
    expect(formatAccountPath(buildItemRow(tx({ sourceAccountId: 'missing', targetAccountId: 'acc_b' }), ctx))).toBeNull();
  });

  it('flags cancelled, recurring and conflicting items', () => {
    const item = tx({ status: 'cancelled', recurringRuleId: 'rule_1' });
    const row = buildItemRow(item, { ...ctx, conflicts: [{ transaction: item, reason: 'Před založením účtu' }] });
    expect(row).toMatchObject({ isCancelled: true, isRecurring: true, conflict: { reason: 'Před založením účtu' } });
    expect(buildItemRow(tx({}), ctx).conflict).toBeNull();
  });
});
