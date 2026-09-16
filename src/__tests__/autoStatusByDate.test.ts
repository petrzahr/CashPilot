import { describe, it, expect } from 'vitest';
import { getStatusForDate, autoExecuteDueTransactions } from '../services/statusService';
import { getTodayInPrague, createBudgetPeriod, generatePeriodsSequence } from '../services/periodService';
import { calculateForecast, getEffectiveTransactionsForPeriod } from '../services/financialEngine';
import {
  Account,
  AppSettings,
  RecurringException,
  RecurringRule,
  Transaction
} from '../types/finance';

const defaultSettings: AppSettings = {
  currency: 'CZK',
  budgetStartDay: 15,
  minReserveInHaler: 0,
  roundAmounts: false,
};

const checkingAccount: Account = {
  id: 'acc_main',
  name: 'Běžný účet',
  type: 'checking',
  currency: 'CZK',
  initialBalanceInHaler: 10000000, // 100 000 Kč
  initialBalanceDate: '2026-01-01',
  isUsableCash: true,
  isNetWorth: true,
  color: '#3B82F6',
  sortOrder: 1,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('CashPilot - Automatické určování a aktualizace stavu položek podle data', () => {
  const todayRef = '2026-09-20';

  // Test 1: Nová položka s minulým datem dostane stav Uskutečněná
  it('1. Nová položka s minulým datem dostane automaticky stav Uskutečněná (executed)', () => {
    const pastDate = '2026-09-19';
    const status = getStatusForDate(pastDate, todayRef);
    expect(status).toBe('executed');

    const olderDate = '2026-08-15';
    expect(getStatusForDate(olderDate, todayRef)).toBe('executed');
  });

  // Test 2: Nová položka s dnešním datem dostane stav Uskutečněná
  it('2. Nová položka s dnešním datem dostane automaticky stav Uskutečněná (executed)', () => {
    const todayDate = '2026-09-20';
    const status = getStatusForDate(todayDate, todayRef);
    expect(status).toBe('executed');
  });

  // Test 3: Nová položka s budoucím datem dostane stav Plánovaná
  it('3. Nová položka s budoucím datem dostane automaticky stav Plánovaná (planned)', () => {
    const tomorrowDate = '2026-09-21';
    const status = getStatusForDate(tomorrowDate, todayRef);
    expect(status).toBe('planned');

    const futureDate = '2026-10-15';
    expect(getStatusForDate(futureDate, todayRef)).toBe('planned');
  });

  // Test 4: Změna data ve formuláři okamžitě aktualizuje stav
  it('4. Změna data ve formuláři okamžitě aktualizuje stav v obou směrech', () => {
    // 1. Uživatel změnil datum z budoucího (21.9.) na dnešní (20.9.) -> Uskutečněná
    expect(getStatusForDate('2026-09-21', todayRef)).toBe('planned');
    expect(getStatusForDate('2026-09-20', todayRef)).toBe('executed');

    // 2. Uživatel změnil datum z budoucího (21.9.) na minulé (15.9.) -> Uskutečněná
    expect(getStatusForDate('2026-09-15', todayRef)).toBe('executed');

    // 3. Uživatel změnil datum z minulého/dnešního na budoucí -> Plánovaná
    expect(getStatusForDate('2026-09-25', todayRef)).toBe('planned');
  });

  // Test 5: Budoucí plánovaná položka se ve svůj den změní na Uskutečněná
  it('5. Budoucí plánovaná položka se ve svůj den změní na Uskutečněná', () => {
    const txPlanned: Transaction = {
      id: 'tx_future',
      title: 'Plánovaná platba za elektřinu',
      amountInHaler: 250000,
      plannedAmountInHaler: 250000,
      date: '2026-09-25',
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_main',
      status: 'planned',
      createdAt: '2026-09-10T10:00:00.000Z',
      updatedAt: '2026-09-10T10:00:00.000Z',
    };

    // Dne 24.9.2026 (den před splatností) - stále zůstává Plánovaná
    const beforeDue = autoExecuteDueTransactions([txPlanned], [], [], 15, '2026-09-24');
    expect(beforeDue.hasChanges).toBe(false);
    expect(beforeDue.transactions[0].status).toBe('planned');

    // Dne 25.9.2026 (v den splatnosti) - automaticky se změní na Uskutečněná
    const onDue = autoExecuteDueTransactions([txPlanned], [], [], 15, '2026-09-25');
    expect(onDue.hasChanges).toBe(true);
    expect(onDue.transactions[0].status).toBe('executed');
    expect(onDue.transactions[0].actualAmountInHaler).toBe(250000);
  });

  // Test 6: Plánovaná položka po splatnosti se opraví při spuštění aplikace
  it('6. Plánovaná položka po splatnosti se automaticky opraví na Uskutečněná', () => {
    const overdueTx: Transaction = {
      id: 'tx_overdue',
      title: 'Zpožděná položka',
      amountInHaler: 150000,
      plannedAmountInHaler: 150000,
      date: '2026-09-10', // Bylo před 10 dny
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_main',
      status: 'planned',
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    };

    const result = autoExecuteDueTransactions([overdueTx], [], [], 15, todayRef);
    expect(result.hasChanges).toBe(true);
    expect(result.transactions[0].status).toBe('executed');
    expect(result.transactions[0].actualAmountInHaler).toBe(150000);
  });

  // Test 7: Zrušená položka zůstane zrušená i po dosažení plánovaného data
  it('7. Zrušená položka zůstane zrušená i po dosažení či překročení plánovaného data', () => {
    const cancelledTx: Transaction = {
      id: 'tx_cancelled',
      title: 'Zrušený nákup',
      amountInHaler: 50000,
      date: '2026-09-10', // Minulé datum
      sequence: 1,
      type: 'expense',
      sourceAccountId: 'acc_main',
      status: 'cancelled',
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    };

    const result = autoExecuteDueTransactions([cancelledTx], [], [], 15, todayRef);
    expect(result.hasChanges).toBe(false);
    expect(result.transactions[0].status).toBe('cancelled');
  });

  // Test 8: Jednotlivé výskyty opakované platby se mění samostatně
  it('8. Jednotlivé výskyty opakované platby se posuzují samostatně (minulé uskutečněné, budoucí plánované)', () => {
    const rule: RecurringRule = {
      id: 'rule_sub',
      title: 'Spotify',
      amountInHaler: 19900,
      type: 'expense',
      frequency: 'monthly',
      dayOfMonth: 15,
      startDate: '2026-09-15',
      sourceAccountId: 'acc_main',
      isActive: true,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    };

    // Dnes je 20.9.2026.
    // Výskyt k 15. 9. 2026 (<= 20. 9.) -> Uskutečněná
    // Výskyt k 15. 10. 2026 (> 20. 9.) -> Plánovaná
    const autoRes = autoExecuteDueTransactions([], [rule], [], 15, todayRef);
    expect(autoRes.hasChanges).toBe(true);

    const createdTxs = autoRes.transactions;
    // Výskyt za 15.9. byl vytvořen a uskutečněn
    const sepOcc = createdTxs.find(t => t.date === '2026-09-15');
    expect(sepOcc).toBeDefined();
    expect(sepOcc?.status).toBe('executed');

    // Budoucí perioda (říjen 2026: 15.10. – 14.11.)
    const periodOct = createBudgetPeriod(2026, 10, 15);
    const effOct = getEffectiveTransactionsForPeriod(periodOct, createdTxs, [rule], [], 15, todayRef);
    expect(effOct.length).toBe(1);
    expect(effOct[0].date).toBe('2026-10-15');
    expect(effOct[0].status).toBe('planned');
  });

  // Test 9: Automatická změna zůstane zachována po obnovení stránky / perzistenci
  it('9. Automaticky uskutečněný výskyt je perzistentně uložen a nevrací se do stavu Plánovaná', () => {
    const rule: RecurringRule = {
      id: 'rule_net',
      title: 'Internet',
      amountInHaler: 50000,
      type: 'expense',
      frequency: 'monthly',
      dayOfMonth: 15,
      startDate: '2026-09-15',
      sourceAccountId: 'acc_main',
      isActive: true,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    };

    // 1. První běh synchronizace
    const run1 = autoExecuteDueTransactions([], [rule], [], 15, todayRef);
    expect(run1.hasChanges).toBe(true);
    const savedTxs = run1.transactions;
    const occ = savedTxs.find(t => t.date === '2026-09-15');
    expect(occ?.status).toBe('executed');

    // 2. Druhý běh (např. po obnovení stránky se stejnými daty)
    const run2 = autoExecuteDueTransactions(savedTxs, [rule], [], 15, todayRef);
    expect(run2.hasChanges).toBe(false); // žádné nové změny, stav zůstává executed
    expect(run2.transactions.find(t => t.date === '2026-09-15')?.status).toBe('executed');
  });

  // Test 10: Stav se synchronizuje na všech obrazovkách i ve forecastu
  it('10. Stav se synchronizuje v efektivních transakcích i ve finančním forecastu', () => {
    const periodSep = createBudgetPeriod(2026, 9, 15);
    const plannedSalary: Transaction = {
      id: 'tx_sal',
      title: 'Mzda',
      amountInHaler: 5000000,
      date: '2026-09-18', // Už proběhlo vzhledem k 20.9.
      sequence: 1,
      type: 'income',
      sourceAccountId: 'acc_main',
      status: 'planned',
      createdAt: '',
      updatedAt: '',
    };

    const synced = autoExecuteDueTransactions([plannedSalary], [], [], 15, todayRef);
    const eff = getEffectiveTransactionsForPeriod(periodSep, synced.transactions, [], [], 15, todayRef);

    expect(eff[0].status).toBe('executed');
    expect(eff[0].actualAmountInHaler).toBe(5000000);

    const forecast = calculateForecast([periodSep], [checkingAccount], synced.transactions, [], [], [], defaultSettings);
    expect(forecast.periods[0].closingBalanceInHaler).toBe(15000000);
  });

  // Test 11: Nedojde k dvojímu započítání položky (instantiated vs virtual)
  it('11. Nedojde k dvojímu započítání položky při přechodu z virtuální na reálnou Uskutečněnou', () => {
    const periodSep = createBudgetPeriod(2026, 9, 15);
    const rentRule: RecurringRule = {
      id: 'rule_rent_check',
      title: 'Nájem',
      amountInHaler: 1500000,
      type: 'expense',
      frequency: 'monthly',
      dayOfMonth: 16,
      startDate: '2026-09-15',
      sourceAccountId: 'acc_main',
      isActive: true,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    };

    // Před automatickým uskutečněním (virtuální výskyt v periodě)
    const effBefore = getEffectiveTransactionsForPeriod(periodSep, [], [rentRule], [], 15, todayRef);
    expect(effBefore.length).toBe(1);

    // Po automatickém uskutečnění (reálný výskyt v transactions)
    const autoRes = autoExecuteDueTransactions([], [rentRule], [], 15, todayRef);
    const effAfter = getEffectiveTransactionsForPeriod(periodSep, autoRes.transactions, [rentRule], [], 15, todayRef);

    expect(effAfter.length).toBe(1);
    expect(effAfter[0].id).toBe('tx_rec_rule_rent_check_2026-09');
    expect(effAfter[0].status).toBe('executed');

    // Forecast počítá položku přesně jednou
    const forecast = calculateForecast([periodSep], [checkingAccount], autoRes.transactions, [rentRule], [], [], defaultSettings);
    expect(forecast.periods[0].expenseInHaler).toBe(1500000);
    expect(forecast.periods[0].closingBalanceInHaler).toBe(8500000);
  });

  // Test 12: Výpočet data a půlnoční přechod v časovém pásmu Europe/Prague
  it('12. Výpočet data a přechod dne správně funguje v časovém pásmu Europe/Prague bez jednodenního posunu', () => {
    // Čas v UTC: 2026-09-19T22:30:00Z -> v Praze je SELČ (UTC+2) = 2026-09-20T00:30:00
    const midnightAfterUtc = new Date('2026-09-19T22:30:00Z');
    const pragueDay = getTodayInPrague(midnightAfterUtc);
    expect(pragueDay).toBe('2026-09-20');

    // Položka s datem 20.9.2026 je v tuto chvíli již Uskutečněná (protože v Praze je již 20.9.)
    expect(getStatusForDate('2026-09-20', pragueDay)).toBe('executed');

    // Čas v UTC: 2026-09-19T21:30:00Z -> v Praze je SELČ 2026-09-19T23:30:00 (stále 19.9.)
    const midnightBeforeUtc = new Date('2026-09-19T21:30:00Z');
    const pragueDayBefore = getTodayInPrague(midnightBeforeUtc);
    expect(pragueDayBefore).toBe('2026-09-19');

    // Položka s datem 20.9.2026 je v tomto čase ještě Plánovaná
    expect(getStatusForDate('2026-09-20', pragueDayBefore)).toBe('planned');

    // Test zimního času (SEČ, UTC+1): 2026-01-15T23:15:00Z -> v Praze 2026-01-16T00:15:00
    const winterUtc = new Date('2026-01-15T23:15:00Z');
    const winterPrague = getTodayInPrague(winterUtc);
    expect(winterPrague).toBe('2026-01-16');
    expect(getStatusForDate('2026-01-16', winterPrague)).toBe('executed');
  });
});
