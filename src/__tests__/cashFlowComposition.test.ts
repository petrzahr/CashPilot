import { describe, it, expect } from 'vitest';
import { calculateCashFlowComposition, generateBudgetPeriodSequence } from '../services/analyticsEngine';
import { createBudgetPeriod } from '../services/periodService';
import { summarizePeriods } from '../services/financialEngine';
import { Account, Transaction } from '../types/finance';

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

let seq = 0;
const tx = (sourceAccountId: string, type: Transaction['type'], amountInHaler: number): Transaction => ({
  id: `t${++seq}`, title: '', type, amountInHaler, sourceAccountId, date: '2026-08-20', sequence: 1,
  status: 'executed', actualAmountInHaler: amountInHaler, createdAt: '', updatedAt: '',
  ...(type === 'balance_adjustment' ? { diffInHaler: amountInHaler } : {}),
});

describe('Příjmy / Výdaje / Skutečně uspořeno (calculateCashFlowComposition)', () => {
  const period = createBudgetPeriod(2026, 8, 15);
  const periods = generateBudgetPeriodSequence(period, period, today);
  const accounts = [{ ...account('chk', 'checking'), isDefault: true }, account('cash', 'cash'), account('sav', 'savings')];
  const buildForecast = (transactions: Transaction[], forecastAccounts = accounts) =>
    summarizePeriods([period], { accounts: forecastAccounts, transactions }, { today });

  it('bere jen výchozí účet a Skutečně uspořeno = příjmy − výdaje + korekce', () => {
    const forecast = buildForecast([
      tx('chk', 'income', 9530000), tx('chk', 'expense', 10000000), tx('chk', 'balance_adjustment', -50000),
      tx('cash', 'expense', 110000), tx('sav', 'income', 999900),
    ]);

    const [point] = calculateCashFlowComposition(periods, forecast);
    const byKey = Object.fromEntries(point.segments.map((s) => [s.key, s]));

    expect(byKey.income.amountInHaler).toBe(9530000);
    expect(byKey.expense.amountInHaler).toBe(10000000);
    expect(byKey.actuallySaved.amountInHaler).toBe(9530000 - 10000000 - 50000);
  });

  it('bez výchozího účtu jsou hodnoty nulové', () => {
    const forecast = buildForecast(
      [tx('chk', 'income', 9530000), tx('chk', 'expense', 10000000)],
      accounts.map((a) => ({ ...a, isDefault: false }))
    );
    const [point] = calculateCashFlowComposition(periods, forecast);
    for (const seg of point.segments) {
      expect(seg.amountInHaler).toBe(0);
      expect(seg.pct).toBeNull();
    }
  });

  it('kladná a záporná strana dávají dohromady 100 %, záporné uspořeno jde pod nulu', () => {
    const forecast = buildForecast([tx('chk', 'income', 9530000), tx('chk', 'expense', 10160000)]);

    const [point] = calculateCashFlowComposition(periods, forecast);
    const absSum = point.segments.reduce((s, seg) => s + Math.abs(seg.pct ?? 0), 0);
    expect(absSum).toBeCloseTo(100, 6);

    const saved = point.segments.find((s) => s.key === 'actuallySaved')!;
    expect(saved.pct!).toBeLessThan(0);
    // 630 000 / (9 530 000 + 10 160 000 + 630 000)
    expect(saved.pct!).toBeCloseTo(-(630000 / 20320000) * 100, 6);
  });

  it('pct je null, když nejsou žádné příjmy ani výdaje', () => {
    const [point] = calculateCashFlowComposition(periods, buildForecast([]));
    for (const seg of point.segments) expect(seg.pct).toBeNull();
  });
});
