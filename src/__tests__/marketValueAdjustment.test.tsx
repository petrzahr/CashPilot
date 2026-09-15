import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FinanceProvider, useFinance } from '../context/FinanceContext';
import { Account } from '../types/finance';
import { AppData, getInitialData, loadStoredData, saveStoredData } from '../services/storageService';
import { SyncController } from '../services/syncController';
import { mergePending, recordLocalChange, SyncEnvelope } from '../services/syncModel';
import { calculateForecast } from '../services/financialEngine';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Market value update with invested amount correction', () => {
  it.each([
    [228700, undefined, 228700],
    [228700, 329200, 329200],
    [228700, -329200, -329200],
    [228700, 0, 0],
    [undefined, undefined, undefined],
  ])('preserves or updates correction %s to %s in one saved update', (existing, correction, expected) => {
    vi.useFakeTimers();
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    const account: Account = {
      id: 'investment', name: 'Investment', type: 'investment', currency: 'CZK',
      initialBalanceInHaler: 10000000, initialBalanceDate: '2026-09-01',
      investedAmountAdjustmentInHaler: existing,
      isUsableCash: false, isNetWorth: true, color: '', sortOrder: 1, status: 'active',
      createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
    };
    const original = { ...getInitialData(), accounts: [account] };
    let envelope: SyncEnvelope = { data: original, pending: [], cloudRevision: original.sync.revision, generation: 0 };
    const change = vi.fn((action: React.SetStateAction<AppData>) => {
      const next = typeof action === 'function' ? action(envelope.data) : action;
      envelope = recordLocalChange(envelope, next, 'test-device');
    });
    const session = { data: original, isReady: true, change } as unknown as SyncController;
    let finance!: ReturnType<typeof useFinance>;
    function Capture() { finance = useFinance(); return null; }
    renderToStaticMarkup(<FinanceProvider syncSession={session}><Capture /></FinanceProvider>);

    finance.updateMarketValue(account.id, 12000000, '2026-09-15', 'Provider statement', correction);
    expect(change).toHaveBeenCalledTimes(1);
    expect(envelope.data.accounts[0].investedAmountAdjustmentInHaler).toBe(expected);
    expect(envelope.data.accounts[0].currentMarketValueInHaler).toBe(12000000);
    expect(envelope.data.marketValueSnapshots).toHaveLength(1);
    expect(envelope.data.transactions).toEqual(original.transactions);

    saveStoredData(envelope.data, 'market-value-test');
    const reloaded = loadStoredData('market-value-test');
    const synced = mergePending(original, reloaded, envelope.pending);
    expect(synced.accounts).toEqual(envelope.data.accounts);
    expect(synced.marketValueSnapshots).toEqual(envelope.data.marketValueSnapshots);
    const result = calculateForecast([{
      key: '2026-09', name: '', year: 2026, month: 9,
      startDate: '2026-09-01', endDate: '2026-09-30',
    }], synced.accounts, [], [], [], [], undefined, synced.marketValueSnapshots);
    const balance = result.periods[0].accountBalances[account.id];
    const invested = 10000000 + (expected ?? 0);
    expect(balance.investedPrincipalInHaler).toBe(invested);
    expect(balance.unrealizedGainLossInHaler).toBe(12000000 - invested);
    expect(balance.unrealizedGainLossInHaler! / balance.investedPrincipalInHaler! * 100)
      .toBeCloseTo((12000000 - invested) / invested * 100);
  });
});
