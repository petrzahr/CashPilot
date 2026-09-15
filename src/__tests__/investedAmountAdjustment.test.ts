import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Account, BudgetPeriod } from '../types/finance';
import { getEffectiveInvestedAmount } from '../services/accountService';
import { calculateForecast } from '../services/financialEngine';
import { getInitialData, loadStoredData, saveStoredData } from '../services/storageService';
import { mergePending, recordLocalChange, SyncEnvelope } from '../services/syncModel';
import { halerToInputValue, parseInputToHaler } from '../services/currencyService';

const account: Account = {
  id: 'investment', name: 'Investment', type: 'investment', currency: 'CZK',
  initialBalanceInHaler: 31000000, initialBalanceDate: '2026-09-01',
  isUsableCash: false, isNetWorth: true, color: '', sortOrder: 1, status: 'active',
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
};
const periods: BudgetPeriod[] = [9, 10].map(month => ({
  key: `2026-${month}`, name: '', year: 2026, month,
  startDate: `2026-${String(month).padStart(2, '0')}-01`,
  endDate: `2026-${String(month).padStart(2, '0')}-${month === 9 ? 30 : 31}`,
}));

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-15T10:00:00Z')); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Invested amount adjustment', () => {
  it.each([undefined, 0, -329145, 12345, -31000000])('applies %s once across forecast periods without changing balances', adjustment => {
    const baseline = calculateForecast(periods, [account]);
    const adjusted = calculateForecast(periods, [{ ...account, investedAmountAdjustmentInHaler: adjustment }]);
    for (let i = 0; i < periods.length; i++) {
      const before = baseline.periods[i].accountBalances[account.id];
      const after = adjusted.periods[i].accountBalances[account.id];
      expect(after.investedPrincipalInHaler).toBe(before.investedPrincipalInHaler! + (adjustment ?? 0));
      expect(after.unrealizedGainLossInHaler).toBe(before.unrealizedGainLossInHaler! - (adjustment ?? 0));
      expect({ ...after, investedPrincipalInHaler: before.investedPrincipalInHaler,
        unrealizedGainLossInHaler: before.unrealizedGainLossInHaler }).toEqual(before);
      expect(adjusted.periods[i].netWorthClosingInHaler).toBe(baseline.periods[i].netWorthClosingInHaler);
    }
  });

  it('matches the provider portfolio totals', () => {
    const accounts = [
      { ...account, investedAmountAdjustmentInHaler: -329145 },
      { ...account, id: 'second', initialBalanceInHaler: 16600000 },
    ];
    const snapshots = accounts.map((acc, i) => ({
      id: `snapshot-${i}`, accountId: acc.id, date: '2026-09-10',
      marketValueInHaler: i === 0 ? 37132755 : 16600000, createdAt: account.createdAt,
    }));
    const result = calculateForecast(periods, accounts, [], [], [], [], undefined, snapshots);
    const balances = Object.values(result.periods[0].accountBalances);
    const invested = balances.reduce((sum, bal) => sum + bal.investedPrincipalInHaler!, 0);
    const profit = balances.reduce((sum, bal) => sum + bal.unrealizedGainLossInHaler!, 0);
    expect(invested).toBe(47270855);
    expect(profit).toBe(6461900);
    expect(profit / invested * 100).toBeCloseTo(13.67, 2);
    expect(result.periods[0].netWorthClosingInHaler).toBe(53732755);
  });

  it('does not apply before activation or to ordinary cash accounts', () => {
    const future = { ...account, initialBalanceDate: '2026-11-01', investedAmountAdjustmentInHaler: -100 };
    expect(calculateForecast(periods, [future]).periods[0].accountBalances[account.id].investedPrincipalInHaler).toBe(0);
    expect(getEffectiveInvestedAmount({ ...future, type: 'checking' }, 500)).toBe(500);
  });

  it('preserves edits and reset through local reload and account synchronization', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    let data = { ...getInitialData(), accounts: [account] };
    for (const input of ['-3291.45', '100.25', '']) {
      const adjustment = parseInputToHaler(input);
      const edited = { ...data, accounts: [{ ...account, investedAmountAdjustmentInHaler: adjustment }] };
      const envelope: SyncEnvelope = { data, pending: [], cloudRevision: data.sync.revision, generation: 0 };
      const change = recordLocalChange(envelope, edited, 'test-device');
      expect(change.pending).toHaveLength(1);
      expect(change.pending[0].entityType).toBe('account');
      saveStoredData(change.data, 'adjustment-test');
      const reloaded = loadStoredData('adjustment-test');
      expect(reloaded.accounts[0].investedAmountAdjustmentInHaler).toBe(adjustment);
      expect(parseInputToHaler(halerToInputValue(adjustment))).toBe(adjustment);
      data = mergePending(data, reloaded, change.pending);
      expect(data.accounts[0].investedAmountAdjustmentInHaler).toBe(adjustment);
      expect(data.transactions).toEqual(edited.transactions);
      expect(data.marketValueSnapshots).toEqual(edited.marketValueSnapshots);
    }
  });
});
