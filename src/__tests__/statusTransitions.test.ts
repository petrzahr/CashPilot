import { describe, it, expect } from 'vitest';
import { Account, AppSettings, RecurringRule, Transaction } from '../types/finance';
import { calculateForecast, getEffectiveTransactionsForPeriod } from '../services/financialEngine';
import { createBudgetPeriod, generatePeriodsSequence } from '../services/periodService';
import { calculateIntraDayRunningBalances } from '../services/sequenceService';

describe('Transaction Status Transitions & Financial Engine', () => {
  const defaultSettings: AppSettings = {
    currency: 'CZK',
    budgetStartDay: 15,
    minReserveInHaler: 5000000,
    roundAmounts: false,
  };

  const checkingAcc: Account = {
    id: 'acc_main',
    name: 'Běžný účet',
    type: 'checking',
    currency: 'CZK',
    initialBalanceInHaler: 10000000, // 100 000 Kč
    initialBalanceDate: '2026-09-01',
    isUsableCash: true,
    isNetWorth: true,
    color: '#0284c7',
    sortOrder: 1,
    status: 'active',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  };

  const periodSep = createBudgetPeriod(2026, 9, 15); // 15. 9. 2026 – 14. 10. 2026
  const periodOct = createBudgetPeriod(2026, 10, 15); // 15. 10. 2026 – 14. 11. 2026
  const periods = generatePeriodsSequence(2026, 9, 3, 15);

  it('1. Planned transaction: counted in forecast as expected movement', () => {
    const plannedTx: Transaction = {
      id: 'tx_planned',
      title: 'Očekávaný bonus',
      amountInHaler: 2000000, // 20 000 Kč
      date: '2026-09-20',
      sequence: 1,
      type: 'income',
      sourceAccountId: 'acc_main',
      status: 'planned',
      createdAt: '',
      updatedAt: '',
    };

    const res = calculateForecast(periods, [checkingAcc], [plannedTx], [], [], [], defaultSettings);
    const p1 = res.periods[0];

    expect(p1.incomeInHaler).toBe(2000000);
    expect(p1.closingBalanceInHaler).toBe(12000000); // 100 000 + 20 000
    // Opening balance of next period
    expect(res.periods[1].openingBalanceInHaler).toBe(12000000);
  });

  it('2. Transition planned -> executed: uses actualAmountInHaler if set, otherwise amountInHaler', () => {
    const executedTxWithDiffActual: Transaction = {
      id: 'tx_exec_1',
      title: 'Nákup potravin',
      amountInHaler: 300000, // 3 000 Kč planned
      actualAmountInHaler: 345000, // 3 450 Kč actual
      date: '2026-09-21',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_main',
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const res = calculateForecast(periods, [checkingAcc], [executedTxWithDiffActual], [], [], [], defaultSettings);
    const p1 = res.periods[0];

    // Uses 3 450 Kč instead of 3 000 Kč
    expect(p1.expenseInHaler).toBe(345000);
    expect(p1.closingBalanceInHaler).toBe(10000000 - 345000);
  });

  it('3. Transition planned -> cancelled: excluded from income, expenses, and balances', () => {
    const cancelledTx: Transaction = {
      id: 'tx_cancel_1',
      title: 'Zrušený nákup',
      amountInHaler: 5000000, // 50 000 Kč
      date: '2026-09-22',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_main',
      status: 'cancelled',
      createdAt: '',
      updatedAt: '',
    };

    const res = calculateForecast(periods, [checkingAcc], [cancelledTx], [], [], [], defaultSettings);
    const p1 = res.periods[0];

    expect(p1.expenseInHaler).toBe(0);
    expect(p1.closingBalanceInHaler).toBe(10000000); // unaffected
    expect(res.periods[1].openingBalanceInHaler).toBe(10000000);
  });

  it('4. Transition executed -> planned: clears actualAmount and reverts to amountInHaler', () => {
    // When returning to planned
    const revertedTx: Transaction = {
      id: 'tx_rev',
      title: 'Výdaj na servis',
      amountInHaler: 400000, // 4 000 Kč
      actualAmountInHaler: undefined, // cleared upon return to planned
      date: '2026-09-23',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_main',
      status: 'planned',
      createdAt: '',
      updatedAt: '',
    };

    const res = calculateForecast(periods, [checkingAcc], [revertedTx], [], [], [], defaultSettings);
    const p1 = res.periods[0];

    expect(p1.expenseInHaler).toBe(400000);
    expect(p1.closingBalanceInHaler).toBe(9600000);
  });

  it('5. Transition cancelled -> planned: re-includes movement into calculations and forecast', () => {
    const uncancelledTx: Transaction = {
      id: 'tx_un',
      title: 'Obnovený výdaj',
      amountInHaler: 1500000,
      date: '2026-09-24',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_main',
      status: 'planned',
      createdAt: '',
      updatedAt: '',
    };

    const res = calculateForecast(periods, [checkingAcc], [uncancelledTx], [], [], [], defaultSettings);
    expect(res.periods[0].expenseInHaler).toBe(1500000);
    expect(res.periods[0].closingBalanceInHaler).toBe(8500000);
  });

  it('6. Recurring occurrence status change: instantiating as executed affects only that period', () => {
    const salaryRule: RecurringRule = {
      id: 'rec_salary',
      title: 'Mzda',
      amountInHaler: 6000000, // 60 000 Kč
      type: 'income',
      frequency: 'monthly',
      dayOfMonth: 20,
      startDate: '2026-01-01',
      sourceAccountId: 'acc_main',
      isActive: true,
      createdAt: '',
      updatedAt: '',
    };

    // Virtual occurrence in periodSep
    const effSepBefore = getEffectiveTransactionsForPeriod(periodSep, [], [salaryRule], [], 15, '2026-09-10');
    expect(effSepBefore.length).toBe(1);
    expect(effSepBefore[0].id).toBe('virtual_rec_salary_2026-09');
    expect(effSepBefore[0].status).toBe('planned');

    // Instantiate Sep occurrence as executed with a bonus (65 000 Kč)
    const realSepTx: Transaction = {
      id: 'tx_real_salary_sep',
      title: salaryRule.title,
      amountInHaler: salaryRule.amountInHaler,
      actualAmountInHaler: 6500000,
      date: '2026-09-20',
      sequence: 1,
      type: 'income',
      sourceAccountId: 'acc_main',
      status: 'executed',
      recurringRuleId: salaryRule.id,
      createdAt: '',
      updatedAt: '',
    };

    const effSepAfter = getEffectiveTransactionsForPeriod(periodSep, [realSepTx], [salaryRule], [], 15);
    expect(effSepAfter.length).toBe(1);
    expect(effSepAfter[0].id).toBe('tx_real_salary_sep');
    expect(effSepAfter[0].status).toBe('executed');
    expect(effSepAfter[0].actualAmountInHaler).toBe(6500000);

    // Period Oct still has virtual occurrence from rule untouched
    const effOct = getEffectiveTransactionsForPeriod(periodOct, [realSepTx], [salaryRule], [], 15);
    expect(effOct.length).toBe(1);
    expect(effOct[0].id).toBe('virtual_rec_salary_2026-10');
    expect(effOct[0].status).toBe('planned');
    expect(effOct[0].amountInHaler).toBe(6000000);
  });

  it('7. Recurring occurrence status change: instantiating as cancelled remains visible in period but excluded from calculations', () => {
    const rentRule: RecurringRule = {
      id: 'rec_rent',
      title: 'Nájem',
      amountInHaler: 2500000, // 25 000 Kč
      type: 'expense',
      frequency: 'monthly',
      dayOfMonth: 16,
      startDate: '2026-01-01',
      sourceAccountId: 'acc_main',
      isActive: true,
      createdAt: '',
      updatedAt: '',
    };

    // Cancel this month's rent (e.g. rent holiday)
    const realCancelledRent: Transaction = {
      id: 'tx_real_rent_sep_cancelled',
      title: rentRule.title,
      amountInHaler: rentRule.amountInHaler,
      date: '2026-09-16',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_main',
      status: 'cancelled',
      recurringRuleId: rentRule.id,
      createdAt: '',
      updatedAt: '',
    };

    // It remains visible in effective transactions of periodSep!
    const effSep = getEffectiveTransactionsForPeriod(periodSep, [realCancelledRent], [rentRule], [], 15);
    expect(effSep.length).toBe(1);
    expect(effSep[0].id).toBe('tx_real_rent_sep_cancelled');
    expect(effSep[0].status).toBe('cancelled');

    // Forecast calculation ignores the cancelled rent in Sep
    const res = calculateForecast(periods, [checkingAcc], [realCancelledRent], [rentRule], [], [], defaultSettings);
    expect(res.periods[0].expenseInHaler).toBe(0); // Rent is cancelled!
    expect(res.periods[0].closingBalanceInHaler).toBe(10000000);

    // But in Oct, rent applies normally!
    expect(res.periods[1].expenseInHaler).toBe(2500000);
  });

  it('8. Intra-day running balances: cancelled items do not shift balance, executed items apply actual amount', () => {
    const txPlannedExpense: Transaction = {
      id: 'tx_1',
      title: 'Plánovaný nákup',
      amountInHaler: 100000, // 1 000 Kč
      date: '2026-09-20',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_main',
      status: 'planned',
      createdAt: '',
      updatedAt: '',
    };

    const txCancelledExpense: Transaction = {
      id: 'tx_2',
      title: 'Zrušený nákup',
      amountInHaler: 500000, // 5 000 Kč
      date: '2026-09-20',
      sequence: 2,
      type: 'expense',
      sourceAccountId: 'acc_main',
      status: 'cancelled',
      createdAt: '',
      updatedAt: '',
    };

    const txExecutedIncome: Transaction = {
      id: 'tx_3',
      title: 'Mzda',
      amountInHaler: 5000000,
      actualAmountInHaler: 5500000, // 55 000 Kč actual
      date: '2026-09-20',
      sequence: 3,
      type: 'income',
      sourceAccountId: 'acc_main',
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const startBalance = 1000000; // 10 000 Kč
    const intraDay = calculateIntraDayRunningBalances(startBalance, [
      txPlannedExpense,
      txCancelledExpense,
      txExecutedIncome,
    ]);

    expect(intraDay.steps.length).toBe(3);
    // Step 1: Planned expense (-1 000 Kč)
    expect(intraDay.steps[0].runningBalanceInHaler).toBe(900000);
    // Step 2: Cancelled expense (no balance change!)
    expect(intraDay.steps[1].runningBalanceInHaler).toBe(900000);
    // Step 3: Executed income (+55 000 Kč)
    expect(intraDay.steps[2].runningBalanceInHaler).toBe(900000 + 5500000);
    expect(intraDay.endOfDayBalanceInHaler).toBe(6400000);
  });

  it('9. Account Matrix continuity: Closing balance of period i equals Opening balance of period i+1 for every account', () => {
    const savingsAcc: Account = {
      id: 'acc_sav',
      name: 'Spoření',
      type: 'savings',
      currency: 'CZK',
      initialBalanceInHaler: 50000000, // 500 000 Kč
      initialBalanceDate: '2026-09-01',
      isUsableCash: true,
      isNetWorth: true,
      color: '#10b981',
      sortOrder: 2,
      status: 'active',
      createdAt: '',
      updatedAt: '',
    };

    const txs: Transaction[] = [
      {
        id: 't1',
        title: 'Výplata',
        amountInHaler: 4500000,
        date: '2026-09-20',
        sequence: 1,
        type: 'income',
        sourceAccountId: 'acc_main',
        status: 'executed',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 't2',
        title: 'Převod na spoření',
        amountInHaler: 1000000,
        date: '2026-10-01',
        sequence: 1,
        type: 'transfer',
        sourceAccountId: 'acc_main',
        targetAccountId: 'acc_sav',
        status: 'planned',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 't3',
        title: 'Nákup v říjnu',
        amountInHaler: 250000,
        date: '2026-10-25',
        sequence: 1,
        type: 'expense',
        sourceAccountId: 'acc_main',
        status: 'planned',
        createdAt: '',
        updatedAt: '',
      }
    ];

    const all12Periods = generatePeriodsSequence(2026, 9, 12, 15);
    const res = calculateForecast(all12Periods, [checkingAcc, savingsAcc], txs, [], [], [], defaultSettings);

    expect(res.periods.length).toBe(12);

    for (let i = 0; i < res.periods.length - 1; i++) {
      const cur = res.periods[i];
      const next = res.periods[i + 1];

      // Checking account continuity
      const checkCurClosing = cur.accountBalances['acc_main'].closingBalanceInHaler;
      const checkNextOpening = next.accountBalances['acc_main'].openingBalanceInHaler;
      expect(checkNextOpening).toBe(checkCurClosing);

      // Savings account continuity
      const savCurClosing = cur.accountBalances['acc_sav'].closingBalanceInHaler;
      const savNextOpening = next.accountBalances['acc_sav'].openingBalanceInHaler;
      expect(savNextOpening).toBe(savCurClosing);

      // Total net worth continuity
      expect(next.netWorthOpeningInHaler).toBe(cur.netWorthClosingInHaler);
    }
  });

  it('10. Summary row in Account Matrix respects isNetWorth setting', () => {
    const includedAcc: Account = {
      id: 'acc_inc',
      name: 'Zahrnutý účet',
      type: 'checking',
      currency: 'CZK',
      initialBalanceInHaler: 1000000, // 10 000 Kč
      initialBalanceDate: '2026-09-01',
      isUsableCash: true,
      isNetWorth: true,
      color: '#0284c7',
      sortOrder: 1,
      status: 'active',
      createdAt: '',
      updatedAt: '',
    };

    const excludedAcc: Account = {
      id: 'acc_exc',
      name: 'Nezahrnutý účet',
      type: 'other',
      currency: 'CZK',
      initialBalanceInHaler: 5000000, // 50 000 Kč
      initialBalanceDate: '2026-09-01',
      isUsableCash: false,
      isNetWorth: false, // EXCLUDED from net worth
      color: '#94a3b8',
      sortOrder: 2,
      status: 'active',
      createdAt: '',
      updatedAt: '',
    };

    const res = calculateForecast(periods, [includedAcc, excludedAcc], [], [], [], [], defaultSettings);
    const p1 = res.periods[0];

    // Total opening in net worth includes ONLY includedAcc (10 000 Kč), NOT excludedAcc (50 000 Kč)
    expect(p1.netWorthOpeningInHaler).toBe(1000000);
    expect(p1.netWorthClosingInHaler).toBe(1000000);
  });
});
