import { describe, expect, it } from 'vitest';
import {
  getDefaultAccountPeriodTotals,
  getOverdraftLimitInHaler,
  getSourceAccountBalanceByTxId,
  groupDaysWithRunningBalance,
} from '../services/budgetBalances';
import { Account, AccountPeriodBalance, Transaction } from '../types/finance';

const period = { startDate: '2026-09-15', endDate: '2026-10-14' };

const account = (overrides: Partial<Account> = {}): Account => ({
  id: 'chk', name: 'Běžný účet', type: 'checking', currency: 'CZK',
  initialBalanceInHaler: 1000000, initialBalanceDate: '2026-01-01',
  isUsableCash: true, isNetWorth: true, isDefault: true, color: '', sortOrder: 1, status: 'active',
  createdAt: '', updatedAt: '',
  ...overrides,
});

const balance = (overrides: Partial<AccountPeriodBalance> = {}): AccountPeriodBalance => ({
  accountId: 'chk', openingBalanceInHaler: 100000, incomeInHaler: 50000, expenseInHaler: 20000,
  transfersInInHaler: 3000, transfersOutInHaler: 8000, correctionsInHaler: -500, closingBalanceInHaler: 124500,
  ...overrides,
});

let seq = 0;
const tx = (overrides: Partial<Transaction>): Transaction => ({
  id: `t${++seq}`, title: '', type: 'expense', amountInHaler: 0, sourceAccountId: 'chk',
  date: '2026-09-20', status: 'planned', createdAt: '', updatedAt: '',
  ...overrides,
} as Transaction);

describe('getOverdraftLimitInHaler', () => {
  it('prefers the overdraft limit, falls back to the legacy minimum reserve, then 0', () => {
    expect(getOverdraftLimitInHaler({ overdraftLimitInHaler: 0, minReserveInHaler: 500 })).toBe(0);
    expect(getOverdraftLimitInHaler({ minReserveInHaler: 500 })).toBe(500);
    expect(getOverdraftLimitInHaler({})).toBe(0);
  });
});

describe('getDefaultAccountPeriodTotals', () => {
  it('sums flows into the net change and takes the closing balance from the forecast', () => {
    const totals = getDefaultAccountPeriodTotals(account(), balance(), period, 200000);
    expect(totals).toEqual({
      openingInHaler: 100000,
      incomeInHaler: 50000,
      expenseInHaler: 20000,
      netTransfersInHaler: -5000,
      netChangeInHaler: 24500,
      closingInHaler: 124500,
      withOverdraftInHaler: 324500,
      isOverdraftExceeded: false,
    });
  });

  it('adds the initial balance when the account is activated after the first day of the period', () => {
    const acc = account({ initialBalanceDate: '2026-09-25' });
    const totals = getDefaultAccountPeriodTotals(acc, balance({ openingBalanceInHaler: 0 }), period, 0);
    expect(totals.netChangeInHaler).toBe(24500 + 1000000);
  });

  it('does not add the initial balance on the first day of the period or outside it', () => {
    for (const initialBalanceDate of ['2026-09-15', '2026-09-14', '2026-10-15']) {
      const totals = getDefaultAccountPeriodTotals(account({ initialBalanceDate }), balance(), period, 0);
      expect(totals.netChangeInHaler).toBe(24500);
    }
  });

  it('computes the closing balance from opening and net change when the forecast has no balance', () => {
    const totals = getDefaultAccountPeriodTotals(account({ initialBalanceDate: '2026-10-01' }), undefined, period, 0);
    expect(totals.closingInHaler).toBe(1000000);
    expect(getDefaultAccountPeriodTotals(undefined, null, period, 300).closingInHaler).toBe(0);
  });

  it('flags the overdraft as exceeded only below zero', () => {
    expect(getDefaultAccountPeriodTotals(account(), balance({ closingBalanceInHaler: -200000 }), period, 200000).isOverdraftExceeded).toBe(false);
    const exceeded = getDefaultAccountPeriodTotals(account(), balance({ closingBalanceInHaler: -200001 }), period, 200000);
    expect(exceeded.withOverdraftInHaler).toBe(-1);
    expect(exceeded.isOverdraftExceeded).toBe(true);
  });
});

describe('groupDaysWithRunningBalance', () => {
  it('groups by ascending date and carries the usable-cash balance across days', () => {
    const late = tx({ date: '2026-09-22', type: 'income', amountInHaler: 1000 });
    const early = tx({ date: '2026-09-20', amountInHaler: 300 });
    const foreign = tx({ date: '2026-09-20', sourceAccountId: 'other', amountInHaler: 999 });
    const groups = groupDaysWithRunningBalance([late, early, foreign], 500, new Set(['chk']));

    expect(groups.map(g => g.date)).toEqual(['2026-09-20', '2026-09-22']);
    expect(groups[0].txs).toEqual([early, foreign]);
    expect(groups[0].intraDay.startOfDayBalanceInHaler).toBe(500);
    expect(groups[0].intraDay.endOfDayBalanceInHaler).toBe(200);
    expect(groups[1].intraDay.startOfDayBalanceInHaler).toBe(200);
    expect(groups[1].intraDay.endOfDayBalanceInHaler).toBe(1200);
  });

  it('keeps cancelled items in the day without changing the balance', () => {
    const cancelled = tx({ amountInHaler: 300, status: 'cancelled' });
    const [group] = groupDaysWithRunningBalance([cancelled], 500, new Set(['chk']));
    expect(group.txs).toEqual([cancelled]);
    expect(group.intraDay.endOfDayBalanceInHaler).toBe(500);
  });
});

describe('getSourceAccountBalanceByTxId', () => {
  it('replays each account in day order and reports the balance only where the account is the source', () => {
    const balances = {
      chk: balance({ openingBalanceInHaler: 1000 }),
      sav: balance({ accountId: 'sav', openingBalanceInHaler: 50 }),
    };
    const expense = tx({ date: '2026-09-20', amountInHaler: 300, sequence: 2 });
    const transfer = tx({ date: '2026-09-20', type: 'transfer', amountInHaler: 200, targetAccountId: 'sav', sequence: 1 });
    const back = tx({ date: '2026-09-21', type: 'transfer', amountInHaler: 100, sourceAccountId: 'sav', targetAccountId: 'chk' });
    const income = tx({ date: '2026-09-22', type: 'income', amountInHaler: 40, status: 'executed', actualAmountInHaler: 45 });

    const result = getSourceAccountBalanceByTxId([income, back, expense, transfer], balances);

    expect(result.get(transfer.id)).toBe(800);
    expect(result.get(expense.id)).toBe(500);
    expect(result.get(back.id)).toBe(150); // sav: 50 + 200 − 100
    expect(result.get(income.id)).toBe(645); // chk: 500 + 100 + actual 45
    expect(result.size).toBe(4);
  });

  it('starts an account missing from the summary at zero and skips cancelled items', () => {
    const cancelled = tx({ amountInHaler: 300, status: 'cancelled', sourceAccountId: 'new', sequence: 1 });
    const expense = tx({ amountInHaler: 100, sourceAccountId: 'new', sequence: 2 });
    const result = getSourceAccountBalanceByTxId([cancelled, expense], {});
    expect(result.get(cancelled.id)).toBe(0);
    expect(result.get(expense.id)).toBe(-100);
  });
});
