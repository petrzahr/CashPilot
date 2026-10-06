import { describe, it, expect } from 'vitest';
import { calculateMandatoryOverview, getMonthlyFactor } from '../services/mandatoryExpensesService';
import { Account, Category, RecurringRule } from '../types/finance';

const today = '2026-10-06';

const acc = (id: string, name: string, type: Account['type']): Account => ({
  id, name, type, currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2025-01-01',
  isUsableCash: type === 'checking', isNetWorth: true, color: '#000000', sortOrder: 1, status: 'active',
  createdAt: '', updatedAt: '',
});

const cat = (id: string, name: string, type: Category['type'], parentId: string | null = null): Category => ({
  id, name, type, parentId, color: '#111111', icon: '', sortOrder: 0, status: 'active', createdAt: '', updatedAt: '',
});

const rule = (partial: Partial<RecurringRule>): RecurringRule => ({
  id: partial.id ?? 'r',
  title: 'Platba',
  amountInHaler: 0,
  type: 'expense',
  frequency: 'monthly',
  dayOfMonth: 20,
  startDate: '2026-01-20',
  sourceAccountId: 'chk',
  isActive: true,
  createdAt: '',
  updatedAt: '',
  ...partial,
});

describe('Mandatorní výdaje (calculateMandatoryOverview)', () => {
  const accounts = [acc('chk', 'Běžný', 'checking'), acc('sav', 'Spořicí', 'savings')];
  const categories = [
    cat('salary', 'Mzda', 'income'),
    cat('housing', 'Bydlení', 'expense'),
    cat('rent', 'Nájem', 'expense', 'housing'),
    cat('car', 'Auto', 'expense'),
  ];

  const rules = [
    rule({ id: 'salary', title: 'Výplata', type: 'income', categoryId: 'salary', amountInHaler: 9600000, dayOfMonth: 10 }),
    rule({ id: 'rent', title: 'Nájem', categoryId: 'housing', subcategoryId: 'rent', amountInHaler: 2200000 }),
    rule({ id: 'ins', title: 'Pojištění auta', categoryId: 'car', amountInHaler: 960000, frequency: 'annually', dayOfMonth: 15, startDate: '2026-03-15' }),
    rule({ id: 'gas', title: 'Záloha plyn', categoryId: 'housing', amountInHaler: 450000, frequency: 'quarterly', dayOfMonth: 20, startDate: '2026-01-20' }),
    rule({ id: 'save', title: 'Spoření', type: 'transfer', targetAccountId: 'sav', amountInHaler: 500000 }),
    rule({ id: 'ended', title: 'Skončená', amountInHaler: 100000, endDate: '2026-05-01' }),
    rule({ id: 'inactive', title: 'Neaktivní', amountInHaler: 100000, isActive: false }),
  ];

  const result = calculateMandatoryOverview(rules, categories, accounts, today, 15);

  it('přepočítá nepravidelné platby na měsíční a roční průměr', () => {
    const ins = result.expense.categories.flatMap((c) => c.items).find((i) => i.ruleId === 'ins')!;
    expect(ins.monthlyInHaler).toBe(80000);
    expect(ins.yearlyInHaler).toBe(960000);

    const gas = result.expense.categories.flatMap((c) => c.items).find((i) => i.ruleId === 'gas')!;
    expect(gas.monthlyInHaler).toBe(150000);
  });

  it('popíše, kdy se platba hradí', () => {
    const items = result.expense.categories.flatMap((c) => c.items);
    expect(items.find((i) => i.ruleId === 'rent')!.scheduleLabel).toBe('měsíčně, 20.');
    expect(items.find((i) => i.ruleId === 'ins')!.scheduleLabel).toBe('ročně, 15. 3.');
    expect(items.find((i) => i.ruleId === 'gas')!.scheduleLabel).toBe('čtvrtletně, 20. (led, dub, čvc, říj)');
  });

  it('vynechá neaktivní a skončené platby, seskupí podle kategorií abecedně a spočítá součty', () => {
    expect(result.expense.categories.map((c) => c.label)).toEqual(['Auto', 'Bydlení']);
    expect(result.expense.monthlyInHaler).toBe(2200000 + 80000 + 150000);
    expect(result.income.monthlyInHaler).toBe(9600000);
    expect(result.transfer.monthlyInHaler).toBe(500000);
    expect(result.transfer.categories[0].items[0].accountLabel).toBe('Běžný → Spořicí');
    expect(result.remainingMonthlyInHaler).toBe(9600000 - 2430000 - 500000);
    // Skutečně uspořeno = příjmy − výdaje na běžném účtu, bez převodů
    expect(result.actuallySavedMonthlyInHaler).toBe(9600000 - 2430000);
  });

  it('vlastní interval ve dnech přepočítá podle průměrné délky měsíce', () => {
    expect(getMonthlyFactor({ frequency: 'custom', intervalDays: 14 })).toBeCloseTo(365.25 / 12 / 14, 10);
  });
});
