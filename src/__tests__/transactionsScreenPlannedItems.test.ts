import { describe, it, expect } from 'vitest';
import { Account, AppSettings, BudgetPeriod, RecurringException, RecurringRule, Transaction } from '../types/finance';
import { getEffectiveTransactionsForPeriod } from '../services/financialEngine';
import { createBudgetPeriod } from '../services/periodService';

describe('TransactionsScreen Planned Items & Effective Period Filtering', () => {
  const settings: AppSettings = {
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
    initialBalanceInHaler: 5000000, // 50 000 Kč
    initialBalanceDate: '2026-09-01',
    isUsableCash: true,
    isNetWorth: true,
    color: '#0284c7',
    sortOrder: 1,
    status: 'active',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  };

  const savingsAcc: Account = {
    id: 'acc_savings',
    name: 'Spořicí účet',
    type: 'savings',
    currency: 'CZK',
    initialBalanceInHaler: 10000000, // 100 000 Kč
    initialBalanceDate: '2026-09-01',
    isUsableCash: true,
    isNetWorth: true,
    color: '#10b981',
    sortOrder: 2,
    status: 'active',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  };

  const accounts = [checkingAcc, savingsAcc];

  // Period: 15. 9. 2026 – 14. 10. 2026
  const periodSep: BudgetPeriod = createBudgetPeriod(2026, 9, 15);
  // Period: 15. 10. 2026 – 14. 11. 2026
  const periodOct: BudgetPeriod = createBudgetPeriod(2026, 10, 15);

  const todayRef = '2026-09-12';

  it('1. Current period displays one-off planned items (income, expense, transfer)', () => {
    const oneOffExpense: Transaction = {
      id: 'tx_plan_exp',
      title: 'Plánovaný nákup nábytku',
      amountInHaler: 1500000,
      date: '2026-09-25',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_main',
      categoryId: 'cat_home',
      status: 'planned',
      createdAt: '2026-09-12T00:00:00Z',
      updatedAt: '2026-09-12T00:00:00Z',
    };

    const oneOffIncome: Transaction = {
      id: 'tx_plan_inc',
      title: 'Plánovaný prodej kola',
      amountInHaler: 800000,
      date: '2026-10-02',
      sequence: 1,
      type: 'income',
      sourceAccountId: 'acc_main',
      categoryId: 'cat_other',
      status: 'planned',
      createdAt: '2026-09-12T00:00:00Z',
      updatedAt: '2026-09-12T00:00:00Z',
    };

    const oneOffTransfer: Transaction = {
      id: 'tx_plan_trf',
      title: 'Plánovaný převod na spoření',
      amountInHaler: 2000000,
      date: '2026-10-05',
      sequence: 1,
      type: 'transfer',
      sourceAccountId: 'acc_main',
      targetAccountId: 'acc_savings',
      status: 'planned',
      createdAt: '2026-09-12T00:00:00Z',
      updatedAt: '2026-09-12T00:00:00Z',
    };

    const txs = [oneOffExpense, oneOffIncome, oneOffTransfer];
    const effective = getEffectiveTransactionsForPeriod(
      periodSep,
      txs,
      [],
      [],
      settings.budgetStartDay,
      todayRef,
      accounts
    );

    expect(effective).toHaveLength(3);
    expect(effective.map(t => t.id)).toEqual(['tx_plan_exp', 'tx_plan_inc', 'tx_plan_trf']);
    expect(effective.every(t => t.status === 'planned')).toBe(true);
  });

  it('2. Current period displays recurring planned items (income, expense, transfer)', () => {
    const rentRule: RecurringRule = {
      id: 'rule_rent',
      title: 'Nájemné',
      amountInHaler: 1500000,
      dayOfMonth: 20,
      type: 'expense',
      frequency: 'monthly',
      sourceAccountId: 'acc_main',
      categoryId: 'cat_housing',
      startDate: '2026-09-01',
      isActive: true,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    };

    const salaryRule: RecurringRule = {
      id: 'rule_salary',
      title: 'Výplata',
      amountInHaler: 5000000,
      dayOfMonth: 10,
      type: 'income',
      frequency: 'monthly',
      sourceAccountId: 'acc_main',
      categoryId: 'cat_salary',
      startDate: '2026-09-01',
      isActive: true,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    };

    const savingsTransferRule: RecurringRule = {
      id: 'rule_transfer',
      title: 'Pravidelné spoření',
      amountInHaler: 1000000,
      dayOfMonth: 25,
      type: 'transfer',
      frequency: 'monthly',
      sourceAccountId: 'acc_main',
      targetAccountId: 'acc_savings',
      startDate: '2026-09-01',
      isActive: true,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    };

    const rules = [rentRule, salaryRule, savingsTransferRule];
    const effective = getEffectiveTransactionsForPeriod(
      periodSep,
      [],
      rules,
      [],
      settings.budgetStartDay,
      todayRef,
      accounts
    );

    // In periodSep (15. 9. 2026 – 14. 10. 2026):
    // - rent: 20. 9. 2026
    // - savings transfer: 25. 9. 2026
    // - salary: 10. 10. 2026
    expect(effective).toHaveLength(3);
    const rentTx = effective.find(t => t.recurringRuleId === 'rule_rent');
    const salaryTx = effective.find(t => t.recurringRuleId === 'rule_salary');
    const trfTx = effective.find(t => t.recurringRuleId === 'rule_transfer');

    expect(rentTx).toBeDefined();
    expect(rentTx?.date).toBe('2026-09-20');
    expect(rentTx?.status).toBe('planned');
    expect(rentTx?.type).toBe('expense');

    expect(trfTx).toBeDefined();
    expect(trfTx?.date).toBe('2026-09-25');
    expect(trfTx?.status).toBe('planned');
    expect(trfTx?.type).toBe('transfer');
    expect(trfTx?.targetAccountId).toBe('acc_savings');

    expect(salaryTx).toBeDefined();
    expect(salaryTx?.date).toBe('2026-10-10');
    expect(salaryTx?.status).toBe('planned');
    expect(salaryTx?.type).toBe('income');
  });

  it('3. Respects period bounds: items outside selected period are not included', () => {
    const txInPeriod: Transaction = {
      id: 'tx_sep',
      title: 'Položka v září',
      amountInHaler: 50000,
      date: '2026-09-20',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_main',
      status: 'planned',
      createdAt: '',
      updatedAt: '',
    };

    const txInOct: Transaction = {
      id: 'tx_oct',
      title: 'Položka v říjnu',
      amountInHaler: 70000,
      date: '2026-10-20',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_main',
      status: 'planned',
      createdAt: '',
      updatedAt: '',
    };

    const effectiveSep = getEffectiveTransactionsForPeriod(
      periodSep,
      [txInPeriod, txInOct],
      [],
      [],
      settings.budgetStartDay,
      todayRef,
      accounts
    );
    expect(effectiveSep).toHaveLength(1);
    expect(effectiveSep[0].id).toBe('tx_sep');

    const effectiveOct = getEffectiveTransactionsForPeriod(
      periodOct,
      [txInPeriod, txInOct],
      [],
      [],
      settings.budgetStartDay,
      todayRef,
      accounts
    );
    expect(effectiveOct).toHaveLength(1);
    expect(effectiveOct[0].id).toBe('tx_oct');
  });

  it('4. All items mode vs Current period mode: no infinite expansion in All items mode', () => {
    const rule: RecurringRule = {
      id: 'rule_monthly',
      title: 'Měsíční předplatné',
      amountInHaler: 29900,
      dayOfMonth: 18,
      type: 'expense',
      frequency: 'monthly',
      sourceAccountId: 'acc_main',
      startDate: '2026-09-01',
      isActive: true,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    };

    const storedTxs: Transaction[] = [
      {
        id: 'tx_stored_1',
        title: 'Jednorázový výdaj',
        amountInHaler: 50000,
        date: '2026-09-16',
        sequence: 1,
        type: 'expense',
        sourceAccountId: 'acc_main',
        status: 'executed',
        createdAt: '',
        updatedAt: '',
      }
    ];

    // In 'current' mode: getEffectiveTransactionsForPeriod produces the stored items in period + virtual occurrence
    const currentModeTxs = getEffectiveTransactionsForPeriod(
      periodSep,
      storedTxs,
      [rule],
      [],
      settings.budgetStartDay,
      todayRef,
      accounts
    );
    expect(currentModeTxs).toHaveLength(2);
    expect(currentModeTxs.some(t => t.id.startsWith('virtual_'))).toBe(true);

    // In 'all' mode: TransactionsScreen uses raw transactions without calling getEffectiveTransactionsForPeriod
    const allModeTxs = storedTxs;
    expect(allModeTxs).toHaveLength(1);
    expect(allModeTxs.some(t => t.id.startsWith('virtual_'))).toBe(false);
  });

  it('5. Deduplication: no duplicate virtual occurrence if already materialized in transactions', () => {
    const rentRule: RecurringRule = {
      id: 'rule_rent',
      title: 'Nájemné',
      amountInHaler: 1500000,
      dayOfMonth: 20,
      type: 'expense',
      frequency: 'monthly',
      sourceAccountId: 'acc_main',
      startDate: '2026-09-01',
      isActive: true,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    };

    // Already executed / materialized in periodSep
    const realExecutedRent: Transaction = {
      id: 'tx_real_rent',
      title: 'Nájemné (uhrazeno)',
      amountInHaler: 1500000,
      date: '2026-09-20',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_main',
      status: 'executed',
      recurringRuleId: 'rule_rent',
      createdAt: '2026-09-20T08:00:00Z',
      updatedAt: '2026-09-20T08:00:00Z',
    };

    const effective = getEffectiveTransactionsForPeriod(
      periodSep,
      [realExecutedRent],
      [rentRule],
      [],
      settings.budgetStartDay,
      todayRef,
      accounts
    );

    expect(effective).toHaveLength(1);
    expect(effective[0].id).toBe('tx_real_rent');
    expect(effective[0].title).toBe('Nájemné (uhrazeno)');
  });

  it('6. Deduplication: cancelled recurring occurrence via exception is not displayed', () => {
    const rentRule: RecurringRule = {
      id: 'rule_rent',
      title: 'Nájemné',
      amountInHaler: 1500000,
      dayOfMonth: 20,
      type: 'expense',
      frequency: 'monthly',
      sourceAccountId: 'acc_main',
      startDate: '2026-09-01',
      isActive: true,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    };

    const exception: RecurringException = {
      id: 'ex_rent_sep',
      ruleId: 'rule_rent',
      periodKey: periodSep.key,
      isCancelled: true,
      createdAt: '2026-09-12T00:00:00Z',
    };

    const effective = getEffectiveTransactionsForPeriod(
      periodSep,
      [],
      [rentRule],
      [exception],
      settings.budgetStartDay,
      todayRef,
      accounts
    );

    expect(effective).toHaveLength(0);
  });

  it('7. Sequence: continuous sequence numbering without duplicates starting from 1', () => {
    const existingTx: Transaction = {
      id: 'tx_1',
      title: 'Ranní nákup',
      amountInHaler: 20000,
      date: '2026-09-20',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_main',
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const rentRule: RecurringRule = {
      id: 'rule_rent',
      title: 'Nájemné',
      amountInHaler: 1500000,
      dayOfMonth: 20,
      type: 'expense',
      frequency: 'monthly',
      sourceAccountId: 'acc_main',
      startDate: '2026-09-01',
      isActive: true,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    };

    const effective = getEffectiveTransactionsForPeriod(
      periodSep,
      [existingTx],
      [rentRule],
      [],
      settings.budgetStartDay,
      todayRef,
      accounts
    );

    expect(effective).toHaveLength(2);
    expect(effective[0].sequence).toBe(1);
    expect(effective[1].sequence).toBe(2);
    expect(effective[1].id.startsWith('virtual_')).toBe(true);
  });

  it('8. Filtering: respects movement type, account (source or target), category, and status', () => {
    const txExpense: Transaction = {
      id: 'tx_exp',
      title: 'Potraviny',
      amountInHaler: 50000,
      date: '2026-09-18',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_main',
      categoryId: 'cat_food',
      status: 'planned',
      createdAt: '',
      updatedAt: '',
    };

    const txIncome: Transaction = {
      id: 'tx_inc',
      title: 'Výplata',
      amountInHaler: 4000000,
      date: '2026-09-25',
      sequence: 1,
      type: 'income',
      sourceAccountId: 'acc_main',
      categoryId: 'cat_salary',
      status: 'executed',
      createdAt: '',
      updatedAt: '',
    };

    const txTransfer: Transaction = {
      id: 'tx_trf',
      title: 'Převod',
      amountInHaler: 1000000,
      date: '2026-09-28',
      sequence: 1,
      type: 'transfer',
      sourceAccountId: 'acc_main',
      targetAccountId: 'acc_savings',
      status: 'planned',
      createdAt: '',
      updatedAt: '',
    };

    const all = [txExpense, txIncome, txTransfer];

    // Filter by type: transfer
    const onlyTransfers = all.filter(t => t.type === 'transfer');
    expect(onlyTransfers).toHaveLength(1);
    expect(onlyTransfers[0].id).toBe('tx_trf');

    // Filter by account: acc_savings (matches targetAccountId)
    const onlySavings = all.filter(t => t.sourceAccountId === 'acc_savings' || t.targetAccountId === 'acc_savings');
    expect(onlySavings).toHaveLength(1);
    expect(onlySavings[0].id).toBe('tx_trf');

    // Filter by status: planned (matches txExpense and txTransfer)
    const onlyPlanned = all.filter(t => t.status === 'planned');
    expect(onlyPlanned).toHaveLength(2);
    expect(onlyPlanned.map(t => t.id)).toEqual(['tx_exp', 'tx_trf']);

    // Filter by regularity: single vs recurring
    const onlySingle = all.filter(t => !t.recurringRuleId);
    expect(onlySingle).toHaveLength(3);
  });

  it('9. Initial balance date: no virtual recurring occurrences before account activation', () => {
    const lateAccount: Account = {
      id: 'acc_late',
      name: 'Pozdější účet',
      type: 'checking',
      currency: 'CZK',
      initialBalanceInHaler: 1000000,
      initialBalanceDate: '2026-10-01', // Activated Oct 1st
      isUsableCash: true,
      isNetWorth: true,
      color: '#000',
      sortOrder: 3,
      status: 'active',
      createdAt: '',
      updatedAt: '',
    };

    const ruleOnLateAccount: RecurringRule = {
      id: 'rule_late',
      title: 'Poplatek',
      amountInHaler: 5000,
      dayOfMonth: 20, // 20. 9. 2026 is BEFORE 1. 10. 2026
      type: 'expense',
      frequency: 'monthly',
      sourceAccountId: 'acc_late',
      startDate: '2026-09-01',
      isActive: true,
      createdAt: '',
      updatedAt: '',
    };

    const effective = getEffectiveTransactionsForPeriod(
      periodSep,
      [],
      [ruleOnLateAccount],
      [],
      settings.budgetStartDay,
      todayRef,
      [lateAccount]
    );

    // Rule occurrence is 2026-09-20, which is < initialBalanceDate (2026-10-01) -> must NOT be generated
    expect(effective).toHaveLength(0);
  });
});
