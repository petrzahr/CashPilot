import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FinanceProvider, useFinance } from '../context/FinanceContext';
import { Account } from '../types/finance';
import { getInitialData, validateAndParseBackup } from '../services/storageService';
import { SyncController } from '../services/syncController';
import { mutateMarketValueHistory } from '../services/marketValueHistoryService';
import { calculatePeriodInvestmentChange } from '../services/investmentPerformanceService';
import { calculateForecast } from '../services/financialEngine';
import { createBudgetPeriod } from '../services/periodService';
import { mergePending, recordLocalChange } from '../services/syncModel';
import { getAccountBalanceAtDate } from '../services/accountBalance';
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
  for (const [date, value] of [
    ['2026-09-14', 31000000], ['2026-09-15', 35192700], ['2026-09-16', 35192700], ['2026-10-15', 36000000],
  ] as const) run(f => f.updateMarketValue(account.id, value, date));
  return { get data() { return data; }, run };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-15T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

it('edits one existing state in place', () => {
  const flow = workflow();
  const [a, b, , d] = flow.data.marketValueSnapshots;
  flow.run(f => f.editMarketValue(b.id, { date: b.date, marketValueInHaler: 35000000 }));
  const history = flow.data.marketValueSnapshots;
  expect(history).toHaveLength(4);
  expect(history[0]).toMatchObject(a);
  expect(history[1]).toMatchObject({ id: b.id, createdAt: b.createdAt, marketValueInHaler: 35000000 });
  expect(history[3]).toMatchObject(d);
  expect(flow.data.accounts[0].currentMarketValueInHaler).toBe(d.marketValueInHaler);
  expect(calculatePeriodInvestmentChange(flow.data.accounts, history,
    createBudgetPeriod(2026, 9, 15), 15, '2026-11-15')).toBe(4192700);
});

it('deletes intermediate and latest valuations and recalculates history', () => {
  const flow = workflow();
  const [a, b, c, d] = flow.data.marketValueSnapshots;
  flow.run(f => f.deleteMarketValue(b.id));
  expect(flow.data.marketValueSnapshots.map(s => s.id)).toEqual([a.id, c.id, d.id]);
  flow.run(f => f.deleteMarketValue(d.id));
  expect(flow.data.accounts[0]).toMatchObject({ currentMarketValueInHaler: c.marketValueInHaler, marketValueUpdatedAt: c.date });
  expect(calculatePeriodInvestmentChange(flow.data.accounts, flow.data.marketValueSnapshots,
    createBudgetPeriod(2026, 9, 15), 15, '2026-11-15')).toBe(4192700);
  const forecast = calculateForecast([createBudgetPeriod(2026, 9, 15)], flow.data.accounts, [], [], [], [], undefined, flow.data.marketValueSnapshots, undefined, '2026-11-15');
  expect(forecast.periods[0].accountBalances[account.id]).toMatchObject({ marketValueInHaler: c.marketValueInHaler, investedPrincipalInHaler: 31000000, unrealizedGainLossInHaler: 4192700 });
  expect(forecast.periods[0]).toMatchObject({ netWorthOpeningInHaler: 31000000, netWorthClosingInHaler: c.marketValueInHaler });
  expect(getAccountBalanceAtDate(flow.data.accounts[0], '2026-10-14', { transactions: [], snapshots: flow.data.marketValueSnapshots })).toBe(c.marketValueInHaler);
});

it('moves a valuation across dates and never uses a future state as current', () => {
  const flow = workflow();
  const d = flow.data.marketValueSnapshots[3];
  flow.run(f => f.editMarketValue(d.id, { ...d, date: '2026-12-01' }));
  expect(flow.data.accounts[0].marketValueUpdatedAt).toBe('2026-09-16');
  const moved = mutateMarketValueHistory(flow.data, d.id, { ...d, date: '2026-09-21' });
  expect(moved.accounts[0].marketValueUpdatedAt).toBe('2026-09-21');
});

it('manages same-day records by stable identity and clears the last deleted valuation', () => {
  const flow = workflow();
  flow.run(f => f.updateMarketValue(account.id, 37000000, '2026-10-15'));
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
});

