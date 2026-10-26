import { describe, expect, it } from 'vitest';
import { calculateForecast, getOverdraftLimitInHaler, summarizePeriods } from '../services/financialEngine';
import { createBudgetPeriod } from '../services/periodService';
import { getInitialData } from '../services/storageService';
import { Account, AccountType, Transaction } from '../types/finance';

const period = createBudgetPeriod(2026, 9, 15); // 2026-09-15 .. 2026-10-14

const account = (id: string, type: AccountType, overrides: Partial<Account> = {}): Account => ({
  id, name: id, type, currency: 'CZK',
  initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01',
  isUsableCash: type === 'checking' || type === 'cash', isNetWorth: true,
  color: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '',
  ...overrides,
});

let seq = 0;
const tx = (overrides: Partial<Transaction> & Pick<Transaction, 'type' | 'sourceAccountId' | 'amountInHaler'>): Transaction => ({
  id: `t${++seq}`, title: '', date: '2026-10-01', sequence: 1, status: 'planned', createdAt: '', updatedAt: '',
  ...overrides,
});

const checking = account('chk', 'checking', { isDefault: true, initialBalanceInHaler: 1000000 });
const savings = account('sav', 'savings');
const investment = account('inv', 'investment');
const pension = account('pen', 'pension');

const view = (accounts: Account[], transactions: Transaction[], overdraftLimitInHaler = 0) =>
  summarizePeriods([period], { accounts, transactions }, { today: '2026-09-20', currentPeriodKey: period.key, overdraftLimitInHaler })
    .getPeriod(period.key)!;

const flows = () => [
  tx({ type: 'income', sourceAccountId: 'chk', amountInHaler: 50000 }),
  tx({ type: 'expense', sourceAccountId: 'chk', amountInHaler: 20000 }),
  tx({ type: 'transfer', sourceAccountId: 'sav', targetAccountId: 'chk', amountInHaler: 3000 }),
  tx({ type: 'transfer', sourceAccountId: 'chk', targetAccountId: 'sav', amountInHaler: 8000 }),
  tx({ type: 'balance_adjustment', sourceAccountId: 'chk', amountInHaler: 500, diffInHaler: -500 }),
];

describe('getOverdraftLimitInHaler', () => {
  it('prefers the overdraft limit, falls back to the legacy minimum reserve, then 0', () => {
    expect(getOverdraftLimitInHaler({ overdraftLimitInHaler: 0, minReserveInHaler: 500 })).toBe(0);
    expect(getOverdraftLimitInHaler({ minReserveInHaler: 500 })).toBe(500);
    expect(getOverdraftLimitInHaler({})).toBe(0);
  });
});

describe('forecast.getPeriod', () => {
  it('returns undefined outside the period sequence', () => {
    expect(summarizePeriods([period], { accounts: [checking] }).getPeriod('1999-01')).toBeUndefined();
  });

  it('projects current and future periods and uses the recorded summary for past ones', () => {
    const data = { ...getInitialData(), accounts: [checking] };
    const forecast = calculateForecast(data, { today: '2026-09-20' });
    const current = forecast.getPeriod('2026-09')!;
    expect(current.projected).toBe(forecast.forecastPeriods![0]);
    expect(current.recorded).toBe(forecast.periods.find(p => p.period.key === '2026-09'));
    const past = forecast.getPeriod('2026-05')!;
    expect(past.projected).toBe(past.recorded);
    expect(past.period.key).toBe('2026-05');
  });

  it('computes the default account once and remembers it', () => {
    const v = view([checking, savings], flows());
    expect(v.defaultAccount).toBe(v.defaultAccount);
  });

  it('takes the overdraft limit from the settings', () => {
    const data = { ...getInitialData(), accounts: [checking] };
    data.settings = { ...data.settings, overdraftLimitInHaler: 300 };
    const v = calculateForecast(data, { today: '2026-09-20' }).getPeriod('2026-09')!;
    expect(v.defaultAccount.withOverdraftInHaler).toBe(v.defaultAccount.closingInHaler + 300);
  });
});

