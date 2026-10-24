// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePeriodForecast } from '../hooks/usePeriodForecast';
import { getInitialData, type AppData } from '../services/storageService';
import { Account } from '../types/finance';

const account: Account = {
  id: 'main', name: 'Main', type: 'checking', currency: 'CZK', initialBalanceInHaler: 1000000,
  initialBalanceDate: '2026-01-01', isUsableCash: true, isNetWorth: true, isDefault: true, status: 'active',
  color: '', sortOrder: 0, createdAt: '', updatedAt: '',
};

function appData(settings: Partial<AppData['settings']> = {}): AppData {
  const data = getInitialData();
  return { ...data, accounts: [account], settings: { ...data.settings, budgetStartDay: 15, ...settings } };
}

function render(initial: AppData = appData()) {
  return renderHook(({ data }) => usePeriodForecast(data), { initialProps: { data: initial } });
}

const lastKey = (forecast: ReturnType<typeof usePeriodForecast>['forecast']) => forecast.periods[forecast.periods.length - 1].period.key;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-20T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('usePeriodForecast', () => {
  it('starts on the current period and navigates between periods', () => {
    const { result } = render();
    expect(result.current.today).toBe('2026-09-20');
    expect(result.current.currentPeriod.key).toBe('2026-09');
    expect(result.current.selectedPeriod.key).toBe('2026-09');
    expect(result.current.isCurrentPeriodSelected).toBe(true);

    act(() => result.current.goToNextPeriod());
    expect(result.current.selectedPeriod).toMatchObject({ key: '2026-10', startDate: '2026-10-15', endDate: '2026-11-14' });
    expect(result.current.isCurrentPeriodSelected).toBe(false);
    act(() => { result.current.goToPreviousPeriod(); result.current.goToPreviousPeriod(); });
    expect(result.current.selectedPeriod.key).toBe('2026-08');

    vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
    act(() => result.current.goToCurrentPeriod());
    expect(result.current.today).toBe('2026-11-20');
    expect(result.current.currentPeriod.key).toBe('2026-11');
    expect(result.current.selectedPeriod.key).toBe('2026-11');
    expect(result.current.forecast.currentPeriod.key).toBe('2026-11');
  });

  it('keeps the selected month when the budget start day changes', () => {
    const { result, rerender } = render();
    act(() => result.current.goToNextPeriod());
    rerender({ data: appData({ budgetStartDay: 1 }) });
    expect(result.current.selectedPeriod).toMatchObject({ key: '2026-10', startDate: '2026-10-01', endDate: '2026-10-31', startDay: 1 });
    expect(result.current.currentPeriod).toMatchObject({ key: '2026-09', startDate: '2026-09-01' });
  });

  it('follows a new today from auto-execution', () => {
    const { result } = render();
    act(() => result.current.setToday('2026-10-16'));
    expect(result.current.currentPeriod.key).toBe('2026-10');
    // The selected period stays where the user left it
    expect(result.current.selectedPeriod.key).toBe('2026-09');
  });

  it('remembers screen ranges per screen and returns to a changed default', () => {
    const { result, rerender } = render(appData({ defaultPeriodRanges: { overview: 'future:6' } }));
    expect(result.current.periodRanges).toEqual({
      overview: { direction: 'future', months: 6 },
      analytics: { direction: 'past', months: 12 },
    });

    act(() => result.current.setPeriodRange('analytics', { direction: 'past', preset: 'ytd' }));
    expect(result.current.periodRanges.analytics).toEqual({ direction: 'past', preset: 'ytd' });
    expect(result.current.periodRanges.overview).toEqual({ direction: 'future', months: 6 });

    rerender({ data: appData({ defaultPeriodRanges: { overview: 'future:6', analytics: 'past:3' } }) });
    expect(result.current.periodRanges.analytics).toEqual({ direction: 'past', months: 3 });
  });

  it('extends the forecast to the screen ranges and to a selected period outside them', () => {
    const { result } = render();
    expect(lastKey(result.current.forecast)).toBe('2027-08');

    act(() => result.current.setPeriodRange('overview', { direction: 'future', months: 24 }));
    expect(lastKey(result.current.forecast)).toBe('2028-08');
    act(() => result.current.setPeriodRange('analytics', { direction: 'past', preset: 'custom', from: '2015-01', to: '2015-02' }));
    expect(result.current.forecast.periods[0].period.key).toBe('2015-01');

    act(() => result.current.setSelectedPeriod({ ...result.current.selectedPeriod, year: 2030, month: 1 }));
    expect(result.current.selectedPeriod.key).toBe('2030-01');
    expect(result.current.forecast.periods.some(p => p.period.key === '2030-01')).toBe(true);
    // The projection still starts at the current period
    expect(result.current.forecastSequence[0].key).toBe('2026-09');
  });

  it('does not recompute the forecast when navigating inside the covered range', () => {
    const { result } = render();
    const before = result.current.forecast;
    act(() => result.current.goToNextPeriod());
    act(() => result.current.goToNextPeriod());
    expect(result.current.forecast).toBe(before);
  });
});