it('persists edits and tombstones through reload and merge with stale cloud data', () => {
  const flow = workflow();
  const before = flow.data;
  flow.run(f => f.deleteMarketValue(before.marketValueSnapshots[1].id));
  flow.run(f => f.editMarketValue(before.marketValueSnapshots[3].id, {
    ...before.marketValueSnapshots[3], marketValueInHaler: 35000000,
  }));
  const local = recordLocalChange({ data: before, pending: [], generation: 0, cloudRevision: 0 }, flow.data, 'test');
  expect(local.data.deletions).toContainEqual(expect.objectContaining({ entityType: 'marketValueSnapshot', entityId: before.marketValueSnapshots[1].id }));
  const reloaded = validateAndParseBackup(JSON.stringify(local.data));
  const merged = mergePending(before, reloaded, local.pending);
  expect(merged.marketValueSnapshots).toEqual(reloaded.marketValueSnapshots);
  expect(merged.accounts[0].currentMarketValueInHaler).toBe(35000000);
  expect(mergePending(merged, before, []).marketValueSnapshots).toEqual(merged.marketValueSnapshots);
});

it('removes legacy invested-amount corrections from stored data', () => {
  const flow = workflow();
  const legacy = {
    ...flow.data,
    accounts: flow.data.accounts.map(a => ({ ...a, investedAmountAdjustmentInHaler: -329200, investmentCorrectionInitiallyZero: true })),
    marketValueSnapshots: flow.data.marketValueSnapshots.map(s => ({ ...s, investedAmountAdjustmentInHaler: -228700,
      effectiveInvestedAmountInHaler: 30771300, baseInvestedAmountInHaler: 31000000, correctionChanged: true, correctionPreviouslyZero: true })),
  };
  const loaded = validateAndParseBackup(JSON.stringify(legacy));
  expect(loaded.investmentFees).toEqual([]);
  for (const key of ['investedAmountAdjustmentInHaler', 'investmentCorrectionInitiallyZero']) expect(loaded.accounts[0]).not.toHaveProperty(key);
  for (const s of loaded.marketValueSnapshots) {
    for (const key of ['investedAmountAdjustmentInHaler', 'effectiveInvestedAmountInHaler', 'baseInvestedAmountInHaler', 'correctionChanged', 'correctionPreviouslyZero']) {
      expect(s).not.toHaveProperty(key);
    }
  }
  expect(loaded.marketValueSnapshots.map(s => s.marketValueInHaler)).toEqual(flow.data.marketValueSnapshots.map(s => s.marketValueInHaler));
});

it('exposes edit and delete for each valuation and fee in the history UI', () => {
  const flow = workflow();
  flow.run(f => f.saveInvestmentFee(account.id, '2026-09', 15000));
  flow.run(f => f.saveInvestmentFee(account.id, '2026-09', 20000, 'opraveno'));
  flow.run(f => f.saveInvestmentFee(account.id, '2026-10', 15000));
  expect(flow.data.investmentFees.map(f => [f.periodKey, f.amountInHaler])).toEqual([['2026-09', 20000], ['2026-10', 15000]]);
  const session = { data: flow.data, isReady: true } as SyncController;
  const html = renderToStaticMarkup(<FinanceProvider syncSession={session}>
    <AccountHistoryModal isOpen onClose={() => {}} account={flow.data.accounts[0]} />
  </FinanceProvider>);
  expect(html.match(/aria-label="Upravit tržní hodnotu z /g)).toHaveLength(4);
  expect(html.match(/aria-label="Smazat tržní hodnotu z /g)).toHaveLength(4);
  expect(html.match(/aria-label="Upravit poplatek: /g)).toHaveLength(2);
  flow.run(f => f.deleteInvestmentFee(flow.data.investmentFees[0].id));
  expect(flow.data.investmentFees.map(f => f.periodKey)).toEqual(['2026-10']);
});

it('ignores missing IDs and non-investment accounts', () => {
  const flow = workflow();
  expect(mutateMarketValueHistory(flow.data, 'missing')).toBe(flow.data);
  const cash = { ...flow.data, accounts: [{ ...account, type: 'checking' as const }] };
  expect(mutateMarketValueHistory(cash, cash.marketValueSnapshots[0].id)).toBe(cash);
});