describe('PeriodView.defaultAccount totals', () => {
  it('sums flows into the net change and takes the closing balance from the summary', () => {
    expect(view([checking, savings], flows(), 200000).defaultAccount).toMatchObject({
      openingInHaler: 1000000,
      incomeInHaler: 50000,
      expenseInHaler: 20000,
      netTransfersInHaler: -5000,
      netChangeInHaler: 24500,
      closingInHaler: 1024500,
      withOverdraftInHaler: 1224500,
      isOverdraftExceeded: false,
    });
  });

  it('adds the initial balance when the account is activated after the first day of the period', () => {
    const activated = { ...checking, initialBalanceDate: '2026-09-25' };
    const totals = view([activated, savings], flows()).defaultAccount;
    expect(totals.openingInHaler).toBe(0);
    expect(totals.netChangeInHaler).toBe(24500 + 1000000);
    expect(totals.closingInHaler).toBe(1024500);
  });

  it('does not add the initial balance on the first day of the period or before it', () => {
    for (const initialBalanceDate of ['2026-09-15', '2026-09-14']) {
      const totals = view([{ ...checking, initialBalanceDate }, savings], flows()).defaultAccount;
      expect(totals.openingInHaler).toBe(1000000);
      expect(totals.netChangeInHaler).toBe(24500);
    }
  });

  it('flags the overdraft as exceeded only below zero', () => {
    const empty = { ...checking, initialBalanceInHaler: 0 };
    expect(view([empty], [tx({ type: 'expense', sourceAccountId: 'chk', amountInHaler: 200000 })], 200000)
      .defaultAccount.isOverdraftExceeded).toBe(false);
    const exceeded = view([empty], [tx({ type: 'expense', sourceAccountId: 'chk', amountInHaler: 200001 })], 200000).defaultAccount;
    expect(exceeded.withOverdraftInHaler).toBe(-1);
    expect(exceeded.isOverdraftExceeded).toBe(true);
  });

  it('is all zero without a default account, with the overdraft limit on top', () => {
    const totals = view([{ ...checking, isDefault: false }, savings], flows(), 300).defaultAccount;
    expect(totals).toEqual({
      openingInHaler: 0, incomeInHaler: 0, expenseInHaler: 0, netTransfersInHaler: 0, netChangeInHaler: 0,
      closingInHaler: 0, withOverdraftInHaler: 300, isOverdraftExceeded: false,
      actuallySavedInHaler: 0, actuallySavedPct: null,
      savedInHaler: 0, savedPct: null,
      investedInHaler: 0, investedPct: null,
    });
  });
});

