import { describe, expect, it } from 'vitest';
import { getAccountRow, getScopeRow, OverviewAccountRow } from '../services/overviewRows';
import { summarizePeriods } from '../services/financialEngine';
import { createBudgetPeriod, generatePeriodsSequence } from '../services/periodService';
import { Account, AccountPeriodBalance, Transaction } from '../types/finance';

const account = (id: string, extra: Partial<Account> = {}): Account => ({
  id, name: id, type: 'checking', currency: 'CZK', initialBalanceInHaler: 1000000,
  initialBalanceDate: '2026-01-01', isUsableCash: true, isNetWorth: true, status: 'active',
  color: '', sortOrder: 0, createdAt: '', updatedAt: '', ...extra,
});
const tx = (id: string, type: Transaction['type'], amountInHaler: number, extra: Partial<Transaction> = {}): Transaction => ({
  id, title: id, type, amountInHaler, date: '2026-09-20', sequence: 1, sourceAccountId: 'cash', status: 'planned',
  createdAt: '', updatedAt: '', ...extra,
});
const balance = (extra: Partial<AccountPeriodBalance>): AccountPeriodBalance => ({
  accountId: 'a', openingBalanceInHaler: 0, incomeInHaler: 0, expenseInHaler: 0, transfersInInHaler: 0,
  transfersOutInHaler: 0, correctionsInHaler: 0, closingBalanceInHaler: 0, ...extra,
});
const movementsClose = (row: OverviewAccountRow) =>
  row.openingInHaler + row.incomingInHaler - row.outgoingInHaler + row.netTransfersInHaler;

describe('getScopeRow', () => {
  const accounts = [account('cash'), account('savings', { type: 'savings', isUsableCash: false })];
  const transactions = [
    tx('salary', 'income', 5000000),
    tx('rent', 'expense', 2000000),
    tx('saving', 'transfer', 1000000, { targetAccountId: 'savings' }),
    tx('savingsFee', 'expense', 10000, { sourceAccountId: 'savings' }),
  ];
  const summary = summarizePeriods(generatePeriodsSequence(2026, 9, 1, 1), { accounts, transactions },
    { currentPeriodKey: '2026-09', today: '2026-09-10' }).getPeriod('2026-09')!.projected;

  it('sums income, expense and signed net transfers only from usable accounts', () => {
    expect(getScopeRow(summary, accounts, 'usable')).toEqual({
      openingInHaler: summary.usableOpeningInHaler,
      incomeInHaler: 5000000,
      // Výdaj ze spořicího účtu do použitelných peněz nepatří
      expenseInHaler: 2000000,
      // Převod na spoření použitelné peníze snižuje
      netTransfersInHaler: -1000000,
      netChangeInHaler: 2000000,
      closingInHaler: summary.usableClosingInHaler,
    });
    expect(summary.usableNetChangeInHaler).toBe(2000000);
  });

  it('nets internal transfers to zero across all accounts', () => {
    expect(getScopeRow(summary, accounts, 'all')).toEqual({
      openingInHaler: summary.openingBalanceInHaler,
      incomeInHaler: 5000000,
      expenseInHaler: 2010000,
      netTransfersInHaler: 0,
      netChangeInHaler: summary.netChangeInHaler,
      closingInHaler: summary.closingBalanceInHaler,
    });
    expect(summary.netChangeInHaler).toBe(2990000);
  });
});

