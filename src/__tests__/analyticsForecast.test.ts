import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CashFlowCompositionChart } from '../components/analytics/CashFlowCompositionChart';
import {
  calculateCashFlowComposition,
  calculateExpenseMoMTrend,
  calculateFinancialExtremes,
  calculateMonthlyCashFlow,
  generateBudgetPeriodSequence,
  getTopExpenses,
} from '../services/analyticsEngine';
import { summarizePeriods } from '../services/financialEngine';
import { createBudgetPeriod, getPreviousPeriod } from '../services/periodService';
import { Account, RecurringRule, Transaction } from '../types/finance';

// Rozpočtová období od 15.; dnes běží září 2026 (15. 9. – 14. 10.)
const today = '2026-09-20';
const periods = generateBudgetPeriodSequence(createBudgetPeriod(2026, 7, 15), createBudgetPeriod(2026, 10, 15), today);
const [jul, aug, sep, oct] = periods.map((p) => p.key);

const checking: Account = {
  id: 'chk', name: 'Běžný', type: 'checking', currency: 'CZK',
  initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01',
  isUsableCash: true, isNetWorth: true, isDefault: true,
  color: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '',
};
const other: Account = { ...checking, id: 'chk2', name: 'Jiný', isDefault: false };

let seq = 0;
const tx = (overrides: Partial<Transaction> & Pick<Transaction, 'type' | 'amountInHaler' | 'date' | 'status'>): Transaction => ({
  id: `t${++seq}`, title: `Položka ${seq}`, sequence: 1, sourceAccountId: 'chk', createdAt: '', updatedAt: '',
  ...overrides,
});

const rent: RecurringRule = {
  id: 'rent', title: 'Nájem', type: 'expense', amountInHaler: 12000, sourceAccountId: 'chk',
  dayOfMonth: 20, frequency: 'monthly', startDate: '2026-01-20', isActive: true, createdAt: '', updatedAt: '',
};

const transactions: Transaction[] = [
  tx({ type: 'income', amountInHaler: 50000, date: '2026-07-20', status: 'executed' }),
  tx({ type: 'expense', amountInHaler: 20000, date: '2026-07-25', status: 'executed' }),
  tx({ type: 'income', amountInHaler: 60000, date: '2026-08-20', status: 'executed' }),
  tx({ type: 'expense', amountInHaler: 45000, date: '2026-08-25', status: 'executed' }),
  tx({ type: 'balance_adjustment', amountInHaler: 1000, diffInHaler: -1000, date: '2026-08-30', status: 'executed' }),
  tx({ type: 'income', amountInHaler: 70000, date: '2026-09-16', status: 'executed' }),
  tx({ type: 'expense', amountInHaler: 5000, date: '2026-09-18', status: 'executed' }),
  tx({ type: 'expense', amountInHaler: 30000, date: '2026-10-01', status: 'planned', title: 'Pojistka' }),
  tx({ type: 'income', amountInHaler: 10000, date: '2026-10-10', status: 'planned' }),
  tx({ type: 'expense', amountInHaler: 99000, date: '2026-10-11', status: 'cancelled' }),
  tx({ type: 'expense', amountInHaler: 88000, date: '2026-09-17', status: 'executed', sourceAccountId: 'chk2' }),
];

const forecast = summarizePeriods(
  [getPreviousPeriod(periods[0].period), ...periods.map((p) => p.period)],
  { accounts: [checking, other], transactions, recurringRules: [rent] },
  { today }
);

