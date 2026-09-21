import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FinanceProvider, useFinance } from '../context/FinanceContext';
import { Account } from '../types/finance';
import { getInitialData, validateAndParseBackup } from '../services/storageService';
import { SyncController } from '../services/syncController';
import { mutateMarketValueHistory } from '../services/marketValueHistoryService';
import { calculatePeriodInvestmentChange, getHistoricalInvestmentCorrection } from '../services/investmentPerformanceService';
import { calculateForecast } from '../services/financialEngine';
import { createBudgetPeriod } from '../services/periodService';
import { mergePending, recordLocalChange } from '../services/syncModel';
import { computeAssetAccountBalanceAtDate } from '../services/analyticsEngine';
import { AccountHistoryModal } from '../components/accounts/AccountHistoryModal';

const account: Account = { id: 'asset', name: 'Investment', type: 'investment', currency: 'CZK',
  initialBalanceInHaler: 31000000, initialBalanceDate: '2026-08-01', isUsableCash: false, isNetWorth: true,
  color: '', sortOrder: 1, status: 'active', createdAt: '2026-08-01', updatedAt: '2026-08-01' };

function workflow() {
  let data = { ...getInitialData(), accounts: [account] };
  const run = (action: (f: ReturnType<typeof useFinance>) => void) => {
    let finance!: ReturnType<typeof useFinance>;
    const session = { data, isReady: true, change: (action: React.SetStateAction<typeof data>) => {
      data = typeof action === 'function' ? action(data) : action;
    } } as unknown as SyncController;
    function Capture() { finance = useFinance(); return null; }
    renderToStaticMarkup(<FinanceProvider syncSession={session}><Capture /></FinanceProvider>);
    action(finance);
  };
  for (const [date, value, correction] of [
    ['2026-09-14', 31000000, 0], ['2026-09-15', 35192700, -228700],
    ['2026-09-16', 35192700, -228700], ['2026-10-15', 36000000, -329200],
  ] as const) run(f => f.updateMarketValue(account.id, value, date, undefined, correction));
  return { get data() { return data; }, run };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-15T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

it('edits one existing state and carries its correction until the next change', () => {
  const flow = workflow();
  const [a, b, , d] = flow.data.marketValueSnapshots;
  flow.run(f => f.editMarketValue(b.id, { date: b.date, marketValueInHaler: 35000000, investedAmountAdjustmentInHaler: -300000 }));
  const history = flow.data.marketValueSnapshots;
  expect(history).toHaveLength(4);
  expect(history[0]).toMatchObject(a);
  expect(history[1]).toMatchObject({ id: b.id, createdAt: b.createdAt, marketValueInHaler: 35000000, effectiveInvestedAmountInHaler: 30700000 });
  expect(history[2].investedAmountAdjustmentInHaler).toBe(-300000);
  expect(history[3]).toMatchObject(d);
  expect(flow.data.accounts[0].currentMarketValueInHaler).toBe(d.marketValueInHaler);
  expect(calculatePeriodInvestmentChange(flow.data.accounts, history,
    createBudgetPeriod(2026, 9, 15), 15, '2026-11-15')).toBe(4492700);
});

it('deletes an intermediate transition and lets inherited states use the preceding correction', () => {
  const flow = workflow();
  const [a, b, c, d] = flow.data.marketValueSnapshots;
  flow.run(f => f.deleteMarketValue(b.id));
  expect(flow.data.marketValueSnapshots.map(s => s.id)).toEqual([a.id, c.id, d.id]);
  expect(flow.data.marketValueSnapshots[1].investedAmountAdjustmentInHaler).toBe(0);
  expect(getHistoricalInvestmentCorrection(flow.data.accounts[0], flow.data.marketValueSnapshots, '2026-09-15')).toBe(0);
  flow.run(f => f.deleteMarketValue(d.id));
  expect(flow.data.accounts[0]).toMatchObject({ currentMarketValueInHaler: c.marketValueInHaler, marketValueUpdatedAt: c.date, investedAmountAdjustmentInHaler: 0 });
  expect(calculatePeriodInvestmentChange(flow.data.accounts, flow.data.marketValueSnapshots,
    createBudgetPeriod(2026, 9, 15), 15, '2026-11-15')).toBe(4192700);
  const forecast = calculateForecast([createBudgetPeriod(2026, 9, 15)], flow.data.accounts, [], [], [], [], undefined, flow.data.marketValueSnapshots, undefined, '2026-11-15');
  expect(forecast.periods[0].accountBalances[account.id]).toMatchObject({ marketValueInHaler: c.marketValueInHaler, investedPrincipalInHaler: 31000000, unrealizedGainLossInHaler: 4192700 });
  expect(forecast.periods[0]).toMatchObject({ netWorthOpeningInHaler: 31000000, netWorthClosingInHaler: c.marketValueInHaler });
  expect(computeAssetAccountBalanceAtDate(flow.data.accounts[0], '2026-10-14', [], flow.data.marketValueSnapshots)).toBe(c.marketValueInHaler);
});

it('moves a valuation across dates, recaptures capital, and never uses a future state as current', () => {
  const flow = workflow();
  const d = flow.data.marketValueSnapshots[3];
  flow.run(f => f.editMarketValue(d.id, { ...d, date: '2026-12-01' }));
  expect(flow.data.accounts[0].marketValueUpdatedAt).toBe('2026-09-16');
  expect(getHistoricalInvestmentCorrection(flow.data.accounts[0], flow.data.marketValueSnapshots, '2026-10-20')).toBe(-228700);
  const withTransfer = { ...flow.data, transactions: [{ id: 'in', title: '', type: 'transfer' as const, status: 'executed' as const,
    sourceAccountId: 'cash', targetAccountId: account.id, amountInHaler: 10000, date: '2026-09-20', sequence: 1, createdAt: '', updatedAt: '' }] };
  const moved = mutateMarketValueHistory(withTransfer, d.id, { ...d, date: '2026-09-21' });
  expect(moved.marketValueSnapshots[3].baseInvestedAmountInHaler).toBe(31010000);
  expect(moved.accounts[0].marketValueUpdatedAt).toBe('2026-09-21');
});

it('manages same-day records by stable identity and clears the last deleted valuation', () => {
  const flow = workflow();
  flow.run(f => f.updateMarketValue(account.id, 37000000, '2026-10-15', undefined, -400000));
  const last = flow.data.marketValueSnapshots[4];
  flow.run(f => f.editMarketValue(last.id, { ...last, marketValueInHaler: 38000000 }));
  expect(flow.data.marketValueSnapshots[3].marketValueInHaler).toBe(36000000);
  expect(flow.data.accounts[0].currentMarketValueInHaler).toBe(38000000);
  flow.run(f => f.deleteMarketValue(last.id));
  expect(flow.data.accounts[0].currentMarketValueInHaler).toBe(36000000);
  for (const s of [...flow.data.marketValueSnapshots]) flow.run(f => f.deleteMarketValue(s.id));
  expect(flow.data.marketValueSnapshots).toEqual([]);
  expect(flow.data.accounts[0].currentMarketValueInHaler).toBeUndefined();
  expect(flow.data.accounts[0].marketValueUpdatedAt).toBeUndefined();
  expect(flow.data.accounts[0].investedAmountAdjustmentInHaler).toBeUndefined();
});

it('persists edits and tombstones through reload and merge with stale cloud data', () => {
  const flow = workflow();
  const before = flow.data;
  flow.run(f => f.deleteMarketValue(before.marketValueSnapshots[1].id));
  flow.run(f => f.editMarketValue(before.marketValueSnapshots[3].id, {
    ...before.marketValueSnapshots[3], marketValueInHaler: 35000000, investedAmountAdjustmentInHaler: -300000,
  }));
  const local = recordLocalChange({ data: before, pending: [], generation: 0, cloudRevision: 0 }, flow.data, 'test');
  expect(local.data.deletions).toContainEqual(expect.objectContaining({ entityType: 'marketValueSnapshot', entityId: before.marketValueSnapshots[1].id }));
  const reloaded = validateAndParseBackup(JSON.stringify(local.data));
  const merged = mergePending(before, reloaded, local.pending);
  expect(merged.marketValueSnapshots).toEqual(reloaded.marketValueSnapshots);
  expect(merged.accounts[0].currentMarketValueInHaler).toBe(35000000);
  expect(mergePending(merged, before, []).marketValueSnapshots).toEqual(merged.marketValueSnapshots);
});

it('infers transitions in older records once, and preserves their meaning across repeated mutations', () => {
  const flow = workflow();
  const legacy = { ...flow.data, marketValueSnapshots: flow.data.marketValueSnapshots.map(({ correctionChanged, ...s }) => s) };
  const removed = mutateMarketValueHistory(legacy, legacy.marketValueSnapshots[1].id);
  expect(removed.marketValueSnapshots[1].investedAmountAdjustmentInHaler).toBe(0);
  const edited = mutateMarketValueHistory(removed, removed.marketValueSnapshots[0].id, {
    ...removed.marketValueSnapshots[0], investedAmountAdjustmentInHaler: -100000,
  });
  expect(edited.marketValueSnapshots[1].investedAmountAdjustmentInHaler).toBe(-100000);
  expect(edited.marketValueSnapshots[2].investedAmountAdjustmentInHaler).toBe(-329200);
});

it('exposes edit and delete for each investment valuation using the existing history UI', () => {
  const flow = workflow();
  const session = { data: flow.data, isReady: true } as SyncController;
  const html = renderToStaticMarkup(<FinanceProvider syncSession={session}>
    <AccountHistoryModal isOpen onClose={() => {}} account={flow.data.accounts[0]} />
  </FinanceProvider>);
  expect(html.match(/aria-label="Upravit tržní ocenění"/g)).toHaveLength(4);
  expect(html.match(/aria-label="Smazat tržní ocenění"/g)).toHaveLength(4);
});

it('leaves unknown legacy capital unknown and ignores missing IDs and non-investment accounts', () => {
  const flow = workflow();
  const unknown = { ...flow.data, marketValueSnapshots: [{ id: 'legacy', accountId: account.id,
    date: '2026-09-01', marketValueInHaler: 31000000, createdAt: '2026-09-01' }] };
  const edited = mutateMarketValueHistory(unknown, 'legacy', { ...unknown.marketValueSnapshots[0], marketValueInHaler: 32000000 });
  expect(edited.marketValueSnapshots[0].effectiveInvestedAmountInHaler).toBeUndefined();
  const deleted = mutateMarketValueHistory(edited, 'legacy');
  expect(getHistoricalInvestmentCorrection(deleted.accounts[0], [], '2026-09-02')).toBeUndefined();
  expect(mutateMarketValueHistory(flow.data, 'missing')).toBe(flow.data);
  const cash = { ...flow.data, accounts: [{ ...account, type: 'checking' as const }] };
  expect(mutateMarketValueHistory(cash, cash.marketValueSnapshots[0].id)).toBe(cash);
});

it('deleting the latest correction restores the previous nonzero correction', () => {
  const flow = workflow();
  flow.run(f => f.deleteMarketValue(flow.data.marketValueSnapshots[3].id));
  expect(flow.data.accounts[0]).toMatchObject({ currentMarketValueInHaler: 35192700,
    investedAmountAdjustmentInHaler: -228700, marketValueUpdatedAt: '2026-09-16' });
});
