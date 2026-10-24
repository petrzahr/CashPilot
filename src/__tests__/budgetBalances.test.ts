import { describe, expect, it } from 'vitest';
import { getSourceAccountBalanceByTxId, groupDaysWithRunningBalance } from '../services/budgetBalances';
import { AccountPeriodBalance, PeriodSummary, PeriodView, Transaction } from '../types/finance';

/** Period view with a projected usable opening and recorded account balances (the only parts read here). */
const periodView = (usableOpeningInHaler: number, accountBalances: Record<string, AccountPeriodBalance> = {}): PeriodView => ({
  projected: { usableOpeningInHaler } as PeriodSummary,
  recorded: { accountBalances } as PeriodSummary,
} as PeriodView);

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

describe('groupDaysWithRunningBalance', () => {
  it('groups by ascending date and carries the usable-cash balance across days', () => {
    const late = tx({ date: '2026-09-22', type: 'income', amountInHaler: 1000 });
    const early = tx({ date: '2026-09-20', amountInHaler: 300 });
    const foreign = tx({ date: '2026-09-20', sourceAccountId: 'other', amountInHaler: 999 });
    const groups = groupDaysWithRunningBalance([late, early, foreign], periodView(500), new Set(['chk']));

    expect(groups.map(g => g.date)).toEqual(['2026-09-20', '2026-09-22']);
    expect(groups[0].txs).toEqual([early, foreign]);
    expect(groups[0].intraDay.startOfDayBalanceInHaler).toBe(500);
    expect(groups[0].intraDay.endOfDayBalanceInHaler).toBe(200);
    expect(groups[1].intraDay.startOfDayBalanceInHaler).toBe(200);
    expect(groups[1].intraDay.endOfDayBalanceInHaler).toBe(1200);
  });

  it('keeps cancelled items in the day without changing the balance', () => {
    const cancelled = tx({ amountInHaler: 300, status: 'cancelled' });
    const [group] = groupDaysWithRunningBalance([cancelled], periodView(500), new Set(['chk']));
    expect(group.txs).toEqual([cancelled]);
    expect(group.intraDay.endOfDayBalanceInHaler).toBe(500);
  });

  it('starts at zero without a period view', () => {
    const [group] = groupDaysWithRunningBalance([tx({ amountInHaler: 300 })], undefined, new Set(['chk']));
    expect(group.intraDay.endOfDayBalanceInHaler).toBe(-300);
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

    const result = getSourceAccountBalanceByTxId([income, back, expense, transfer], periodView(999999, balances));

    expect(result.get(transfer.id)).toBe(800);
    expect(result.get(expense.id)).toBe(500);
    expect(result.get(back.id)).toBe(150); // sav: 50 + 200 − 100
    expect(result.get(income.id)).toBe(645); // chk: 500 + 100 + actual 45
    expect(result.size).toBe(4);
  });

  it('starts an account missing from the summary at zero and skips cancelled items', () => {
    const cancelled = tx({ amountInHaler: 300, status: 'cancelled', sourceAccountId: 'new', sequence: 1 });
    const expense = tx({ amountInHaler: 100, sourceAccountId: 'new', sequence: 2 });
    const result = getSourceAccountBalanceByTxId([cancelled, expense], periodView(0));
    expect(result.get(cancelled.id)).toBe(0);
    expect(result.get(expense.id)).toBe(-100);
  });
});