describe('PeriodView.defaultAccount KPIs', () => {
  const checking2 = account('chk2', 'checking');
  const accounts = [checking, checking2, savings, investment, pension];

  it('Skutečně uspořeno = příjmy − výdaje + korekce výchozího účtu', () => {
    const kpis = view(accounts, [
      tx({ type: 'income', sourceAccountId: 'chk', amountInHaler: 500000 }),
      tx({ type: 'expense', sourceAccountId: 'chk', amountInHaler: 200000 }),
      tx({ type: 'balance_adjustment', sourceAccountId: 'chk', amountInHaler: 30000, diffInHaler: 30000 }),
      tx({ type: 'income', sourceAccountId: 'chk2', amountInHaler: 900000 }),
    ]).defaultAccount;
    expect(kpis.actuallySavedInHaler).toBe(330000);
    expect(kpis.actuallySavedPct).toBeCloseTo(66, 6);
  });

  it('Uspořeno a Investováno jsou čisté převody mezi výchozím účtem a spořicími / investičními a penzijními účty', () => {
    const kpis = view(accounts, [
      tx({ type: 'income', sourceAccountId: 'chk', amountInHaler: 1000000 }),
      tx({ type: 'transfer', sourceAccountId: 'chk', targetAccountId: 'sav', amountInHaler: 200000 }),
      tx({ type: 'transfer', sourceAccountId: 'sav', targetAccountId: 'chk', amountInHaler: 50000 }),
      tx({ type: 'transfer', sourceAccountId: 'chk', targetAccountId: 'inv', amountInHaler: 100000 }),
      tx({ type: 'transfer', sourceAccountId: 'chk', targetAccountId: 'pen', amountInHaler: 17000 }),
      tx({ type: 'transfer', sourceAccountId: 'chk', targetAccountId: 'sav', amountInHaler: 99000, status: 'cancelled' }),
      tx({ type: 'transfer', sourceAccountId: 'chk2', targetAccountId: 'sav', amountInHaler: 30000 }),
    ]).defaultAccount;
    expect(kpis.savedInHaler).toBe(150000);
    expect(kpis.savedPct).toBe(15);
    expect(kpis.investedInHaler).toBe(117000);
    expect(kpis.investedPct).toBeCloseTo(11.7, 6);
    expect(kpis.actuallySavedInHaler).toBe(1000000);
  });

  it('procenta jsou null, když výchozí účet nemá v období příjmy', () => {
    const kpis = view(accounts, [tx({ type: 'expense', sourceAccountId: 'chk', amountInHaler: 20000 })]).defaultAccount;
    expect(kpis.actuallySavedInHaler).toBe(-20000);
    expect([kpis.actuallySavedPct, kpis.savedPct, kpis.investedPct]).toEqual([null, null, null]);
  });

  it('counts recurring occurrences the forecast generates for the period', () => {
    const forecast = summarizePeriods([period], {
      accounts,
      recurringRules: [{
        id: 'r', title: 'Spoření', type: 'transfer', amountInHaler: 40000, sourceAccountId: 'chk', targetAccountId: 'sav',
        dayOfMonth: 20, frequency: 'monthly', startDate: '2026-01-20', isActive: true, createdAt: '', updatedAt: '',
      }],
    }, { today: '2026-09-20', currentPeriodKey: period.key });
    expect(forecast.getPeriod(period.key)!.defaultAccount.savedInHaler).toBe(40000);
  });
});

