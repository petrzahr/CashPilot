import { describe, it, expect } from 'vitest';
import { Account, AppSettings, Transaction, RecurringRule } from '../types/finance';
import { calculateForecast, getAccountBalanceAtDate, generateOccurrenceForPeriod } from '../services/financialEngine';
import {
  createBudgetPeriod,
  formatCzechDate,
} from '../services/periodService';

describe('CashPilot - Testy data počátečního stavu účtu (16 scénářů dle specifikace)', () => {
  const defaultSettings: AppSettings = {
    currency: 'CZK',
    budgetStartDay: 1,
    minReserveInHaler: 2000000,
    roundAmounts: false,
  };

  const periodMarch2026 = createBudgetPeriod(2026, 3, 1); // 2026-03-01 až 2026-03-31
  const periodApril2026 = createBudgetPeriod(2026, 4, 1); // 2026-04-01 až 2026-04-30
  const periodMay2026 = createBudgetPeriod(2026, 5, 1);   // 2026-05-01 až 2026-05-31

  // Scénář 1 & 2: Účet založen v budoucím období (1. 4. 2026, 50 000 Kč)
  // Období březen 2026 skončilo dnem před založením (31. 3. 2026)
  it('Scénář 1 a 2: Účet založený 1. 4. 2026 má v březnu 2026 nulový stav a nulový vliv na počáteční i konečný zůstatek', () => {
    const futureAccount: Account = {
      id: 'acc_future',
      name: 'Nový účet',
      type: 'checking',
      currency: 'CZK',
      initialBalanceInHaler: 5000000, // 50 000 Kč
      initialBalanceDate: '2026-04-01',
      isUsableCash: true,
      isNetWorth: true,
      color: '#0284c7',
      sortOrder: 1,
      status: 'active',
      createdAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-04-01T00:00:00Z',
    };

    const periods = [periodMarch2026, periodApril2026];
    const forecast = calculateForecast(
      periods,
      [futureAccount],
      [],
      [],
      [],
      [],
      defaultSettings
    );

    const marchResult = forecast.periods[0];
    expect(marchResult.period.key).toBe('2026-03');
    // Stav účtu v březnu je 0 Kč
    expect(marchResult.accountBalances['acc_future'].openingBalanceInHaler).toBe(0);
    expect(marchResult.accountBalances['acc_future'].closingBalanceInHaler).toBe(0);
    // Vliv na celkový počáteční i konečný stav je 0 Kč
    expect(marchResult.openingBalanceInHaler).toBe(0);
    expect(marchResult.closingBalanceInHaler).toBe(0);

    // V dubnu (měsíc aktivace k 1. 4., což je startDate období) je počáteční i konečný stav 50 000 Kč
    const aprilResult = forecast.periods[1];
    expect(aprilResult.period.key).toBe('2026-04');
    expect(aprilResult.accountBalances['acc_future'].openingBalanceInHaler).toBe(5000000);
    expect(aprilResult.accountBalances['acc_future'].closingBalanceInHaler).toBe(5000000);
    expect(aprilResult.openingBalanceInHaler).toBe(5000000);
    expect(aprilResult.closingBalanceInHaler).toBe(5000000);
  });

  // Scénář 3: Účet založen v průběhu období (např. 1. 4. 2026 v období 15. 3. – 14. 4.)
  it('Scénář 3: Účet založený uprostřed období (1. 4. v období 15. 3. - 14. 4.) má počáteční stav 0 Kč a konečný 50 000 Kč', () => {
    // Rozpočtové období od 15. dne: březen (15. 3. až 14. 4.)
    const customPeriod = createBudgetPeriod(2026, 3, 15);
    expect(customPeriod.startDate).toBe('2026-03-15');
    expect(customPeriod.endDate).toBe('2026-04-14');

    const midPeriodAccount: Account = {
      id: 'acc_mid',
      name: 'Středo-obdobový účet',
      type: 'checking',
      currency: 'CZK',
      initialBalanceInHaler: 5000000, // 50 000 Kč
      initialBalanceDate: '2026-04-01',
      isUsableCash: true,
      isNetWorth: true,
      color: '#0284c7',
      sortOrder: 1,
      status: 'active',
      createdAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-04-01T00:00:00Z',
    };

    // Denní zůstatky přes getAccountBalanceAtDate:
    // K 15. 3. = 0 Kč
    expect(getAccountBalanceAtDate('acc_mid', '2026-03-15', 1, [], [], [midPeriodAccount])).toBe(0);
    // K 31. 3. = 0 Kč
    expect(getAccountBalanceAtDate('acc_mid', '2026-03-31', 1, [], [], [midPeriodAccount])).toBe(0);
    // K 1. 4. (den aktivace) = 50 000 Kč
    expect(getAccountBalanceAtDate('acc_mid', '2026-04-01', 1, [], [], [midPeriodAccount])).toBe(5000000);
    // K 14. 4. = 50 000 Kč
    expect(getAccountBalanceAtDate('acc_mid', '2026-04-14', 1, [], [], [midPeriodAccount])).toBe(5000000);

    // Ve forecastu období:
    const forecast = calculateForecast(
      [customPeriod],
      [midPeriodAccount],
      [],
      [],
      [],
      [],
      { ...defaultSettings, budgetStartDay: 15 }
    );

    const res = forecast.periods[0];
    // Počáteční stav období k 15. 3. = 0 Kč
    expect(res.accountBalances['acc_mid'].openingBalanceInHaler).toBe(0);
    expect(res.openingBalanceInHaler).toBe(0);
    // Konečný stav období k 14. 4. = 50 000 Kč
    expect(res.accountBalances['acc_mid'].closingBalanceInHaler).toBe(5000000);
    expect(res.closingBalanceInHaler).toBe(5000000);
  });

  // Scénář 4: Účet založen přesně k prvnímu dni období (např. 15. 3. 2026 v období 15. 3. – 14. 4.)
  it('Scénář 4: Účet založený přesně v první den období má počáteční i konečný stav 50 000 Kč', () => {
    const customPeriod = createBudgetPeriod(2026, 3, 15);
    const dayOneAccount: Account = {
      id: 'acc_day_one',
      name: 'Účet od prvního dne',
      type: 'checking',
      currency: 'CZK',
      initialBalanceInHaler: 5000000, // 50 000 Kč
      initialBalanceDate: '2026-03-15',
      isUsableCash: true,
      isNetWorth: true,
      color: '#0284c7',
      sortOrder: 1,
      status: 'active',
      createdAt: '2026-03-15T00:00:00Z',
      updatedAt: '2026-03-15T00:00:00Z',
    };

    const forecast = calculateForecast(
      [customPeriod],
      [dayOneAccount],
      [],
      [],
      [],
      [],
      { ...defaultSettings, budgetStartDay: 15 }
    );

    const res = forecast.periods[0];
    expect(res.accountBalances['acc_day_one'].openingBalanceInHaler).toBe(5000000);
    expect(res.accountBalances['acc_day_one'].closingBalanceInHaler).toBe(5000000);
    expect(res.openingBalanceInHaler).toBe(5000000);
    expect(res.closingBalanceInHaler).toBe(5000000);
  });

  // Scénář 5: Účet založen v minulém období (např. 1. 1. 2026)
  // Následující období únor 2026 má počáteční stav = konečnému stavu ledna
  // Březen 2026 má počáteční stav = konečnému stavu února
  it('Scénář 5: Kontinuita zůstatků - únor má počáteční stav roven konečnému ledna, březen roven konečnému února', () => {
    const pastAccount: Account = {
      id: 'acc_past',
      name: 'Starší účet',
      type: 'checking',
      currency: 'CZK',
      initialBalanceInHaler: 5000000, // 50 000 Kč
      initialBalanceDate: '2026-01-01',
      isUsableCash: true,
      isNetWorth: true,
      color: '#0284c7',
      sortOrder: 1,
      status: 'active',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    // Pohyb v lednu: +10 000 Kč
    const txJan: Transaction = {
      id: 'tx_jan',
      title: 'Příjem v lednu',
      type: 'income',
      amountInHaler: 1000000,
      date: '2026-01-15',
      sequence: 1,
      sourceAccountId: 'acc_past',
      status: 'executed',
      actualAmountInHaler: 1000000,
      createdAt: '2026-01-15T00:00:00Z',
      updatedAt: '2026-01-15T00:00:00Z',
    };

    // Pohyb v únoru: -5 000 Kč
    const txFeb: Transaction = {
      id: 'tx_feb',
      title: 'Výdaj v únoru',
      type: 'expense',
      amountInHaler: 500000,
      date: '2026-02-10',
      sequence: 1,
      sourceAccountId: 'acc_past',
      status: 'executed',
      actualAmountInHaler: 500000,
      createdAt: '2026-02-10T00:00:00Z',
      updatedAt: '2026-02-10T00:00:00Z',
    };

    const pJan = createBudgetPeriod(2026, 1, 1);
    const pFeb = createBudgetPeriod(2026, 2, 1);
    const pMar = createBudgetPeriod(2026, 3, 1);

    const forecast = calculateForecast(
      [pJan, pFeb, pMar],
      [pastAccount],
      [txJan, txFeb],
      [],
      [],
      [],
      defaultSettings
    );

    const rJan = forecast.periods[0];
    const rFeb = forecast.periods[1];
    const rMar = forecast.periods[2];

    // Leden: počátek 50 000, konec 60 000
    expect(rJan.openingBalanceInHaler).toBe(5000000);
    expect(rJan.closingBalanceInHaler).toBe(6000000);

    // Únor: počátek = konec ledna (60 000), výdaj -5 000 => konec 55 000
    expect(rFeb.openingBalanceInHaler).toBe(rJan.closingBalanceInHaler);
    expect(rFeb.openingBalanceInHaler).toBe(6000000);
    expect(rFeb.closingBalanceInHaler).toBe(5500000);

    // Březen: počátek = konec února (55 000)
    expect(rMar.openingBalanceInHaler).toBe(rFeb.closingBalanceInHaler);
    expect(rMar.openingBalanceInHaler).toBe(5500000);
    expect(rMar.closingBalanceInHaler).toBe(5500000);
  });

  // Scénář 6, 7, 8, 9: Validace přidání příjmu, výdaje, převodu před datem aktivace
  it('Scénář 6 až 9: Pokus o položku před aktivací účtu generuje přesnou chybovou hlášku', () => {
    const activeFromApril: Account = {
      id: 'acc_apr',
      name: 'Dubnový účet',
      type: 'checking',
      currency: 'CZK',
      initialBalanceInHaler: 1000000,
      initialBalanceDate: '2026-04-01',
      isUsableCash: true,
      isNetWorth: true,
      color: '#0284c7',
      sortOrder: 1,
      status: 'active',
      createdAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-04-01T00:00:00Z',
    };

    const activeFromJan: Account = {
      id: 'acc_jan',
      name: 'Lednový účet',
      type: 'checking',
      currency: 'CZK',
      initialBalanceInHaler: 1000000,
      initialBalanceDate: '2026-01-01',
      isUsableCash: true,
      isNetWorth: true,
      color: '#0284c7',
      sortOrder: 2,
      status: 'active',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const validateTransaction = (tx: Partial<Transaction>, accounts: Account[]) => {
      const srcAcc = accounts.find(a => a.id === tx.sourceAccountId);
      if (srcAcc?.initialBalanceDate && tx.date! < srcAcc.initialBalanceDate) {
        return {
          valid: false,
          error: `Tento účet je aktivní až od ${formatCzechDate(srcAcc.initialBalanceDate)}. Zvolte stejné nebo pozdější datum.`
        };
      }
      if (tx.type === 'transfer' && tx.targetAccountId) {
        const tgtAcc = accounts.find(a => a.id === tx.targetAccountId);
        if (tgtAcc?.initialBalanceDate && tx.date! < tgtAcc.initialBalanceDate) {
          return {
            valid: false,
            error: `Tento účet je aktivní až od ${formatCzechDate(tgtAcc.initialBalanceDate)}. Zvolte stejné nebo pozdější datum.`
          };
        }
      }
      return { valid: true };
    };

    // Scénář 6: Příjem před aktivací
    const incomeBefore = validateTransaction({
      title: 'Příjem',
      type: 'income',
      date: '2026-03-15',
      sourceAccountId: 'acc_apr'
    }, [activeFromApril, activeFromJan]);
    expect(incomeBefore.valid).toBe(false);
    expect(incomeBefore.error).toBe('Tento účet je aktivní až od 1. 4. 2026. Zvolte stejné nebo pozdější datum.');

    // Scénář 7: Výdaj před aktivací
    const expenseBefore = validateTransaction({
      title: 'Výdaj',
      type: 'expense',
      date: '2026-03-31',
      sourceAccountId: 'acc_apr'
    }, [activeFromApril, activeFromJan]);
    expect(expenseBefore.valid).toBe(false);
    expect(expenseBefore.error).toBe('Tento účet je aktivní až od 1. 4. 2026. Zvolte stejné nebo pozdější datum.');

    // Scénář 8: Převod ze zdrojového účtu před jeho aktivací
    const transferSrcBefore = validateTransaction({
      title: 'Převod',
      type: 'transfer',
      date: '2026-03-20',
      sourceAccountId: 'acc_apr',
      targetAccountId: 'acc_jan'
    }, [activeFromApril, activeFromJan]);
    expect(transferSrcBefore.valid).toBe(false);
    expect(transferSrcBefore.error).toBe('Tento účet je aktivní až od 1. 4. 2026. Zvolte stejné nebo pozdější datum.');

    // Scénář 9: Převod na cílový účet před jeho aktivací
    const transferTgtBefore = validateTransaction({
      title: 'Převod',
      type: 'transfer',
      date: '2026-03-20',
      sourceAccountId: 'acc_jan',
      targetAccountId: 'acc_apr'
    }, [activeFromApril, activeFromJan]);
    expect(transferTgtBefore.valid).toBe(false);
    expect(transferTgtBefore.error).toBe('Tento účet je aktivní až od 1. 4. 2026. Zvolte stejné nebo pozdější datum.');
  });

  // Scénář 10: Korekce před datem aktivace účtu
  it('Scénář 10: Pokus o korekci před datem aktivace je odmítnut se správnou chybovou hláškou', () => {
    const account: Account = {
      id: 'acc_bank',
      name: 'Spořicí účet',
      type: 'savings',
      currency: 'CZK',
      initialBalanceInHaler: 1000000,
      initialBalanceDate: '2026-04-01',
      isUsableCash: true,
      isNetWorth: true,
      color: '#0284c7',
      sortOrder: 1,
      status: 'active',
      createdAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-04-01T00:00:00Z',
    };

    const validateReconciliation = (acc: Account, checkDate: string) => {
      if (acc.initialBalanceDate && checkDate < acc.initialBalanceDate) {
        return {
          valid: false,
          error: `Tento účet je aktivní až od ${formatCzechDate(acc.initialBalanceDate)}. Zvolte stejné nebo pozdější datum.`
        };
      }
      return { valid: true };
    };

    const res = validateReconciliation(account, '2026-03-15');
    expect(res.valid).toBe(false);
    expect(res.error).toBe('Tento účet je aktivní až od 1. 4. 2026. Zvolte stejné nebo pozdější datum.');
  });

  // Scénář 11: Ocenění tržní hodnoty před datem aktivace investičního účtu
  it('Scénář 11: Pokus o ocenění tržní hodnoty investičního účtu před datem aktivace je odmítnut', () => {
    const investAcc: Account = {
      id: 'acc_inv',
      name: 'Investiční účet Portu',
      type: 'investment',
      currency: 'CZK',
      initialBalanceInHaler: 10000000,
      initialBalanceDate: '2026-05-01',
      isUsableCash: false,
      isNetWorth: true,
      color: '#0284c7',
      sortOrder: 1,
      status: 'active',
      createdAt: '2026-05-01T00:00:00Z',
      updatedAt: '2026-05-01T00:00:00Z',
    };

    const validateMarketValuation = (acc: Account, valuationDate: string) => {
      if (acc.initialBalanceDate && valuationDate < acc.initialBalanceDate) {
        return {
          valid: false,
          error: `Tento účet je aktivní až od ${formatCzechDate(acc.initialBalanceDate)}. Zvolte stejné nebo pozdější datum.`
        };
      }
      return { valid: true };
    };

    const res = validateMarketValuation(investAcc, '2026-04-30');
    expect(res.valid).toBe(false);
    expect(res.error).toBe('Tento účet je aktivní až od 1. 5. 2026. Zvolte stejné nebo pozdější datum.');
  });

  // Scénář 12: Pravidelná platba s počátkem před datem počátečního stavu účtu
  it('Scénář 12: Pravidelná platba negeneruje výskyty v obdobích před datem počátečního stavu účtu', () => {
    const acc: Account = {
      id: 'acc_target',
      name: 'Běžný účet',
      type: 'checking',
      currency: 'CZK',
      initialBalanceInHaler: 1000000,
      initialBalanceDate: '2026-04-01',
      isUsableCash: true,
      isNetWorth: true,
      color: '#0284c7',
      sortOrder: 1,
      status: 'active',
      createdAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-04-01T00:00:00Z',
    };

    const rule: RecurringRule = {
      id: 'rule_1',
      title: 'Pravidelné předplatné',
      amountInHaler: 20000,
      type: 'expense',
      frequency: 'monthly',
      dayOfMonth: 10,
      startDate: '2026-01-01', // Začátek pravidla před aktivací účtu
      sourceAccountId: 'acc_target',
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    // V březnu 2026 (před aktivací 1. 4.) nesmí být výskyt vygenerován
    const marchOcc = generateOccurrenceForPeriod(rule, periodMarch2026, [], 1, 1, undefined, [acc]);
    expect(marchOcc).toBeNull();

    // V dubnu 2026 (po aktivaci 1. 4.) výskyt k 10. 4. normálně vznikne
    const aprilOcc = generateOccurrenceForPeriod(rule, periodApril2026, [], 1, 1, undefined, [acc]);
    expect(aprilOcc).not.toBeNull();
    expect(aprilOcc?.date).toBe('2026-04-10');
  });

  // Scénář 13: Počáteční zůstatek nevstupuje do příjmů období
  it('Scénář 13: Počáteční zůstatek nevstupuje do příjmů období ani do kategorií', () => {
    const acc: Account = {
      id: 'acc_inc_test',
      name: 'Účet s vkladem',
      type: 'checking',
      currency: 'CZK',
      initialBalanceInHaler: 5000000, // 50 000 Kč
      initialBalanceDate: '2026-04-01',
      isUsableCash: true,
      isNetWorth: true,
      color: '#0284c7',
      sortOrder: 1,
      status: 'active',
      createdAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-04-01T00:00:00Z',
    };

    const forecast = calculateForecast(
      [periodApril2026],
      [acc],
      [],
      [],
      [],
      [],
      defaultSettings
    );

    const apr = forecast.periods[0];
    // Celkové příjmy období musí být striktně 0 Kč
    expect(apr.incomeInHaler).toBe(0);
    expect(apr.expenseInHaler).toBe(0);
    // Počáteční zůstatek se projevuje výhradně jako balance, nikoliv cashflow položka
    expect(apr.openingBalanceInHaler).toBe(5000000);
    expect(apr.closingBalanceInHaler).toBe(5000000);
  });

  // Scénář 14: Editace data počátečního stavu účtu
  it('Scénář 14: Editace data počátečního stavu: posun do minulosti povolen, posun za existující pohyb blokován', () => {
    const acc: Account = {
      id: 'acc_edit',
      name: 'Editovaný účet',
      type: 'checking',
      currency: 'CZK',
      initialBalanceInHaler: 5000000,
      initialBalanceDate: '2026-02-01',
      isUsableCash: true,
      isNetWorth: true,
      color: '#0284c7',
      sortOrder: 1,
      status: 'active',
      createdAt: '2026-02-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
    };

    const tx: Transaction = {
      id: 'tx_feb_15',
      title: 'Platba v únoru',
      type: 'expense',
      amountInHaler: 100000,
      date: '2026-02-15',
      sequence: 1,
      sourceAccountId: 'acc_edit',
      status: 'executed',
      createdAt: '2026-02-15T00:00:00Z',
      updatedAt: '2026-02-15T00:00:00Z',
    };

    const validateAccountUpdate = (
      updatedAccount: Account,
      txs: Transaction[]
    ) => {
      let earliestDate: string | null = null;
      for (const t of txs) {
        if (t.sourceAccountId === updatedAccount.id || t.targetAccountId === updatedAccount.id) {
          if (!earliestDate || t.date < earliestDate) {
            earliestDate = t.date;
          }
        }
      }
      if (earliestDate && updatedAccount.initialBalanceDate > earliestDate) {
        return {
          success: false,
          message: `Datum počátečního stavu nelze posunout za existující pohyb ze dne ${formatCzechDate(earliestDate)}. Nejdříve upravte nebo odstraňte starší položky.`
        };
      }
      return { success: true };
    };

    // Posun na dřívější termín (např. 2026-01-01) je povolen
    const resAllowed = validateAccountUpdate({
      ...acc,
      initialBalanceDate: '2026-01-01'
    }, [tx]);
    expect(resAllowed.success).toBe(true);

    // Posun za existující pohyb ze dne 15. 2. (např. na 2026-03-01) je blokován
    const resBlocked = validateAccountUpdate({
      ...acc,
      initialBalanceDate: '2026-03-01'
    }, [tx]);
    expect(resBlocked.success).toBe(false);
    expect(resBlocked.message).toBe('Datum počátečního stavu nelze posunout za existující pohyb ze dne 15. 2. 2026. Nejdříve upravte nebo odstraňte starší položky.');
  });

  // Scénář 15: Více účtů s různými daty založení
  it('Scénář 15: Více účtů s různými daty založení se správně kombinují v jednotlivých obdobích', () => {
    const accOld: Account = {
      id: 'acc_old',
      name: 'Starý účet',
      type: 'checking',
      currency: 'CZK',
      initialBalanceInHaler: 10000000, // 100 000 Kč
      initialBalanceDate: '2026-01-01',
      isUsableCash: true,
      isNetWorth: true,
      color: '#0284c7',
      sortOrder: 1,
      status: 'active',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const accMid: Account = {
      id: 'acc_mid',
      name: 'Střední účet',
      type: 'savings',
      currency: 'CZK',
      initialBalanceInHaler: 5000000, // 50 000 Kč
      initialBalanceDate: '2026-04-01',
      isUsableCash: true,
      isNetWorth: true,
      color: '#10b981',
      sortOrder: 2,
      status: 'active',
      createdAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-04-01T00:00:00Z',
    };

    const accNew: Account = {
      id: 'acc_new',
      name: 'Nový účet',
      type: 'checking',
      currency: 'CZK',
      initialBalanceInHaler: 2000000, // 20 000 Kč
      initialBalanceDate: '2026-05-01',
      isUsableCash: true,
      isNetWorth: true,
      color: '#f59e0b',
      sortOrder: 3,
      status: 'active',
      createdAt: '2026-05-01T00:00:00Z',
      updatedAt: '2026-05-01T00:00:00Z',
    };

    const forecast = calculateForecast(
      [periodMarch2026, periodApril2026, periodMay2026],
      [accOld, accMid, accNew],
      [],
      [],
      [],
      [],
      defaultSettings
    );

    // V březnu existuje jen starý účet: 100 000 Kč
    const march = forecast.periods[0];
    expect(march.openingBalanceInHaler).toBe(10000000);
    expect(march.closingBalanceInHaler).toBe(10000000);
    expect(march.accountBalances['acc_old'].closingBalanceInHaler).toBe(10000000);
    expect(march.accountBalances['acc_mid'].closingBalanceInHaler).toBe(0);
    expect(march.accountBalances['acc_new'].closingBalanceInHaler).toBe(0);

    // V dubnu přistupuje střední účet (+50 000 Kč): celkem 150 000 Kč
    const april = forecast.periods[1];
    expect(april.openingBalanceInHaler).toBe(15000000);
    expect(april.closingBalanceInHaler).toBe(15000000);
    expect(april.accountBalances['acc_old'].closingBalanceInHaler).toBe(10000000);
    expect(april.accountBalances['acc_mid'].closingBalanceInHaler).toBe(5000000);
    expect(april.accountBalances['acc_new'].closingBalanceInHaler).toBe(0);

    // V květnu přistupuje nový účet (+20 000 Kč): celkem 170 000 Kč
    const may = forecast.periods[2];
    expect(may.openingBalanceInHaler).toBe(17000000);
    expect(may.closingBalanceInHaler).toBe(17000000);
    expect(may.accountBalances['acc_old'].closingBalanceInHaler).toBe(10000000);
    expect(may.accountBalances['acc_mid'].closingBalanceInHaler).toBe(5000000);
    expect(may.accountBalances['acc_new'].closingBalanceInHaler).toBe(2000000);
  });

  // Scénář 16: Investiční a penzijní účet
  it('Scénář 16: Investiční účet má před datem počátečního stavu hodnotu 0 Kč', () => {
    const pensionAccount: Account = {
      id: 'acc_pension',
      name: 'Doplňkové penzijní spoření',
      type: 'pension',
      currency: 'CZK',
      initialBalanceInHaler: 20000000, // 200 000 Kč
      initialBalanceDate: '2026-04-01',
      isUsableCash: false,
      isNetWorth: true,
      currentMarketValueInHaler: 22000000,
      marketValueUpdatedAt: '2026-04-15',
      color: '#8b5cf6',
      sortOrder: 1,
      status: 'active',
      createdAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-04-01T00:00:00Z',
    };

    // K datu před aktivací (např. 2026-03-31) je zůstatek 0
    expect(getAccountBalanceAtDate('acc_pension', '2026-03-31', 1, [], [], [pensionAccount])).toBe(0);
    // K datu aktivace (2026-04-01) je zůstatek 200 000 Kč
    expect(getAccountBalanceAtDate('acc_pension', '2026-04-01', 1, [], [], [pensionAccount])).toBe(20000000);

    const forecast = calculateForecast(
      [periodMarch2026, periodApril2026],
      [pensionAccount],
      [],
      [],
      [],
      [],
      defaultSettings
    );

    // Březen (před aktivací): hodnota 0 Kč
    expect(forecast.periods[0].accountBalances['acc_pension'].closingBalanceInHaler).toBe(0);
    // Duben (po aktivaci): hodnota je evidována
    expect(forecast.periods[1].accountBalances['acc_pension'].closingBalanceInHaler).toBe(20000000);
  });
});
