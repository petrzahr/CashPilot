import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FinanceProvider } from '../context/FinanceContext';
import { MandatoryExpensesScreen } from '../components/mandatory/MandatoryExpensesScreen';
import { calculateMandatoryOverview, getMonthlyFactor } from '../services/mandatoryExpensesService';
import { Account, Category, RecurringRule } from '../types/finance';
import { createBudgetPeriod } from '../services/periodService';

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
      // Navazující části téže platby se spojí do jedné změny
      expect(r.upcomingChanges.map((c) => [c.ruleId, c.kind, c.occurrenceDate, c.periodName])).toEqual([
        ['new', 'change', '2026-12-20', 'Prosinec 2026'],
      ]);
      expect(r.upcomingChanges[0].previous!.amountInHaler).toBe(600000);
    });

    it('změna uvnitř aktuálního období: počítá se už jen nová částka', () => {
      const r = calculateMandatoryOverview(split('2026-10-09', '2026-10-10'), categories, accounts, today, 15);
      expect(expenseIds(r)).toEqual(['new']);
    });

    it('změna přesně od začátku dalšího období (15. 10.): počítá se ještě stará částka', () => {
      const r = calculateMandatoryOverview(split('2026-10-14', '2026-10-15'), categories, accounts, today, 15);
      expect(expenseIds(r)).toEqual(['old']);
      expect(r.upcomingChanges.find((c) => c.kind === 'change')!.periodName).toBe('Říjen 2026');
    });

    it('rozdělení beze změny hodnot (např. kvůli pořadí v dni) se v nadcházejících změnách nezobrazí', () => {
      const r = calculateMandatoryOverview(
        [
          rule({ id: 'a', title: 'Netflix', amountInHaler: 30000, startDate: '2026-01-15', dayOfMonth: 15, endDate: '2027-05-14' }),
          rule({ id: 'b', title: 'Netflix', amountInHaler: 30000, startDate: '2027-05-15', dayOfMonth: 15 }),
        ],
        categories, accounts, today, 15
      );
      expect(r.upcomingChanges).toEqual([]);
      expect(r.expense.monthlyInHaler).toBe(30000);
    });

    it('přesun roční platby na jiný měsíc se zobrazí jako jedna změna termínu', () => {
      const r = calculateMandatoryOverview(
        [
          rule({ id: 'a', title: 'Daň z nemovitosti', amountInHaler: 280000, frequency: 'annually', startDate: '2026-09-15', dayOfMonth: 15, endDate: '2027-05-14' }),
          rule({ id: 'b', title: 'Daň z nemovitosti', amountInHaler: 280000, frequency: 'annually', startDate: '2027-05-15', dayOfMonth: 15 }),
        ],
        categories, accounts, today, 15
      );
      expect(r.upcomingChanges).toHaveLength(1);
      expect(r.upcomingChanges[0]).toMatchObject({ kind: 'change', occurrenceDate: '2027-05-15', scheduleLabel: 'ročně, 15. 5.' });
      expect(r.upcomingChanges[0].previous!.scheduleLabel).toBe('ročně, 15. 9.');
      // Stará část už další platbu nemá - nejbližší termín je z navazující části
      expect(r.expense.categories[0].items[0].nextDate).toBe('2027-05-15');
    });
  });

  it('přepočítá se podle vybraného období: roční platba od října je v září jen v nadcházejících, v říjnu už v součtech', () => {
    const october = [rule({ id: 'tax', title: 'Daň', amountInHaler: 1200000, frequency: 'annually', dayOfMonth: 20, startDate: '2026-10-20' })];

    const september = calculateMandatoryOverview(october, categories, accounts, today, 15);
    expect(september.periodName).toBe('Září 2026');
    expect(september.expense.monthlyInHaler).toBe(0);
    expect(september.upcomingChanges.map((c) => c.kind)).toEqual(['start']);

    const selected = calculateMandatoryOverview(october, categories, accounts, today, 15, undefined, createBudgetPeriod(2026, 10, 15));
    expect(selected.periodName).toBe('Říjen 2026');
    expect(selected.expense.monthlyInHaler).toBe(100000);
    expect(selected.expense.categories[0].items[0].nextDate).toBe('2026-10-20');
    expect(selected.upcomingChanges).toEqual([]);
  });

  describe('simulace', () => {
    const items = (r: ReturnType<typeof calculateMandatoryOverview>) => r.expense.categories.flatMap((c) => c.items);

    it('úprava částky a frekvence přepočítá průměry a zachová původní hodnoty', () => {
      const r = calculateMandatoryOverview(rules, categories, accounts, today, 15, {
        edits: { rent: { amountInHaler: 2400000, frequency: 'quarterly' } },
        deleted: [],
        added: [],
      });
      const rent = items(r).find((i) => i.ruleId === 'rent')!;
      expect(rent.simState).toBe('edited');
      expect(rent.monthlyInHaler).toBe(800000);
      expect(rent.original).toEqual({ title: 'Nájem', amountInHaler: 2200000, frequency: 'monthly' });
      expect(r.expense.monthlyInHaler).toBe(800000 + 80000 + 150000);
    });

    it('smazaná platba zůstane v seznamu, ale nezapočítá se', () => {
      const r = calculateMandatoryOverview(rules, categories, accounts, today, 15, { edits: {}, deleted: ['rent'], added: [] });
      expect(items(r).find((i) => i.ruleId === 'rent')!.simState).toBe('deleted');
      expect(r.expense.monthlyInHaler).toBe(80000 + 150000);
      expect(r.actuallySavedMonthlyInHaler).toBe(9600000 - 230000);
    });

    it('přidaná platba se započítá do své kategorie i do skutečně uspořeno', () => {
      const r = calculateMandatoryOverview(rules, categories, accounts, today, 15, {
        edits: {},
        deleted: [],
        added: [{ id: 'sim_1', title: 'Leasing', group: 'expense', categoryId: 'car', sourceAccountId: 'chk', amountInHaler: 500000, frequency: 'monthly' }],
      });
      const car = r.expense.categories.find((c) => c.key === 'car')!;
      expect(car.items.map((i) => i.title)).toEqual(['Leasing', 'Pojištění auta']);
      expect(car.monthlyInHaler).toBe(580000);
      expect(r.actuallySavedMonthlyInHaler).toBe(9600000 - 2430000 - 500000);
    });

    it('úprava na stejné hodnoty se jako změna nepočítá', () => {
      const r = calculateMandatoryOverview(rules, categories, accounts, today, 15, {
        edits: { rent: { title: 'Nájem', amountInHaler: 2200000, frequency: 'monthly' } },
        deleted: [],
        added: [],
      });
      expect(items(r).find((i) => i.ruleId === 'rent')!.simState).toBeUndefined();
    });
  });

  it('obrazovka se vykreslí s tlačítky Přidat a Obnovit výchozí stav', () => {
    const html = renderToStaticMarkup(
      React.createElement(FinanceProvider, null, React.createElement(MandatoryExpensesScreen))
    );
    expect(html).toContain('Obnovit výchozí stav');
    expect(html).toContain('Přidat');
    expect(html).toContain('Mandatorní výdaje / měsíc');
  });

  it('vlastní interval ve dnech přepočítá podle průměrné délky měsíce', () => {
    expect(getMonthlyFactor({ frequency: 'custom', intervalDays: 14 })).toBeCloseTo(365.25 / 12 / 14, 10);
  });
});
