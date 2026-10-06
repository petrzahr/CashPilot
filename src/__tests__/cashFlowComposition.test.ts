import { describe, it, expect } from 'vitest';
import { calculateCashFlowComposition, generateBudgetPeriodSequence } from '../services/analyticsEngine';
import { createBudgetPeriod } from '../services/periodService';
import { Account, ForecastResult, PeriodSummary } from '../types/finance';

const today = '2026-09-13';

const account = (id: string, type: Account['type']): Account => ({
  id,
  name: id,
  type,
  currency: 'CZK',
  initialBalanceInHaler: 0,
  initialBalanceDate: '2025-01-01',
  isUsableCash: type === 'checking' || type === 'cash',
  isNetWorth: true,
  color: '#000000',
  sortOrder: 1,
  status: 'active',
  createdAt: '',
  updatedAt: '',
});

const bal = (accountId: string, income: number, expense: number, corrections = 0) => ({
  accountId,
  openingBalanceInHaler: 0,
  incomeInHaler: income,
  expenseInHaler: expense,
  transfersInInHaler: 0,
  transfersOutInHaler: 0,
  correctionsInHaler: corrections,
  closingBalanceInHaler: 0,
});

const buildForecast = (summary: Partial<PeriodSummary>): ForecastResult =>
  ({ periods: [summary as PeriodSummary] } as unknown as ForecastResult);

describe('Příjmy / Výdaje / Skutečně uspořeno (calculateCashFlowComposition)', () => {
  const period = createBudgetPeriod(2026, 8, 15);
  const periods = generateBudgetPeriodSequence(period, period, 15, today);
  const accounts = [account('chk', 'checking'), account('cash', 'cash'), account('sav', 'savings')];

  it('sčítá jen běžné a hotovostní účty a Skutečně uspořeno = příjmy − výdaje + korekce', () => {
    const forecast = buildForecast({
      period,
      accountBalances: {
        chk: bal('chk', 9530000, 10000000, -50000),
        cash: bal('cash', 0, 110000),
        sav: bal('sav', 999900, 0),
      },
    });

    const [point] = calculateCashFlowComposition(periods, forecast, accounts);
    const byKey = Object.fromEntries(point.segments.map((s) => [s.key, s]));

    expect(byKey.income.amountInHaler).toBe(9530000);
    expect(byKey.expense.amountInHaler).toBe(10110000);
    expect(byKey.actuallySaved.amountInHaler).toBe(9530000 - 10110000 - 50000);
  });

  it('kladná a záporná strana dávají dohromady 100 %, záporné uspořeno jde pod nulu', () => {
    const forecast = buildForecast({
      period,
      accountBalances: { chk: bal('chk', 9530000, 10160000) },
    });

    const [point] = calculateCashFlowComposition(periods, forecast, accounts);
    const absSum = point.segments.reduce((s, seg) => s + Math.abs(seg.pct ?? 0), 0);
    expect(absSum).toBeCloseTo(100, 6);

    const saved = point.segments.find((s) => s.key === 'actuallySaved')!;
    expect(saved.pct!).toBeLessThan(0);
    // 630 000 / (9 530 000 + 10 160 000 + 630 000)
    expect(saved.pct!).toBeCloseTo(-(630000 / 20320000) * 100, 6);
  });

  it('pct je null, když nejsou žádné příjmy ani výdaje', () => {
    const [point] = calculateCashFlowComposition(periods, buildForecast({ period, accountBalances: {} }), accounts);
    for (const seg of point.segments) expect(seg.pct).toBeNull();
  });
});