describe('PeriodView.defaultAccountSplit', () => {
  // today = 2026-09-20 (see view)
  const mixed = () => [
    tx({ type: 'income', sourceAccountId: 'chk', amountInHaler: 50000, actualAmountInHaler: 48000, status: 'executed', date: '2026-09-16' }),
    tx({ type: 'expense', sourceAccountId: 'chk', amountInHaler: 10000, status: 'executed', date: '2026-09-20' }),
    tx({ type: 'expense', sourceAccountId: 'chk', amountInHaler: 7000, status: 'planned', date: '2026-09-18' }),
    tx({ type: 'expense', sourceAccountId: 'chk', amountInHaler: 3000, status: 'executed', date: '2026-10-02' }),
    tx({ type: 'income', sourceAccountId: 'chk', amountInHaler: 20000, status: 'planned', date: '2026-10-05' }),
    tx({ type: 'expense', sourceAccountId: 'chk', amountInHaler: 99000, status: 'cancelled', date: '2026-10-06' }),
    tx({ type: 'balance_adjustment', sourceAccountId: 'chk', amountInHaler: 500, diffInHaler: -500, status: 'executed', date: '2026-09-19' }),
    tx({ type: 'transfer', sourceAccountId: 'chk', targetAccountId: 'sav', amountInHaler: 8000, date: '2026-10-01' }),
  ];

  it('splits into executed items dated up to today and the remaining planned items', () => {
    const { executed, planned } = view([checking, savings], mixed()).defaultAccountSplit;
    expect(executed).toMatchObject({ incomeInHaler: 48000, expenseInHaler: 10000, correctionsInHaler: -500, actuallySavedInHaler: 37500 });
    // planned expense dated in the past and executed expense dated in the future both still count as planned
    expect(planned).toMatchObject({ incomeInHaler: 20000, expenseInHaler: 10000, correctionsInHaler: 0, actuallySavedInHaler: 10000 });
  });

  it('splits net transfers, Uspořeno and Investováno; percentages are of the part\'s own income', () => {
    const v = view([checking, savings, investment], [
      tx({ type: 'income', sourceAccountId: 'chk', amountInHaler: 100000, status: 'executed', date: '2026-09-16' }),
      tx({ type: 'income', sourceAccountId: 'chk', amountInHaler: 50000, date: '2026-10-01' }),
      tx({ type: 'transfer', sourceAccountId: 'chk', targetAccountId: 'sav', amountInHaler: 20000, status: 'executed', date: '2026-09-17' }),
      tx({ type: 'transfer', sourceAccountId: 'sav', targetAccountId: 'chk', amountInHaler: 5000, status: 'executed', date: '2026-09-18' }),
      tx({ type: 'transfer', sourceAccountId: 'chk', targetAccountId: 'inv', amountInHaler: 10000, date: '2026-10-02' }),
      tx({ type: 'transfer', sourceAccountId: 'chk', targetAccountId: 'sav', amountInHaler: 7000, status: 'cancelled', date: '2026-10-03' }),
    ]);
    const { executed, planned } = v.defaultAccountSplit;
    expect(executed).toMatchObject({ netTransfersInHaler: -15000, savedInHaler: 15000, savedPct: 15, investedInHaler: 0, investedPct: 0 });
    expect(executed.actuallySavedPct).toBe(100);
    expect(planned).toMatchObject({ netTransfersInHaler: -10000, savedInHaler: 0, investedInHaler: 10000, investedPct: 20 });
    expect(executed.netTransfersInHaler + planned.netTransfersInHaler).toBe(v.defaultAccount.netTransfersInHaler);
    expect(executed.savedInHaler + planned.savedInHaler).toBe(v.defaultAccount.savedInHaler);
    expect(executed.investedInHaler + planned.investedInHaler).toBe(v.defaultAccount.investedInHaler);
  });

  it('has null percentages for a part without income', () => {
    const { executed } = view([checking, savings], [
      tx({ type: 'income', sourceAccountId: 'chk', amountInHaler: 50000, date: '2026-10-01' }),
      tx({ type: 'transfer', sourceAccountId: 'chk', targetAccountId: 'sav', amountInHaler: 1000, status: 'executed', date: '2026-09-16' }),
    ]).defaultAccountSplit;
    expect([executed.actuallySavedPct, executed.savedPct, executed.investedPct]).toEqual([null, null, null]);
    expect(executed.savedInHaler).toBe(1000);
  });

  it('adds up to the default account totals', () => {
    const v = view([checking, savings], mixed());
    const { executed, planned } = v.defaultAccountSplit;
    expect(executed.incomeInHaler + planned.incomeInHaler).toBe(v.defaultAccount.incomeInHaler);
    expect(executed.expenseInHaler + planned.expenseInHaler).toBe(v.defaultAccount.expenseInHaler);
    expect(executed.actuallySavedInHaler + planned.actuallySavedInHaler).toBe(v.defaultAccount.actuallySavedInHaler);
  });

  it('counts virtual recurring occurrences as planned and exposes them in the period items', () => {
    const forecast = summarizePeriods([period], {
      accounts: [checking],
      recurringRules: [{
        id: 'r', title: 'Nájem', type: 'expense', amountInHaler: 15000, sourceAccountId: 'chk',
        dayOfMonth: 1, frequency: 'monthly', startDate: '2026-01-01', isActive: true, createdAt: '', updatedAt: '',
      }],
    }, { today: '2026-09-20', currentPeriodKey: period.key });
    const v = forecast.getPeriod(period.key)!;
    expect(v.items.some(t => t.recurringRuleId === 'r' && t.date === '2026-10-01')).toBe(true);
    expect(v.defaultAccountSplit.planned.expenseInHaler).toBe(15000);
    expect(v.defaultAccountSplit.executed.expenseInHaler).toBe(0);
  });

  it('ignores items of other accounts and items before the default account was activated', () => {
    const activated = { ...checking, initialBalanceDate: '2026-10-01' };
    const { planned } = view([activated, account('chk2', 'checking')], [
      tx({ type: 'expense', sourceAccountId: 'chk', amountInHaler: 4000, date: '2026-09-25' }),
      tx({ type: 'expense', sourceAccountId: 'chk2', amountInHaler: 6000, date: '2026-10-03' }),
      tx({ type: 'expense', sourceAccountId: 'chk', amountInHaler: 1000, date: '2026-10-03' }),
    ]).defaultAccountSplit;
    expect(planned.expenseInHaler).toBe(1000);
  });

  it('is all executed in a past period whose items were executed', () => {
    const v = summarizePeriods([period], {
      accounts: [checking],
      transactions: [tx({ type: 'expense', sourceAccountId: 'chk', amountInHaler: 4000, status: 'executed', date: '2026-10-01' })],
    }, { today: '2026-11-01' }).getPeriod(period.key)!;
    expect(v.defaultAccountSplit.planned).toMatchObject({
      incomeInHaler: 0, expenseInHaler: 0, correctionsInHaler: 0, netTransfersInHaler: 0,
      actuallySavedInHaler: 0, savedInHaler: 0, investedInHaler: 0,
    });
    expect(v.defaultAccountSplit.executed.expenseInHaler).toBe(4000);
  });

  it('is all zero without a default account and remembers the result', () => {
    const v = view([{ ...checking, isDefault: false }], mixed());
    expect(v.defaultAccountSplit.planned.incomeInHaler).toBe(0);
    expect(v.defaultAccountSplit.executed.incomeInHaler).toBe(0);
    expect(v.defaultAccountSplit).toBe(v.defaultAccountSplit);
  });
});