describe('Analýza z předpovědi: všechna čísla období se shodují s KPI Měsíčního rozpočtu', () => {
  const cashFlow = calculateMonthlyCashFlow(periods, forecast, today);
  const composition = calculateCashFlowComposition(periods, forecast, today);
  const trend = calculateExpenseMoMTrend(periods, forecast);

  it('bar, finanční přehled i trend mají pro každé období příjmy, výdaje a Skutečně uspořeno z PeriodView.defaultAccount', () => {
    periods.forEach((p, i) => {
      const kpi = forecast.getPeriod(p.key)!.defaultAccount;
      expect(cashFlow[i]).toMatchObject({
        incomeInHaler: kpi.incomeInHaler,
        expenseInHaler: kpi.expenseInHaler,
        actuallySavedInHaler: kpi.actuallySavedInHaler,
      });
      const byKey = Object.fromEntries(composition[i].segments.map((s) => [s.key, s.amountInHaler]));
      expect(byKey).toEqual({ income: kpi.incomeInHaler, expense: kpi.expenseInHaler, actuallySaved: kpi.actuallySavedInHaler });
      expect(trend[i].expenseInHaler).toBe(kpi.expenseInHaler);
    });
  });

  it('počítá opakované výskyty i plán probíhajícího a budoucího období, bez cizích účtů a zrušených položek', () => {
    expect(cashFlow.map((c) => c.expenseInHaler)).toEqual([32000, 57000, 47000, 12000]);
    expect(cashFlow.map((c) => c.incomeInHaler)).toEqual([50000, 60000, 80000, 0]);
    // korekce je součástí Skutečně uspořeno
    expect(cashFlow[1].actuallySavedInHaler).toBe(60000 - 57000 - 1000);
    expect(cashFlow[1].correctionsInHaler).toBe(-1000);
  });

  it('rozděluje probíhající a budoucí období na uskutečněnou a plánovanou část, minulá jsou celá uskutečněná', () => {
    expect(cashFlow.map((c) => c.hasPlanned)).toEqual([false, false, true, true]);
    expect(cashFlow.map((c) => c.isClosed)).toEqual([true, true, false, false]);
    // září: nájem 20. 9. je dnes, proto už uskutečněný; plánovaná je pojistka a příjem 10 000
    expect(cashFlow[2].planned).toEqual({ incomeInHaler: 10000, expenseInHaler: 30000, actuallySavedInHaler: -20000 });
    expect(cashFlow[3].planned).toEqual({ incomeInHaler: 0, expenseInHaler: 12000, actuallySavedInHaler: -12000 });
  });

  it('šrafuje plánovaný podíl příjmů a výdajů a celé Skutečně uspořeno období s plánem', () => {
    const seg = (i: number, key: string) => composition[i].segments.find((s) => s.key === key)!;
    expect(seg(2, 'expense').plannedPct).toBeCloseTo(seg(2, 'expense').pct! * (30000 / 47000), 6);
    expect(seg(2, 'income').plannedPct).toBeCloseTo(seg(2, 'income').pct! * (10000 / 80000), 6);
    expect(seg(2, 'actuallySaved').plannedPct).toBe(seg(2, 'actuallySaved').pct);
    expect(seg(2, 'actuallySaved').split).toEqual({ executedLabel: 'dosud', executedInHaler: 53000, plannedInHaler: -20000, correctionsInHaler: 0 });
    expect(composition[1].segments.every((s) => s.plannedPct === 0)).toBe(true);
    expect(seg(1, 'actuallySaved').split.correctionsInHaler).toBe(-1000);
  });

  it('trend srovnává s celým předchozím obdobím a nese plánovanou část výdajů', () => {
    expect(trend[2]).toMatchObject({ prevMonthExpenseInHaler: 57000, plannedExpenseInHaler: 30000 });
    expect(trend[2].changePercent).toBeCloseTo(((47000 - 57000) / 57000) * 100, 6);
    // období před začátkem předpovědi není k dispozici
    const outside = calculateExpenseMoMTrend(generateBudgetPeriodSequence(createBudgetPeriod(2020, 1, 15), createBudgetPeriod(2020, 1, 15), today), forecast);
    expect(outside[0]).toMatchObject({ expenseInHaler: 0, prevMonthExpenseInHaler: null, changePercent: null });
  });
});

