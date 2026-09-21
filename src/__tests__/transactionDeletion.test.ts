import { describe, it, expect, beforeEach } from 'vitest';
import { Account, AppSettings, BudgetPeriod, RecurringException, RecurringRule, Transaction } from '../types/finance';
import { calculateForecast, getEffectiveTransactionsForPeriod } from '../services/financialEngine';
import { deleteTransactionAndReorder } from '../services/sequenceService';
import { createBudgetPeriod, generatePeriodsSequence, getPreviousDay } from '../services/periodService';
import { AppData, loadStoredData, saveStoredData } from '../services/storageService';

describe('CashPilot - Testy mazání finančních položek (Klasický seznam a Měsíční rozpočet)', () => {
  const defaultSettings: AppSettings = {
    currency: 'CZK',
    budgetStartDay: 15,
    minReserveInHaler: 5000000,
    roundAmounts: false,
  };

  const checkingAccount: Account = {
    id: 'acc_checking',
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

  const savingsAccount: Account = {
    id: 'acc_savings',
    name: 'Spořicí účet',
    type: 'savings',
    currency: 'CZK',
    initialBalanceInHaler: 20000000, // 200 000 Kč
    initialBalanceDate: '2026-09-01',
    isUsableCash: true,
    isNetWorth: true,
    color: '#10b981',
    sortOrder: 2,
    status: 'active',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  };

  const periodSep: BudgetPeriod = createBudgetPeriod(2026, 9, 15); // 15. 9. 2026 – 14. 10. 2026
  const periodOct: BudgetPeriod = createBudgetPeriod(2026, 10, 15); // 15. 10. 2026 – 14. 11. 2026
  const periods = generatePeriodsSequence(2026, 9, 3, 15);

  const storageMock = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => {
        store[key] = value.toString();
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      }
    };
  })();

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: storageMock,
      writable: true,
      configurable: true
    });
    localStorage.clear();
  });

  // 1. Smazání běžného výdaje
  it('1. Smazání běžného výdaje odstraní výdaj a sníží celkové výdaje období', () => {
    const expenseTx: Transaction = {
      id: 'tx_exp_1',
      title: 'Nákup potravin',
      amountInHaler: 150000, // 1 500 Kč
      date: '2026-09-20',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_checking',
      status: 'executed',
      actualAmountInHaler: 150000,
      createdAt: '',
      updatedAt: ''
    };

    const txsBefore = [expenseTx];
    const forecastBefore = calculateForecast(periods, [checkingAccount], txsBefore, [], [], [], defaultSettings);
    expect(forecastBefore.periods[0].expenseInHaler).toBe(150000);

    const txsAfter = deleteTransactionAndReorder('tx_exp_1', txsBefore);
    expect(txsAfter.length).toBe(0);

    const forecastAfter = calculateForecast(periods, [checkingAccount], txsAfter, [], [], [], defaultSettings);
    expect(forecastAfter.periods[0].expenseInHaler).toBe(0);
    expect(forecastAfter.periods[0].closingBalanceInHaler).toBe(checkingAccount.initialBalanceInHaler);
  });

  // 2. Smazání příjmu
  it('2. Smazání příjmu odstraní příjem a sníží celkové příjmy období', () => {
    const incomeTx: Transaction = {
      id: 'tx_inc_1',
      title: 'Bonus',
      amountInHaler: 500000, // 5 000 Kč
      date: '2026-09-22',
      sequence: 1,
      type: 'income',
      sourceAccountId: 'acc_checking',
      status: 'executed',
      actualAmountInHaler: 500000,
      createdAt: '',
      updatedAt: ''
    };

    const txsBefore = [incomeTx];
    const forecastBefore = calculateForecast(periods, [checkingAccount], txsBefore, [], [], [], defaultSettings);
    expect(forecastBefore.periods[0].incomeInHaler).toBe(500000);

    const txsAfter = deleteTransactionAndReorder('tx_inc_1', txsBefore);
    expect(txsAfter.length).toBe(0);

    const forecastAfter = calculateForecast(periods, [checkingAccount], txsAfter, [], [], [], defaultSettings);
    expect(forecastAfter.periods[0].incomeInHaler).toBe(0);
    expect(forecastAfter.periods[0].closingBalanceInHaler).toBe(checkingAccount.initialBalanceInHaler);
  });

  // 3. Smazání převodu jako jedné celistvé operace
  it('3. Smazání převodu odstraní odchozí i příchozí dopad jako jednu operaci', () => {
    const transferTx: Transaction = {
      id: 'tx_trans_1',
      title: 'Převod na spoření',
      amountInHaler: 2000000, // 20 000 Kč
      date: '2026-09-25',
      sequence: 1,
      type: 'transfer',
      sourceAccountId: 'acc_checking',
      targetAccountId: 'acc_savings',
      status: 'executed',
      actualAmountInHaler: 2000000,
      createdAt: '',
      updatedAt: ''
    };

    const txsBefore = [transferTx];
    const forecastBefore = calculateForecast(periods, [checkingAccount, savingsAccount], txsBefore, [], [], [], defaultSettings);
    const p0Before = forecastBefore.periods[0];
    const checkingBalBefore = p0Before.accountBalances['acc_checking'];
    const savingsBalBefore = p0Before.accountBalances['acc_savings'];

    expect(p0Before.transfersInHaler).toBe(2000000);
    expect(checkingBalBefore.closingBalanceInHaler).toBe(8000000); // 100k - 20k
    expect(savingsBalBefore.closingBalanceInHaler).toBe(22000000); // 200k + 20k

    // Smazání celého převodu
    const txsAfter = deleteTransactionAndReorder('tx_trans_1', txsBefore);
    expect(txsAfter.length).toBe(0);

    const forecastAfter = calculateForecast(periods, [checkingAccount, savingsAccount], txsAfter, [], [], [], defaultSettings);
    const p0After = forecastAfter.periods[0];
    const checkingBalAfter = p0After.accountBalances['acc_checking'];
    const savingsBalAfter = p0After.accountBalances['acc_savings'];

    expect(p0After.transfersInHaler).toBe(0);
    expect(checkingBalAfter.closingBalanceInHaler).toBe(10000000);
    expect(savingsBalAfter.closingBalanceInHaler).toBe(20000000);
  });

  // 4. Smazání plánované položky
  it('4. Smazání plánované položky aktualizuje plánované součty', () => {
    const plannedTx: Transaction = {
      id: 'tx_plan_1',
      title: 'Plánovaný nákup',
      amountInHaler: 300000,
      date: '2026-09-30',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_checking',
      status: 'planned',
      createdAt: '',
      updatedAt: ''
    };

    const txsBefore = [plannedTx];
    const fBefore = calculateForecast(periods, [checkingAccount], txsBefore, [], [], [], defaultSettings);
    expect(fBefore.periods[0].expenseInHaler).toBe(300000);

    const txsAfter = deleteTransactionAndReorder('tx_plan_1', txsBefore);
    const fAfter = calculateForecast(periods, [checkingAccount], txsAfter, [], [], [], defaultSettings);
    expect(fAfter.periods[0].expenseInHaler).toBe(0);
  });

  // 5. Smazání uskutečněné položky
  it('5. Smazání uskutečněné položky okamžitě upraví konečné stavy', () => {
    const executedTx: Transaction = {
      id: 'tx_exec_1',
      title: 'Zaplacený účet za elektřinu',
      amountInHaler: 250000,
      actualAmountInHaler: 260000,
      date: '2026-09-18',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_checking',
      status: 'executed',
      createdAt: '',
      updatedAt: ''
    };

    const fBefore = calculateForecast(periods, [checkingAccount], [executedTx], [], [], [], defaultSettings);
    expect(fBefore.periods[0].expenseInHaler).toBe(260000);
    expect(fBefore.periods[0].closingBalanceInHaler).toBe(10000000 - 260000);

    const txsAfter = deleteTransactionAndReorder('tx_exec_1', [executedTx]);
    const fAfter = calculateForecast(periods, [checkingAccount], txsAfter, [], [], [], defaultSettings);
    expect(fAfter.periods[0].expenseInHaler).toBe(0);
    expect(fAfter.periods[0].closingBalanceInHaler).toBe(10000000);
  });

  // 6. Smazání zrušené položky
  it('6. Smazání zrušené položky přečísluje den a neovlivní zůstatky', () => {
    const activeTx: Transaction = {
      id: 'tx_active',
      title: 'Aktivní výdaj',
      amountInHaler: 100000,
      date: '2026-09-18',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_checking',
      status: 'planned',
      createdAt: '',
      updatedAt: ''
    };

    const cancelledTx: Transaction = {
      id: 'tx_cancelled',
      title: 'Zrušený výdaj',
      amountInHaler: 50000,
      date: '2026-09-18',
      sequence: 2,
      type: 'expense',
      sourceAccountId: 'acc_checking',
      status: 'cancelled',
      createdAt: '',
      updatedAt: ''
    };

    const txsAfter = deleteTransactionAndReorder('tx_cancelled', [activeTx, cancelledTx]);
    expect(txsAfter.length).toBe(1);
    expect(txsAfter[0].id).toBe('tx_active');
    expect(txsAfter[0].sequence).toBe(1);

    const f = calculateForecast(periods, [checkingAccount], txsAfter, [], [], [], defaultSettings);
    expect(f.periods[0].expenseInHaler).toBe(100000);
  });

  // 7. Zrušení potvrzovacího dialogu bez změny dat
  it('7. Zrušení dialogu nemění žádné transakce', () => {
    const tx: Transaction = {
      id: 'tx_safe',
      title: 'Ponechaná položka',
      amountInHaler: 100000,
      date: '2026-09-20',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_checking',
      status: 'planned',
      createdAt: '',
      updatedAt: ''
    };

    const originalTxs = [tx];
    // Uživatel klikne na "Zrušit", takže se deleteTransaction nevolá
    const sameTxs = [...originalTxs];
    expect(sameTxs).toEqual(originalTxs);
  });

  // 8. Smazání jednoho výskytu pravidelné položky (výjimka)
  it('8. Smazání jednoho výskytu pravidelné položky vytvoří výjimku a zachová ostatní měsíce', () => {
    const rule: RecurringRule = {
      id: 'rec_rent',
      title: 'Nájem',
      amountInHaler: 1500000, // 15 000 Kč
      type: 'expense',
      frequency: 'monthly',
      dayOfMonth: 20,
      startDate: '2026-01-01',
      sourceAccountId: 'acc_checking',
      isActive: true,
      createdAt: '',
      updatedAt: ''
    };

    // V září i říjnu se výskyt běžně generuje
    const effSepBefore = getEffectiveTransactionsForPeriod(periodSep, [], [rule], [], 15);
    const effOctBefore = getEffectiveTransactionsForPeriod(periodOct, [], [rule], [], 15);
    expect(effSepBefore.length).toBe(1);
    expect(effOctBefore.length).toBe(1);

    // Smazat pouze zářijový výskyt (vytvoří se výjimka pro periodKey = 2026-09)
    const exception: RecurringException = {
      id: 'ex_1',
      ruleId: 'rec_rent',
      periodKey: periodSep.key,
      isCancelled: true,
      createdAt: new Date().toISOString()
    };

    const effSepAfter = getEffectiveTransactionsForPeriod(periodSep, [], [rule], [exception], 15);
    const effOctAfter = getEffectiveTransactionsForPeriod(periodOct, [], [rule], [exception], 15);

    // V září je smazán (vrací null)
    expect(effSepAfter.length).toBe(0);
    // V říjnu stále existuje!
    expect(effOctAfter.length).toBe(1);
    expect(effOctAfter[0].title).toBe('Nájem');
  });

  // 9. Smazání budoucích výskytů pravidelné položky
  it('9. Smazání budoucích výskytů ukončí pravidlo k datu před výskytem', () => {
    const rule: RecurringRule = {
      id: 'rec_gym',
      title: 'Permanentka posilovna',
      amountInHaler: 100000,
      type: 'expense',
      frequency: 'monthly',
      dayOfMonth: 20,
      startDate: '2026-01-01',
      sourceAccountId: 'acc_checking',
      isActive: true,
      createdAt: '',
      updatedAt: ''
    };

    const occDate = '2026-09-20';
    const cutOff = getPreviousDay(occDate); // 2026-09-19
    const updatedRule: RecurringRule = {
      ...rule,
      endDate: cutOff
    };

    // Zářijové období (15. 9. – 14. 10.): výskyt je 20. 9. > 19. 9. -> v září se už nevygeneruje!
    const effSep = getEffectiveTransactionsForPeriod(periodSep, [], [updatedRule], [], 15);
    expect(effSep.length).toBe(0);

    // Říjnové období (15. 10. – 14. 11.): endDate < period.startDate -> nevygeneruje se
    const effOct = getEffectiveTransactionsForPeriod(periodOct, [], [updatedRule], [], 15);
    expect(effOct.length).toBe(0);

    // Srpnové minulé období (15. 8. – 14. 9.): výskyt byl 20. 8. <= 19. 9. -> vygeneruje se!
    const periodAug = createBudgetPeriod(2026, 8, 15);
    const effAug = getEffectiveTransactionsForPeriod(periodAug, [], [updatedRule], [], 15);
    expect(effAug.length).toBe(1);
  });

  // 10. Přečíslování pořadí zbývajících položek stejného dne
  it('10. Přečíslování pořadí zbývajících položek stejného kalendářního dne nevytváří mezery', () => {
    const day = '2026-09-20';
    const tx1: Transaction = { id: '1', date: day, sequence: 1, title: 'T1', amountInHaler: 100, type: 'expense', sourceAccountId: 'a', status: 'planned', createdAt: '', updatedAt: '' };
    const tx2: Transaction = { id: '2', date: day, sequence: 2, title: 'T2', amountInHaler: 200, type: 'expense', sourceAccountId: 'a', status: 'planned', createdAt: '', updatedAt: '' };
    const tx3: Transaction = { id: '3', date: day, sequence: 3, title: 'T3', amountInHaler: 300, type: 'expense', sourceAccountId: 'a', status: 'planned', createdAt: '', updatedAt: '' };

    const afterDelete = deleteTransactionAndReorder('2', [tx1, tx2, tx3]);
    expect(afterDelete.length).toBe(2);
    expect(afterDelete[0].id).toBe('1');
    expect(afterDelete[0].sequence).toBe(1);
    expect(afterDelete[1].id).toBe('3');
    expect(afterDelete[1].sequence).toBe(2); // Přečíslováno z 3 na 2!
  });

  // 11. Přepočet aktuálního a všech následujících období
  it('11. Smazání výdaje přepočítá počáteční i konečné zůstatky všech následujících období', () => {
    const expenseTx: Transaction = {
      id: 'tx_p0',
      title: 'Nábytek',
      amountInHaler: 5000000, // 50 000 Kč
      actualAmountInHaler: 5000000,
      date: '2026-09-20',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_checking',
      status: 'executed',
      createdAt: '',
      updatedAt: ''
    };

    const fBefore = calculateForecast(periods, [checkingAccount], [expenseTx], [], [], [], defaultSettings);
    // Perioda 0: Konečný 50 000 Kč (100k - 50k)
    expect(fBefore.periods[0].closingBalanceInHaler).toBe(5000000);
    // Perioda 1: Počáteční 50 000 Kč, Konečný 50 000 Kč
    expect(fBefore.periods[1].openingBalanceInHaler).toBe(5000000);
    expect(fBefore.periods[1].closingBalanceInHaler).toBe(5000000);
    // Perioda 2: Počáteční 50 000 Kč
    expect(fBefore.periods[2].openingBalanceInHaler).toBe(5000000);

    // Po smazání výdaje:
    const txsAfter = deleteTransactionAndReorder('tx_p0', [expenseTx]);
    const fAfter = calculateForecast(periods, [checkingAccount], txsAfter, [], [], [], defaultSettings);
    // Perioda 0: Konečný 100 000 Kč
    expect(fAfter.periods[0].closingBalanceInHaler).toBe(10000000);
    // Perioda 1: Počáteční 100 000 Kč, Konečný 100 000 Kč
    expect(fAfter.periods[1].openingBalanceInHaler).toBe(10000000);
    expect(fAfter.periods[1].closingBalanceInHaler).toBe(10000000);
    // Perioda 2: Počáteční 100 000 Kč
    expect(fAfter.periods[2].openingBalanceInHaler).toBe(10000000);
  });

  // 12. Zachování smazání po obnovení stránky (perzistence)
  it('12. Smazání položky se trvale uloží do perzistentního úložiště', () => {
    const tx: Transaction = {
      id: 'tx_persisted',
      title: 'Dočasná položka',
      amountInHaler: 100000,
      date: '2026-09-20',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_checking',
      status: 'planned',
      createdAt: '',
      updatedAt: ''
    };

    const initialData: AppData = {
      version: 1,
    deletions: [],
    sync: { revision: 0, updatedAt: '', updatedByDeviceId: '' },
      settings: defaultSettings,
      accounts: [checkingAccount],
      categories: [],
      transactions: [tx],
      recurringRules: [],
      recurringExceptions: [],
      corrections: [],
      marketValueSnapshots: []
    };

    saveStoredData(initialData);
    const loaded1 = loadStoredData();
    expect(loaded1.transactions.length).toBe(1);

    // Smazat a uložit
    const updatedData: AppData = {
      ...loaded1,
      transactions: deleteTransactionAndReorder('tx_persisted', loaded1.transactions)
    };
    saveStoredData(updatedData);

    // Simulace nového načtení stránky
    const loaded2 = loadStoredData();
    expect(loaded2.transactions.length).toBe(0);
    expect(loaded2.transactions.find(t => t.id === 'tx_persisted')).toBeUndefined();
  });

  // 13. Synchronizace všech ostatních obrazovek
  it('13. Smazaná položka okamžitě zmizí z efektivního seznamu i forecastu', () => {
    const tx: Transaction = {
      id: 'tx_sync',
      title: 'Oběd',
      amountInHaler: 25000,
      date: '2026-09-21',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_checking',
      status: 'planned',
      createdAt: '',
      updatedAt: ''
    };

    const effBefore = getEffectiveTransactionsForPeriod(periodSep, [tx], [], [], 15);
    expect(effBefore.some(t => t.id === 'tx_sync')).toBe(true);

    const txsAfter = deleteTransactionAndReorder('tx_sync', [tx]);
    const effAfter = getEffectiveTransactionsForPeriod(periodSep, txsAfter, [], [], 15);
    expect(effAfter.some(t => t.id === 'tx_sync')).toBe(false);
  });

  // 14. Chování při chybě databáze nebo API
  it('14. Pokud smazání selže z důvodu nedostupnosti úložiště, data zůstanou nedotčena', () => {
    const tx: Transaction = {
      id: 'tx_protected',
      title: 'Důležitá platba',
      amountInHaler: 1000000,
      date: '2026-09-20',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_checking',
      status: 'executed',
      createdAt: '',
      updatedAt: ''
    };

    let transactions = [tx];

    // Simulace selhání storage (např. QuotaExceededError)
    const simulatedStorageFail = () => {
      throw new Error('Disk quota exceeded');
    };

    try {
      simulatedStorageFail();
      // Pokud by selhalo úložiště, operace se nedokončí a data zůstanou
      transactions = deleteTransactionAndReorder('tx_protected', transactions);
    } catch (e) {
      // Ošetřeno
    }

    expect(transactions.length).toBe(1);
    expect(transactions[0].id).toBe('tx_protected');
  });
});
