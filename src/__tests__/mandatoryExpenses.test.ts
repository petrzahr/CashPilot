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

  describe('trvalá změna platby (rozdělení na starou a novou větev)', () => {
    // Období začínají 15. dnem: dnešek 6. 10. 2026 patří do období Září 2026 (15. 9. – 14. 10.)
    const split = (oldEnd: string, newStart: string) => [
      rule({ id: 'old', title: 'Pojištění', amountInHaler: 600000, startDate: '2026-03-20', endDate: oldEnd }),
      rule({ id: 'new', title: 'Pojištění', amountInHaler: 700000, startDate: newStart, dayOfMonth: parseInt(newStart.slice(8), 10) }),
    ];
    const expenseIds = (r: ReturnType<typeof calculateMandatoryOverview>) =>
      r.expense.categories.flatMap((c) => c.items).map((i) => i.ruleId);

    it('změna od prosince: v září se počítá jen stará částka, změna je v nadcházejících', () => {
      const r = calculateMandatoryOverview(split('2026-12-19', '2026-12-20'), categories, accounts, today, 15);
      expect(r.periodName).toBe('Září 2026');
      expect(expenseIds(r)).toEqual(['old']);
      expect(r.expense.monthlyInHaler).toBe(600000);
      expect(r.upcomingChanges.map((c) => [c.ruleId, c.kind, c.occurrenceDate, c.periodName])).toEqual([
        ['old', 'end', '2026-11-20', 'Listopad 2026'],
        ['new', 'start', '2026-12-20', 'Prosinec 2026'],
      ]);
    });

    it('změna uvnitř aktuálního období: počítá se už jen nová částka', () => {
      const r = calculateMandatoryOverview(split('2026-10-09', '2026-10-10'), categories, accounts, today, 15);
      expect(expenseIds(r)).toEqual(['new']);
    });

    it('změna přesně od začátku dalšího období (15. 10.): počítá se ještě stará částka', () => {
      const r = calculateMandatoryOverview(split('2026-10-14', '2026-10-15'), categories, accounts, today, 15);
      expect(expenseIds(r)).toEqual(['old']);
      expect(r.upcomingChanges.find((c) => c.kind === 'start')!.periodName).toBe('Říjen 2026');
    });
  });

  it('vlastní interval ve dnech přepočítá podle průměrné délky měsíce', () => {
    expect(getMonthlyFactor({ frequency: 'custom', intervalDays: 14 })).toBeCloseTo(365.25 / 12 / 14, 10);
  });
});