describe('PeriodView.actual', () => {
  // today = 2026-09-20 (see view)
  const cash = account('cash', 'cash', { initialBalanceInHaler: 5000 });
  const items = () => [
    tx({ type: 'income', sourceAccountId: 'chk', amountInHaler: 50000, status: 'executed', date: '2026-09-16' }),
    tx({ type: 'expense', sourceAccountId: 'chk', amountInHaler: 7000, date: '2026-09-18' }),
    tx({ type: 'expense', sourceAccountId: 'chk', amountInHaler: 3000, status: 'executed', date: '2026-10-02' }),
    tx({ type: 'transfer', sourceAccountId: 'chk', targetAccountId: 'sav', amountInHaler: 20000, status: 'executed', date: '2026-09-17' }),
  ];

  it('holds today\'s balances from executed items dated up to today', () => {
    const actual = view([checking, cash, savings, { ...pension, isNetWorth: false }], items()).actual!;
    expect(actual.accountBalances).toEqual({ chk: 1030000, cash: 5000, sav: 20000, pen: 0 });
    expect(actual.usableInHaler).toBe(1035000);
    expect(actual.netWorthInHaler).toBe(1055000);
    const v = view([checking], items());
    expect(v.actual).toBe(v.actual);
  });

  it('is undefined for periods that do not contain today', () => {
    expect(summarizePeriods([period], { accounts: [checking], transactions: items() }, { today: '2026-11-01' })
      .getPeriod(period.key)!.actual).toBeUndefined();
    expect(summarizePeriods([period], { accounts: [checking], transactions: items() }, { today: '2026-09-14' })
      .getPeriod(period.key)!.actual).toBeUndefined();
  });
});