describe('getAccountRow', () => {
  it('splits corrections into incoming and outgoing on liquid accounts', () => {
    const cash = account('cash');
    expect(getAccountRow(cash, balance({ openingBalanceInHaler: 1000, incomeInHaler: 200, correctionsInHaler: 50,
      transfersInInHaler: 30, transfersOutInHaler: 100, closingBalanceInHaler: 1180 }))).toEqual({
      openingInHaler: 1000, incomingInHaler: 250, outgoingInHaler: 0, netTransfersInHaler: -70, netChangeInHaler: 180, closingInHaler: 1180,
    });
    const negative = getAccountRow(cash, balance({ openingBalanceInHaler: 1000, expenseInHaler: 100, correctionsInHaler: -40, closingBalanceInHaler: 860 }));
    expect(negative).toMatchObject({ incomingInHaler: 0, outgoingInHaler: 140, netChangeInHaler: -140 });
  });

  it.each(['investment', 'pension'] as const)('adds the valuation change of a %s account to the movements', type => {
    const asset = account('asset', { type, isUsableCash: false });
    const gain = balance({ openingBalanceInHaler: 10000, incomeInHaler: 100, expenseInHaler: 30, transfersInInHaler: 500, closingBalanceInHaler: 11000 });
    // Změna ocenění: 11000 − 10000 − (500 + 100 − 30) = 430
    expect(getAccountRow(asset, gain)).toEqual({
      openingInHaler: 10000, incomingInHaler: 530, outgoingInHaler: 30, netTransfersInHaler: 500, netChangeInHaler: 1000, closingInHaler: 11000,
    });
    expect(movementsClose(getAccountRow(asset, gain))).toBe(11000);
    const loss = balance({ openingBalanceInHaler: 10000, transfersInInHaler: 500, closingBalanceInHaler: 9800 });
    expect(getAccountRow(asset, loss)).toMatchObject({ incomingInHaler: 0, outgoingInHaler: 700, netChangeInHaler: -200 });
    expect(movementsClose(getAccountRow(asset, loss))).toBe(9800);
  });

  it('does not invent a valuation change on non-asset accounts', () => {
    const row = getAccountRow(account('savings', { type: 'savings' }), balance({ openingBalanceInHaler: 1000, closingBalanceInHaler: 1300 }));
    expect(row).toMatchObject({ incomingInHaler: 0, outgoingInHaler: 0, netChangeInHaler: 300 });
  });
});

// Ocenění z historie snapshotů: běžící období otevírá oceněním k začátku období a zavírá aktuálním
const valuationCases = [
  { name: 'valuation during period', values: [['2026-08-10', 300000], ['2026-08-25', 305000]], opening: 300000, closing: 305000 },
  { name: 'multiple valuations and a future update', values: [['2026-08-10', 300000], ['2026-08-25', 305000], ['2026-09-10', 310000], ['2026-09-15', 320000]], opening: 300000, closing: 310000 },
  { name: 'no update during period', values: [['2026-08-10', 300000]], opening: 300000, closing: 300000 },
  { name: 'inclusive end and exclusive opening boundary', values: [['2026-08-14', 300000], ['2026-08-15', 305000], ['2026-09-14', 310000], ['2026-09-15', 320000]], opening: 300000, closing: 310000 },
  { name: 'future valuation with no earlier snapshot', values: [['2026-09-15', 320000]], opening: 290000, closing: 290000 },
] as const;

describe.each(['investment', 'pension'] as const)('getAccountRow on a projected %s period', type => {
  it.each(valuationCases)('$name', ({ values, opening, closing }) => {
    const period = createBudgetPeriod(2026, 8, 15);
    const last = values[values.length - 1];
    const asset = account('asset', { type, initialBalanceInHaler: 29000000, isUsableCash: false,
      currentMarketValueInHaler: last[1] * 100, marketValueUpdatedAt: last[0] });
    const cash = account('cash');
    const transactions = [tx('income', 'income', 100000, { date: '2026-08-20', status: 'executed' })];
    const marketValueSnapshots = values.map(([date, value], index) => ({
      id: String(index), accountId: asset.id, date, marketValueInHaler: value * 100, createdAt: date,
    }));
    const summary = summarizePeriods([period, createBudgetPeriod(2026, 9, 15)],
      { accounts: [asset, cash], transactions, marketValueSnapshots },
      { currentPeriodKey: period.key, today: '2026-09-14' }).getPeriod(period.key)!.projected;

    const valuationChange = (closing - opening) * 100;
    const assetRow = getAccountRow(asset, summary.accountBalances.asset);
    expect(assetRow).toEqual({
      openingInHaler: opening * 100,
      incomingInHaler: Math.max(valuationChange, 0),
      outgoingInHaler: Math.max(-valuationChange, 0),
      netTransfersInHaler: 0,
      netChangeInHaler: valuationChange,
      closingInHaler: closing * 100,
    });
    expect(movementsClose(assetRow)).toBe(closing * 100);
    expect(getAccountRow(cash, summary.accountBalances.cash)).toEqual({
      openingInHaler: 1000000, incomingInHaler: 100000, outgoingInHaler: 0, netTransfersInHaler: 0, netChangeInHaler: 100000, closingInHaler: 1100000,
    });
    expect(summary.closingBalanceInHaler).toBe(closing * 100 + 1100000);
  });
});