describe('Finanční extrémy a průměry jen z uzavřených období', () => {
  it('ignoruje probíhající a budoucí období', () => {
    const extremes = calculateFinancialExtremes(calculateMonthlyCashFlow(periods, forecast, today));
    expect(extremes.closedPeriodCount).toBe(2);
    expect(extremes.highestIncomeMonth).toMatchObject({ monthKey: aug, amountInHaler: 60000 });
    expect(extremes.highestExpenseMonth).toMatchObject({ monthKey: aug, amountInHaler: 57000 });
    expect(extremes.mostSavedMonth).toMatchObject({ monthKey: jul, amountInHaler: 18000 });
    expect(extremes.leastSavedMonth).toMatchObject({ monthKey: aug, amountInHaler: 2000 });
    expect(extremes.avgMonthlyIncomeInHaler).toBe(55000);
    expect(extremes.avgMonthlyActuallySavedInHaler).toBe(10000);
  });

  it('bez uzavřeného období nemá extrémy ani průměry', () => {
    const extremes = calculateFinancialExtremes(calculateMonthlyCashFlow(periods.slice(2), forecast, today));
    expect(extremes).toMatchObject({ highestIncomeMonth: null, mostSavedMonth: null, closedPeriodCount: 0, avgMonthlyIncomeInHaler: 0 });
  });
});

describe('Finanční přehled: vykreslení plánované části', () => {
  const render = (data: ReturnType<typeof calculateCashFlowComposition>) =>
    renderToStaticMarkup(createElement(CashFlowCompositionChart, { data }));

  it('šrafuje plánovanou část, ukáže legendu a označí období s plánem v tabulce', () => {
    const html = render(calculateCashFlowComposition(periods, forecast, today));
    expect(html).toContain('<pattern');
    expect(html).toMatch(/fill="url\(#hatch-[\w-]+\)"/);
    expect(html).toContain('Uskutečněno');
    expect(html).toContain('Plánováno');
    expect(html.match(/title="Obsahuje plánované položky"/g)).toHaveLength(2);
  });

  it('bez plánu je graf beze změny (bez šrafování a legendy)', () => {
    const html = render(calculateCashFlowComposition(periods.slice(0, 2), forecast, today));
    expect(html).not.toContain('<pattern');
    expect(html).not.toContain('Plánováno');
    expect(html).not.toContain('Obsahuje plánované položky');
  });
});

describe('Nejvyšší výdaje z položek předpovědi', () => {
  const top = getTopExpenses(periods, forecast, [checking, other], [], today);

  it('zahrnuje plánované položky i opakované výskyty výchozího účtu a označí je', () => {
    expect(top.map((t) => t.amountInHaler)).toEqual([45000, 30000, 20000, 12000, 12000, 12000, 12000, 5000]);
    const insurance = top.find((t) => t.transaction.title === 'Pojistka')!;
    expect(insurance.isPlanned).toBe(true);
    const rentItems = top.filter((t) => t.transaction.recurringRuleId === 'rent');
    expect(rentItems.map((t) => [t.transaction.date, t.isPlanned])).toEqual([
      ['2026-07-20', false], ['2026-08-20', false], ['2026-09-20', false], ['2026-10-20', true],
    ]);
    expect(top.some((t) => t.transaction.status === 'cancelled' || t.transaction.sourceAccountId === 'chk2')).toBe(false);
  });

  it('součet výdajů v top seznamu odpovídá výdajům období, když se do něj vejdou všechny', () => {
    const total = top.reduce((s, t) => s + t.amountInHaler, 0);
    const kpiTotal = [jul, aug, sep, oct].reduce((s, key) => s + forecast.getPeriod(key)!.defaultAccount.expenseInHaler, 0);
    expect(total).toBe(kpiTotal);
  });

  it('bez výchozího účtu je prázdný', () => {
    expect(getTopExpenses(periods, forecast, [{ ...checking, isDefault: false }], [], today)).toEqual([]);
  });
});
