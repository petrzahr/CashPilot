import { describe, expect, it } from 'vitest';
import { calculateForecast, ForecastData } from '../services/financialEngine';
import { createBudgetPeriod } from '../services/periodService';
import { getInitialData } from '../services/storageService';
import { Account, RecurringRule, Transaction } from '../types/finance';

const today = '2026-09-20';

const account = (initialBalanceDate: string): Account => ({
  id: 'main', name: 'Main', type: 'checking', currency: 'CZK', initialBalanceInHaler: 1000000,
  initialBalanceDate, isUsableCash: true, isNetWorth: true, isDefault: true, status: 'active',
  color: '', sortOrder: 0, createdAt: '', updatedAt: '',
});
const tx = (id: string, date: string, amountInHaler = 10000, status: Transaction['status'] = 'planned'): Transaction => ({
  id, title: id, type: 'expense', amountInHaler, date, sequence: 1, sourceAccountId: 'main', status,
  createdAt: '', updatedAt: '',
});
const rule = (startDate: string): RecurringRule => ({
  id: `rule_${startDate}`, title: 'Rent', type: 'expense', amountInHaler: 50000, sourceAccountId: 'main',
  dayOfMonth: 20, frequency: 'monthly', startDate, isActive: true, createdAt: '', updatedAt: '',
});

function data(overrides: Partial<ForecastData> = {}): ForecastData {
  const base = getInitialData();
  return { ...base, accounts: [account('2026-09-15')], ...overrides, settings: { ...base.settings, budgetStartDay: 15, ...overrides.settings } };
}
const keys = (d: ForecastData, options: Omit<Parameters<typeof calculateForecast>[1], 'today'> = {}) => {
  const forecast = calculateForecast(d, { today, ...options });
  return { first: forecast.periods[0].period.key, last: forecast.periods[forecast.periods.length - 1].period.key, forecast };
};

describe('calculateForecast builds its own period sequence', () => {
  it('covers the 12-period past preset and 12-period future horizon without data', () => {
    const { first, last, forecast } = keys(data());
    expect(first).toBe('2025-10');
    expect(last).toBe('2027-08');
    expect(forecast.currentPeriod.key).toBe('2026-09');
    expect(forecast.forecastPeriods?.map(p => p.period.key)[0]).toBe('2026-09');
    expect(forecast.forecastPeriods).toHaveLength(12);
  });

  it('extends to data bounds; rule starts and account dates only extend the start', () => {
    const { first, last } = keys(data({
      accounts: [account('2023-03-20')],
      transactions: [tx('future', '2029-01-20')],
      recurringRules: [rule('2031-01-20')],
    }));
    expect(first).toBe('2023-03');
    expect(last).toBe('2029-01');

    // Rule starting before the 15th belongs to the previous period
    expect(keys(data({ recurringRules: [rule('2022-01-01')] })).first).toBe('2021-12');
    // Corrections and valuations extend the end as well
    const late = keys(data({
      corrections: [{ id: 'c', accountId: 'main', checkDate: '2028-03-16', calculatedBalanceInHaler: 0, actualBalanceInHaler: 0, diffInHaler: 0, createdAt: '' }],
    }));
    expect(late.last).toBe('2028-03');
  });

  it('includes a selected period outside the range on either side', () => {
    expect(keys(data(), { selectedPeriod: createBudgetPeriod(2020, 5, 15) }).first).toBe('2020-05');
    expect(keys(data(), { selectedPeriod: createBudgetPeriod(2035, 2, 15) }).last).toBe('2035-02');
    // Inside the range it changes nothing
    const inside = keys(data(), { selectedPeriod: createBudgetPeriod(2026, 12, 15) });
    expect([inside.first, inside.last]).toEqual(['2025-10', '2027-08']);
  });

  it('covers custom screen ranges far outside the data', () => {
    const { first, last } = keys(data(), { ranges: {
      analytics: { direction: 'past', preset: 'custom', from: '2015-01', to: '2015-03' },
      overview: { direction: 'future', preset: 'custom', from: '2040-06', to: '2040-08' },
    } });
    expect(first).toBe('2015-01');
    expect(last).toBe('2040-08');
  });

  it('covers a 24-month future preset', () => {
    const { first, last } = keys(data(), { ranges: { overview: { direction: 'future', months: 24 } } });
    expect(first).toBe('2025-10');
    expect(last).toBe('2028-08');
  });

  it('projects every period from the current one to the end of the range, also periods 13–24', () => {
    const investment: Account = { ...account('2026-01-01'), id: 'inv', type: 'investment', isDefault: false, isUsableCash: false, initialBalanceInHaler: 1500000 };
    const contribution: RecurringRule = {
      ...rule('2026-10-20'), id: 'contribution', type: 'transfer', amountInHaler: 10000, targetAccountId: 'inv',
    };
    const forecast = calculateForecast(
      data({ accounts: [account('2026-01-01'), investment], recurringRules: [contribution] }),
      { today, ranges: { overview: { direction: 'future', months: 24 } } }
    );
    const projected = forecast.forecastPeriods!;
    expect(projected.map(p => p.period.key)).toEqual(forecast.periods.slice(forecast.periods.findIndex(p => p.period.key === '2026-09')).map(p => p.period.key));
    expect(projected).toHaveLength(24);
    expect(projected[23].period.key).toBe('2028-08');

    for (let i = 12; i < 24; i++) {
      const view = forecast.getPeriod(projected[i].period.key)!;
      expect(view.projected).toBe(projected[i]);
      expect(view.projected).not.toBe(view.recorded);
      // Anchored at today's value, then one contribution per period from 2026-10 on
      expect(view.projected.accountBalances.inv.closingBalanceInHaler).toBe(1500000 + 10000 * i);
    }
  });

  it('builds periods with the budget start day from settings', () => {
    const forecast = calculateForecast(data({ settings: { ...getInitialData().settings, budgetStartDay: 31 } }), { today });
    expect(forecast.currentPeriod).toMatchObject({ key: '2026-08', startDate: '2026-08-31', endDate: '2026-09-29', startDay: 31 });
    expect(forecast.periods.every(p => p.period.startDay === 31)).toBe(true);
  });

  it('gives the same numbers for a period however far the sequence reaches', () => {
    const d = data({
      accounts: [account('2026-01-01')],
      transactions: [tx('past', '2026-03-20', 20000, 'executed'), tx('next', '2026-10-20')],
      recurringRules: [rule('2026-02-20')],
    });
    const narrow = calculateForecast(d, { today });
    const wide = calculateForecast(d, { today, ranges: { analytics: { direction: 'past', preset: 'custom', from: '2015-01', to: '2015-03' } } });
    expect(wide.periods.length).toBeGreaterThan(narrow.periods.length);
    for (const key of ['2026-03', '2026-09', '2027-02']) {
      expect(wide.periods.find(p => p.period.key === key)).toEqual(narrow.periods.find(p => p.period.key === key));
    }
    expect(wide.forecastPeriods).toEqual(narrow.forecastPeriods);
    expect(wide.netWorthNowInHaler).toBe(narrow.netWorthNowInHaler);
  });
});
