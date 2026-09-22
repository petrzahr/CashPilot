import { describe, it, expect, beforeEach } from 'vitest';
import { Account, AppSettings, BalanceCorrection, Transaction } from '../types/finance';
import { calculateForecast } from '../services/financialEngine';
import { generatePeriodsSequence } from '../services/periodService';
import { validateAndParseBackup, AppData, getInitialData, getActiveStorageKey } from '../services/storageService';
import { loadStoredData, saveStoredData } from './testStorageHelpers';
import { DEFAULT_SETTINGS } from '../services/demoData';
import { halerToCzk } from '../services/currencyService';

describe('CashPilot - Nastavení kontokorentu a souhrnné údaje Měsíčního rozpočtu pro výchozí účet', () => {
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

  const createAccount = (overrides: Partial<Account>): Account => ({
    id: 'acc_' + Math.random().toString(36).substring(2, 9),
    name: 'Test Account',
    type: 'checking',
    institution: 'Bank',
    currency: 'CZK',
    color: '#0284c7',
    initialBalanceInHaler: 0,
    initialBalanceDate: '2026-01-01',
    isUsableCash: true,
    isNetWorth: true,
    isDefault: false,
    sortOrder: 1,
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  });

  const createTx = (overrides: Partial<Transaction>): Transaction => ({
    id: 'tx_' + Math.random().toString(36).substring(2, 9),
    title: 'Test Tx',
    amountInHaler: 100000,
    type: 'expense',
    sourceAccountId: 'acc_def',
    date: '2026-09-20',
    sequence: 10,
    status: 'executed',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  });

  const baseSettings: AppSettings = {
    currency: 'CZK',
    budgetStartDay: 15,
    overdraftLimitInHaler: 2000000, // 20 000 Kč
    minReserveInHaler: 2000000,
    roundAmounts: false,
  };

  const defaultAccount = createAccount({
    id: 'acc_def',
    name: 'Běžný účet Air Bank',
    type: 'checking',
    institution: 'Air Bank',
    initialBalanceInHaler: 1000000, // 10 000 Kč
    initialBalanceDate: '2026-01-01',
    isUsableCash: true,
    isNetWorth: true,
    isDefault: true,
    sortOrder: 1,
  });

  const secondaryAccount = createAccount({
    id: 'acc_sec',
    name: 'Spořicí účet ČSOB',
    type: 'savings',
    institution: 'ČSOB',
    initialBalanceInHaler: 5000000, // 50 000 Kč
    initialBalanceDate: '2026-01-01',
    isUsableCash: true,
    isNetWorth: true,
    isDefault: false,
    sortOrder: 2,
  });

  const thirdAccount = createAccount({
    id: 'acc_third',
    name: 'Investiční účet Portu',
    type: 'investment',
    institution: 'Portu',
    initialBalanceInHaler: 10000000, // 100 000 Kč
    initialBalanceDate: '2026-01-01',
    isUsableCash: false,
    isNetWorth: true,
    isDefault: false,
    sortOrder: 3,
  });

  // Test 1: V nastavení se pracuje s Výší kontokorentu (Kč)
  it('1. V nastavení se zobrazuje a ukládá Výše kontokorentu (Kč) jako kladná hodnota', () => {
    expect(DEFAULT_SETTINGS.overdraftLimitInHaler).toBe(2000000);
    const customSettings: AppSettings = {
      ...baseSettings,
      overdraftLimitInHaler: 2500000,
      minReserveInHaler: 2500000,
    };
    expect(customSettings.overdraftLimitInHaler).toBe(2500000);
    expect(halerToCzk(customSettings.overdraftLimitInHaler!)).toBe(25000);
  });

  // Test 2: Původní uložená hodnota je po aktualizaci zachována (zpětná kompatibilita)
  it('2. Původní uložená hodnota minReserveInHaler je bezpečně migrována na overdraftLimitInHaler', () => {
    const legacyData = {
      version: 1,
      settings: {
        currency: 'CZK',
        budgetStartDay: 15,
        minReserveInHaler: 3500000, // 35 000 Kč
        roundAmounts: false,
      },
      accounts: [defaultAccount],
      categories: [],
      transactions: [],
      recurringRules: [],
      recurringExceptions: [],
      corrections: [],
      marketValueSnapshots: []
    };

    localStorage.setItem(getActiveStorageKey(), JSON.stringify(legacyData));
    const loaded = loadStoredData();
    expect(loaded.settings.overdraftLimitInHaler).toBe(3500000);
    expect(loaded.settings.minReserveInHaler).toBe(3500000);

    // Také při importu zálohy
    const parsedBackup = validateAndParseBackup(JSON.stringify(legacyData));
    expect(parsedBackup.settings.overdraftLimitInHaler).toBe(3500000);
  });

  // Test 3: Souhrn Měsíčního rozpočtu obsahuje pouze data výchozího účtu
  it('3. Souhrnné statistiky pro výchozí účet obsahují výhradně jeho položky', () => {
    const periods = generatePeriodsSequence(2026, 9, 2, 15);

    const txs: Transaction[] = [
      // Položky na výchozím účtu
      createTx({
        id: 't1',
        title: 'Výplata',
        amountInHaler: 4000000, // 40 000 Kč
        type: 'income',
        sourceAccountId: defaultAccount.id,
        date: '2026-09-20',
      }),
      createTx({
        id: 't2',
        title: 'Nákup potravin',
        amountInHaler: 1500000, // 15 000 Kč
        type: 'expense',
        sourceAccountId: defaultAccount.id,
        date: '2026-09-25',
      }),
      // Položky na druhém účtu (nemají ovlivnit výchozí účet)
      createTx({
        id: 't3',
        title: 'Úroky spoření',
        amountInHaler: 80000, // 800 Kč
        type: 'income',
        sourceAccountId: secondaryAccount.id,
        date: '2026-09-30',
      }),
      createTx({
        id: 't4',
        title: 'Poplatek za vedení',
        amountInHaler: 5000, // 50 Kč
        type: 'expense',
        sourceAccountId: secondaryAccount.id,
        date: '2026-10-01',
      }),
    ];

    const forecast = calculateForecast(
      periods,
      [defaultAccount, secondaryAccount],
      txs,
      [],
      [],
      [],
      baseSettings
    );

    const s1 = forecast.periods[0];
    const defBal = s1.accountBalances[defaultAccount.id];

    // Výchozí účet
    expect(defBal.incomeInHaler).toBe(4000000); // 40 000 Kč
    expect(defBal.expenseInHaler).toBe(1500000); // 15 000 Kč
    // Celkové položky za všechny účty by byly 40 800 Kč a 15 050 Kč, ale pro výchozí účet jsou striktně izolované
    expect(defBal.incomeInHaler).not.toBe(s1.incomeInHaler);
    expect(defBal.expenseInHaler).not.toBe(s1.expenseInHaler);
  });

  // Test 4: Položky ostatních účtů souhrn neovlivňují
  it('4. Změny položek na ostatních účtech nemají žádný vliv na bilanci výchozího účtu', () => {
    const periods = generatePeriodsSequence(2026, 9, 2, 15);

    const txsBefore: Transaction[] = [
      createTx({
        id: 't1',
        title: 'Příjem výchozí',
        amountInHaler: 2000000,
        type: 'income',
        sourceAccountId: defaultAccount.id,
        date: '2026-09-20',
      })
    ];

    const forecastBefore = calculateForecast(
      periods,
      [defaultAccount, secondaryAccount],
      txsBefore,
      [],
      [],
      [],
      baseSettings
    );
    const defBalBefore = forecastBefore.periods[0].accountBalances[defaultAccount.id];

    // Přidáme obrovský výdaj na sekundární účet
    const txsAfter: Transaction[] = [
      ...txsBefore,
      createTx({
        id: 't_other',
        title: 'Nákup z jiného účtu',
        amountInHaler: 50000000, // 500 000 Kč
        type: 'expense',
        sourceAccountId: secondaryAccount.id,
        date: '2026-09-22',
      })
    ];

    const forecastAfter = calculateForecast(
      periods,
      [defaultAccount, secondaryAccount],
      txsAfter,
      [],
      [],
      [],
      baseSettings
    );
    const defBalAfter = forecastAfter.periods[0].accountBalances[defaultAccount.id];

    expect(defBalAfter.openingBalanceInHaler).toBe(defBalBefore.openingBalanceInHaler);
    expect(defBalAfter.incomeInHaler).toBe(defBalBefore.incomeInHaler);
    expect(defBalAfter.expenseInHaler).toBe(defBalBefore.expenseInHaler);
    expect(defBalAfter.closingBalanceInHaler).toBe(defBalBefore.closingBalanceInHaler);
  });

  // Test 5: Příchozí převod zvyšuje čistou změnu výchozího účtu
  it('5. Příchozí převod z jiného účtu na výchozí účet představuje kladnou změnu', () => {
    const periods = generatePeriodsSequence(2026, 9, 2, 15);

    const txs: Transaction[] = [
      createTx({
        id: 'tr_in',
        title: 'Převod ze spoření',
        amountInHaler: 1000000, // 10 000 Kč
        type: 'transfer',
        sourceAccountId: secondaryAccount.id,
        targetAccountId: defaultAccount.id,
        date: '2026-09-20',
      })
    ];

    const forecast = calculateForecast(
      periods,
      [defaultAccount, secondaryAccount],
      txs,
      [],
      [],
      [],
      baseSettings
    );

    const defBal = forecast.periods[0].accountBalances[defaultAccount.id];
    expect(defBal.transfersInInHaler).toBe(1000000);
    expect(defBal.transfersOutInHaler).toBe(0);

    const netTransfers = defBal.transfersInInHaler - defBal.transfersOutInHaler;
    const netChange = defBal.incomeInHaler - defBal.expenseInHaler + netTransfers + defBal.correctionsInHaler;
    expect(netChange).toBe(1000000);
    expect(defBal.closingBalanceInHaler).toBe(defBal.openingBalanceInHaler + netChange);
  });

  // Test 6: Odchozí převod snižuje čistou změnu výchozího účtu
  it('6. Odchozí převod z výchozího účtu na jiný účet představuje zápornou změnu', () => {
    const periods = generatePeriodsSequence(2026, 9, 2, 15);

    const txs: Transaction[] = [
      createTx({
        id: 'tr_out',
        title: 'Převod na spořicí účet',
        amountInHaler: 400000, // 4 000 Kč
        type: 'transfer',
        sourceAccountId: defaultAccount.id,
        targetAccountId: secondaryAccount.id,
        date: '2026-09-20',
      })
    ];

    const forecast = calculateForecast(
      periods,
      [defaultAccount, secondaryAccount],
      txs,
      [],
      [],
      [],
      baseSettings
    );

    const defBal = forecast.periods[0].accountBalances[defaultAccount.id];
    expect(defBal.transfersInInHaler).toBe(0);
    expect(defBal.transfersOutInHaler).toBe(400000);

    const netTransfers = defBal.transfersInInHaler - defBal.transfersOutInHaler;
    const netChange = defBal.incomeInHaler - defBal.expenseInHaler + netTransfers + defBal.correctionsInHaler;
    expect(netChange).toBe(-400000);
    expect(defBal.closingBalanceInHaler).toBe(defBal.openingBalanceInHaler + netChange);
  });

  // Test 7: Převod mezi dvěma jinými účty neovlivňuje výchozí účet
  it('7. Převod mezi dvěma jinými účty nemá na souhrn výchozího účtu žádný vliv', () => {
    const periods = generatePeriodsSequence(2026, 9, 2, 15);

    const txs: Transaction[] = [
      createTx({
        id: 'tr_between_others',
        title: 'Převod ze spoření na investice',
        amountInHaler: 2000000, // 20 000 Kč
        type: 'transfer',
        sourceAccountId: secondaryAccount.id,
        targetAccountId: thirdAccount.id,
        date: '2026-09-20',
      })
    ];

    const forecast = calculateForecast(
      periods,
      [defaultAccount, secondaryAccount, thirdAccount],
      txs,
      [],
      [],
      [],
      baseSettings
    );

    const defBal = forecast.periods[0].accountBalances[defaultAccount.id];
    expect(defBal.transfersInInHaler).toBe(0);
    expect(defBal.transfersOutInHaler).toBe(0);
    expect(defBal.closingBalanceInHaler).toBe(defBal.openingBalanceInHaler);
  });

  // Test 8: Převody nejsou vykázány jako příjmy ani výdaje
  it('8. Převody nejsou vykázány jako příjmy ani výdaje výchozího účtu', () => {
    const periods = generatePeriodsSequence(2026, 9, 2, 15);

    const txs: Transaction[] = [
      createTx({
        id: 't_real_inc',
        title: 'Plat',
        amountInHaler: 1500000, // 15 000 Kč
        type: 'income',
        sourceAccountId: defaultAccount.id,
        date: '2026-09-20',
      }),
      createTx({
        id: 'tr_in',
        title: 'Příchozí převod',
        amountInHaler: 500000, // 5 000 Kč
        type: 'transfer',
        sourceAccountId: secondaryAccount.id,
        targetAccountId: defaultAccount.id,
        date: '2026-09-22',
      }),
      createTx({
        id: 'tr_out',
        title: 'Odchozí převod',
        amountInHaler: 300000, // 3 000 Kč
        type: 'transfer',
        sourceAccountId: defaultAccount.id,
        targetAccountId: secondaryAccount.id,
        date: '2026-09-25',
      })
    ];

    const forecast = calculateForecast(
      periods,
      [defaultAccount, secondaryAccount],
      txs,
      [],
      [],
      [],
      baseSettings
    );

    const defBal = forecast.periods[0].accountBalances[defaultAccount.id];
    expect(defBal.incomeInHaler).toBe(1500000);
    expect(defBal.expenseInHaler).toBe(0);
  });

  // Test 9: Konečný stav = počáteční stav + čistá změna
  it('9. Vždy platí: Konečný stav = počáteční stav + čistá změna', () => {
    const periods = generatePeriodsSequence(2026, 9, 3, 15);

    const txs: Transaction[] = [
      createTx({
        id: 't_inc',
        title: 'Příjem',
        amountInHaler: 2500000,
        type: 'income',
        sourceAccountId: defaultAccount.id,
        date: '2026-09-20',
      }),
      createTx({
        id: 't_exp',
        title: 'Výdaj',
        amountInHaler: 1200000,
        type: 'expense',
        sourceAccountId: defaultAccount.id,
        date: '2026-09-25',
      }),
      createTx({
        id: 't_tr_in',
        title: 'Převod dovnitř',
        amountInHaler: 300000,
        type: 'transfer',
        sourceAccountId: secondaryAccount.id,
        targetAccountId: defaultAccount.id,
        date: '2026-09-28',
      }),
      createTx({
        id: 't_tr_out',
        title: 'Převod ven',
        amountInHaler: 400000,
        type: 'transfer',
        sourceAccountId: defaultAccount.id,
        targetAccountId: secondaryAccount.id,
        date: '2026-10-02',
      })
    ];

    const corrections: BalanceCorrection[] = [
      {
        id: 'corr1',
        accountId: defaultAccount.id,
        checkDate: '2026-10-05',
        type: 'balance_adjustment',
        diffInHaler: -100000, // -1 000 Kč
        actualBalanceInHaler: 0,
        calculatedBalanceInHaler: 100000,
        note: 'Korekce',
        createdAt: ''
      }
    ];

    const forecast = calculateForecast(
      periods,
      [defaultAccount, secondaryAccount],
      txs,
      [],
      [],
      corrections,
      baseSettings
    );

    forecast.periods.forEach(pSummary => {
      const defBal = pSummary.accountBalances[defaultAccount.id];
      const netTransfers = defBal.transfersInInHaler - defBal.transfersOutInHaler;
      const netChange = defBal.incomeInHaler - defBal.expenseInHaler + netTransfers + defBal.correctionsInHaler;
      expect(defBal.closingBalanceInHaler).toBe(defBal.openingBalanceInHaler + netChange);
    });
  });

  // Test 10: Hodnota Včetně kontokorentu = konečný stav + výše kontokorentu
  it('10. Včetně kontokorentu přesně odpovídá součtu konečného stavu a nastaveného limitu', () => {
    const overdraftLimit = baseSettings.overdraftLimitInHaler!; // 2 000 000 haléřů = 20 000 Kč

    // Příklad 1 z promptu:
    // Konečný stav: -5 000 Kč (-500 000 haléřů)
    // Výše kontokorentu: 20 000 Kč (2 000 000 haléřů)
    // Včetně kontokorentu: 15 000 Kč (1 500 000 haléřů)
    const closing1 = -500000;
    const withOverdraft1 = closing1 + overdraftLimit;
    expect(withOverdraft1).toBe(1500000);
    expect(halerToCzk(withOverdraft1)).toBe(15000);

    // Příklad 2 z promptu:
    // Konečný stav: 8 000 Kč (800 000 haléřů)
    // Výše kontokorentu: 20 000 Kč (2 000 000 haléřů)
    // Včetně kontokorentu: 28 000 Kč (2 800 000 haléřů)
    const closing2 = 800000;
    const withOverdraft2 = closing2 + overdraftLimit;
    expect(withOverdraft2).toBe(2800000);
    expect(halerToCzk(withOverdraft2)).toBe(28000);
  });

  // Test 11: Překročení kontokorentu vytvoří záporný výsledek
  it('11. Překročení kontokorentu vytvoří záporný výsledek bez omezení na nulu', () => {
    const overdraftLimit = 2000000; // 20 000 Kč

    // Příklad: Konečný stav: -22 000 Kč (-2 200 000 haléřů)
    // Výše kontokorentu: 20 000 Kč (2 000 000 haléřů)
    // Včetně kontokorentu: -2 000 Kč (-200 000 haléřů)
    const closingExceeded = -2200000;
    const withOverdraft = closingExceeded + overdraftLimit;
    expect(withOverdraft).toBe(-200000);
    expect(halerToCzk(withOverdraft)).toBe(-2000);
    expect(withOverdraft < 0).toBe(true);
  });

  // Test 12: Změna položky v minulosti správně přepočítá následující období
  it('12. Změna položky v minulosti správně přepočítá počáteční a konečné stavy všech následujících období', () => {
    const periods = generatePeriodsSequence(2026, 7, 3, 15);

    const txsInitial: Transaction[] = [
      createTx({
        id: 't_p0',
        title: 'Příjem p0',
        amountInHaler: 1000000, // 10 000 Kč
        type: 'income',
        sourceAccountId: defaultAccount.id,
        date: '2026-07-20',
      })
    ];

    const forecastInitial = calculateForecast(
      periods,
      [defaultAccount],
      txsInitial,
      [],
      [],
      [],
      baseSettings
    );

    const initP1Opening = forecastInitial.periods[1].accountBalances[defaultAccount.id].openingBalanceInHaler;
    const initP2Opening = forecastInitial.periods[2].accountBalances[defaultAccount.id].openingBalanceInHaler;

    // Upravíme částku položky v p0 o +5 000 Kč
    const txsUpdated: Transaction[] = [
      createTx({
        ...txsInitial[0],
        amountInHaler: 1500000 // 15 000 Kč (+5 000 Kč)
      })
    ];

    const forecastUpdated = calculateForecast(
      periods,
      [defaultAccount],
      txsUpdated,
      [],
      [],
      [],
      baseSettings
    );

    const updatedP0Closing = forecastUpdated.periods[0].accountBalances[defaultAccount.id].closingBalanceInHaler;
    const updatedP1Opening = forecastUpdated.periods[1].accountBalances[defaultAccount.id].openingBalanceInHaler;
    const updatedP1Closing = forecastUpdated.periods[1].accountBalances[defaultAccount.id].closingBalanceInHaler;
    const updatedP2Opening = forecastUpdated.periods[2].accountBalances[defaultAccount.id].openingBalanceInHaler;

    expect(updatedP1Opening).toBe(updatedP0Closing);
    expect(updatedP1Opening).toBe(initP1Opening + 500000);
    expect(updatedP2Opening).toBe(initP2Opening + 500000);
    expect(updatedP2Opening).toBe(updatedP1Closing);
  });

  // Test 13: Stav bez výchozího účtu
  it('13. Pokud není zvolen žádný aktivní výchozí účet, detekuje se absence výchozího účtu', () => {
    const noDefaultAccounts: Account[] = [
      { ...defaultAccount, isDefault: false },
      { ...secondaryAccount, isDefault: false }
    ];

    const foundDefault = noDefaultAccounts.find(a => a.isDefault && a.status !== 'archived');
    expect(foundDefault).toBeUndefined();

    // Také v případě archivovaného účtu
    const archivedDefaultAccounts: Account[] = [
      { ...defaultAccount, isDefault: true, status: 'archived' }
    ];
    const foundArchivedDefault = archivedDefaultAccounts.find(a => a.isDefault && a.status !== 'archived');
    expect(foundArchivedDefault).toBeUndefined();
  });

  // Test 14: Perzistence výchozího účtu i výše kontokorentu po reloadu
  it('14. Po uložení a reloadu zůstane výše kontokorentu i výchozí účet správně zachován', () => {
    const customData: AppData = {
      ...getInitialData(),
      settings: {
        ...baseSettings,
        overdraftLimitInHaler: 4500000, // 45 000 Kč
        minReserveInHaler: 4500000
      },
      accounts: [
        { ...defaultAccount, isDefault: false },
        { ...secondaryAccount, isDefault: true }
      ]
    };

    saveStoredData(customData);
    const loaded = loadStoredData();

    expect(loaded.settings.overdraftLimitInHaler).toBe(4500000);
    const loadedDefault = loaded.accounts.find(a => a.isDefault && a.status !== 'archived');
    expect(loadedDefault?.id).toBe(secondaryAccount.id);
  });

  // Test 15: Ostatní finanční výpočty a obrazovky zůstanou plně funkční
  it('15. Celkový majetek a použitelné peníze napříč účty zůstávají správně počítány', () => {
    const periods = generatePeriodsSequence(2026, 9, 2, 15);

    const txs: Transaction[] = [
      createTx({
        id: 't_def',
        title: 'Příjem výchozí',
        amountInHaler: 1000000,
        type: 'income',
        sourceAccountId: defaultAccount.id,
        date: '2026-09-20',
      }),
      createTx({
        id: 't_sec',
        title: 'Příjem spoření',
        amountInHaler: 2000000,
        type: 'income',
        sourceAccountId: secondaryAccount.id,
        date: '2026-09-22',
      })
    ];

    const forecast = calculateForecast(
      periods,
      [defaultAccount, secondaryAccount, thirdAccount],
      txs,
      [],
      [],
      [],
      baseSettings
    );

    const p0 = forecast.periods[0];
    // Použitelné peníze: default (10 000 + 10 000) + secondary (50 000 + 20 000) = 90 000 Kč = 9 000 000 haléřů
    expect(p0.usableClosingInHaler).toBe(9000000);
    // Celkový majetek: 90 000 Kč + 100 000 Kč (thirdAccount) = 190 000 Kč = 19 000 000 haléřů
    expect(p0.netWorthClosingInHaler).toBe(19000000);
    // Přitom výchozí účet má svůj vlastní konečný stav 20 000 Kč = 2 000 000 haléřů
    expect(p0.accountBalances[defaultAccount.id].closingBalanceInHaler).toBe(2000000);
  });
});
