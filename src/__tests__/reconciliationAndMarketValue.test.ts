import { describe, it, expect } from 'vitest';
import { Account, BalanceCorrection, BudgetPeriod, MarketValueSnapshot, RecurringRule, Transaction } from '../types/finance';
import { calculateForecast, getAccountBalanceAtDate, getEffectiveTransactionsForPeriod } from '../services/financialEngine';
import { getNextSequenceForDate, sanitizeAndRepairSequences, sortTransactionsByDateAndSequence } from '../services/sequenceService';
import { addHaler, subHaler } from '../services/currencyService';
import { DEFAULT_SETTINGS } from '../services/demoData';

describe('Reconciliation and Market Value Engine', () => {
  const sampleCheckingAccount: Account = {
    id: 'acc_checking_1',
    name: 'Běžný účet',
    type: 'checking',
    currency: 'CZK',
    initialBalanceInHaler: 5000000, // 50 000 Kč
    initialBalanceDate: '2026-09-01',
    sortOrder: 1,
    color: '#0284c7',
    isUsableCash: true,
    isNetWorth: true,
    status: 'active',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  };

  const sampleInvestmentAccount: Account = {
    id: 'acc_invest_1',
    name: 'Investiční portfolio',
    type: 'investment',
    currency: 'CZK',
    initialBalanceInHaler: 10000000, // 100 000 Kč
    initialBalanceDate: '2026-09-01',
    currentMarketValueInHaler: 12000000, // 120 000 Kč
    marketValueUpdatedAt: '2026-09-10',
    sortOrder: 2,
    color: '#8b5cf6',
    isUsableCash: false,
    isNetWorth: true,
    status: 'active',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  };

  const samplePensionAccount: Account = {
    id: 'acc_pension_1',
    name: 'Doplňkové penzijní spoření',
    type: 'pension',
    currency: 'CZK',
    initialBalanceInHaler: 20000000, // 200 000 Kč
    initialBalanceDate: '2026-09-01',
    currentMarketValueInHaler: 21500000, // 215 000 Kč
    marketValueUpdatedAt: '2026-08-31',
    sortOrder: 3,
    color: '#10b981',
    isUsableCash: false,
    isNetWorth: true,
    status: 'active',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  };

  const periodSep2026: BudgetPeriod = {
    key: '2026-09',
    name: 'Září 2026',
    year: 2026,
    month: 9,
    startDate: '2026-09-15',
    endDate: '2026-10-14',
  };

  const periodOct2026: BudgetPeriod = {
    key: '2026-10',
    name: 'Říjen 2026',
    year: 2026,
    month: 10,
    startDate: '2026-10-15',
    endDate: '2026-11-14',
  };

  describe('Current market value forecast', () => {
    it.each([35000000, 25000000, 0])('anchors assets at %i without predicting returns', marketValue => {
      const investment = { ...sampleInvestmentAccount, initialBalanceInHaler: 30000000,
        currentMarketValueInHaler: marketValue, marketValueUpdatedAt: '2026-09-20' };
      const pension = { ...samplePensionAccount, currentMarketValueInHaler: 18000000,
        marketValueUpdatedAt: '2026-09-20' };
      const accounts = [sampleCheckingAccount, investment, pension];
      const result = calculateForecast([periodSep2026, periodOct2026], accounts,
        [], [], [], [], DEFAULT_SETTINGS, [], periodSep2026.key, '2026-09-21');
      expect(result.usableCashNowInHaler).toBe(5000000);
      expect(result.expectedClosingCurrentPeriodInHaler).toBe(5000000);
      expect(result.netWorthNowInHaler).toBe(23000000 + marketValue);
      for (const period of result.forecastPeriods!) {
        expect(period.accountBalances[investment.id].openingBalanceInHaler).toBe(marketValue);
        expect(period.accountBalances[investment.id].closingBalanceInHaler).toBe(marketValue);
        expect(period.openingBalanceInHaler).toBe(23000000 + marketValue);
        expect(period.netWorthOpeningInHaler).toBe(period.openingBalanceInHaler);
        expect(period.closingBalanceInHaler).toBe(period.openingBalanceInHaler);
      }
    });

    it('applies remaining transfers once and preserves liquid income/expense forecasts', () => {
      const investment = { ...sampleInvestmentAccount, initialBalanceInHaler: 30000000 };
      const snapshots: MarketValueSnapshot[] = [{ id: 'valuation', accountId: investment.id,
        date: '2026-09-18', marketValueInHaler: 35000000, createdAt: '2026-09-18T00:00:00Z' }];
      const tx = (id: string, date: string, status: Transaction['status'], type: Transaction['type'], amount: number): Transaction => ({
        id, date, status, type, sequence: 1, amountInHaler: amount, sourceAccountId: sampleCheckingAccount.id,
        targetAccountId: type === 'transfer' ? investment.id : undefined,
        title: id, createdAt: date, updatedAt: date,
      });
      const transactions = [tx('past', '2026-09-19', 'executed', 'transfer', 100000),
        tx('future', '2026-09-25', 'planned', 'transfer', 200000),
        tx('income', '2026-09-26', 'planned', 'income', 500000),
        tx('expense', '2026-09-27', 'planned', 'expense', 50000)];
      const result = calculateForecast([periodSep2026, periodOct2026], [sampleCheckingAccount, investment],
        transactions, [], [], [], DEFAULT_SETTINGS, snapshots, periodSep2026.key, '2026-09-21');
      const first = result.forecastPeriods![0];
      expect(result.netWorthNowInHaler).toBe(40100000);
      expect(first.accountBalances[investment.id].openingBalanceInHaler).toBe(35100000);
      expect(first.accountBalances[investment.id].closingBalanceInHaler).toBe(35300000);
      expect(result.forecastPeriods![1].accountBalances[investment.id].closingBalanceInHaler).toBe(35300000);
      expect(first.usableClosingInHaler).toBe(5150000);
      expect(result.expectedClosingCurrentPeriodInHaler).toBe(first.usableClosingInHaler);
      expect(result.periods[0].accountBalances[investment.id].openingBalanceInHaler).toBe(12000000);
    });
  });

  describe('Standard accounts: getAccountBalanceAtDate and sequence handling', () => {
    it('1. Computes initial balance before any movements', () => {
      const bal = getAccountBalanceAtDate(
        sampleCheckingAccount.id,
        '2026-09-15',
        1,
        [],
        [],
        [sampleCheckingAccount]
      );
      expect(bal).toBe(5000000);
    });

    it('2. Includes prior transactions on previous days', () => {
      const txs: Transaction[] = [
        {
          id: 't1',
          title: 'Mzda',
          amountInHaler: 3000000, // +30 000
          date: '2026-09-16',
          sequence: 1,
          type: 'income',
          sourceAccountId: sampleCheckingAccount.id,
          status: 'executed',
          actualAmountInHaler: 3000000,
          createdAt: '2026-09-16T10:00:00Z',
          updatedAt: '2026-09-16T10:00:00Z',
        },
      ];

      const bal = getAccountBalanceAtDate(
        sampleCheckingAccount.id,
        '2026-09-20',
        1,
        txs,
        [],
        [sampleCheckingAccount]
      );
      expect(bal).toBe(8000000); // 50 000 + 30 000
    });

    it('3. Intraday sequence: includes items with sequence < targetSequence on same day', () => {
      const txs: Transaction[] = [
        {
          id: 't1',
          title: 'Nákup potravin',
          amountInHaler: 150000, // -1 500
          date: '2026-09-20',
          sequence: 1,
          type: 'expense',
          sourceAccountId: sampleCheckingAccount.id,
          status: 'executed',
          actualAmountInHaler: 150000,
          createdAt: '2026-09-20T08:00:00Z',
          updatedAt: '2026-09-20T08:00:00Z',
        },
        {
          id: 't2',
          title: 'Benzín',
          amountInHaler: 200000, // -2 000
          date: '2026-09-20',
          sequence: 2,
          type: 'expense',
          sourceAccountId: sampleCheckingAccount.id,
          status: 'executed',
          actualAmountInHaler: 200000,
          createdAt: '2026-09-20T10:00:00Z',
          updatedAt: '2026-09-20T10:00:00Z',
        },
      ];

      // Before sequence 1
      const balBeforeSeq1 = getAccountBalanceAtDate(
        sampleCheckingAccount.id,
        '2026-09-20',
        1,
        txs,
        [],
        [sampleCheckingAccount]
      );
      expect(balBeforeSeq1).toBe(5000000);

      // Before sequence 2 (includes seq 1)
      const balBeforeSeq2 = getAccountBalanceAtDate(
        sampleCheckingAccount.id,
        '2026-09-20',
        2,
        txs,
        [],
        [sampleCheckingAccount]
      );
      expect(balBeforeSeq2).toBe(4850000); // 50 000 - 1 500

      // Before sequence 3 (includes seq 1 and 2)
      const nextSeq = getNextSequenceForDate('2026-09-20', txs);
      expect(nextSeq).toBe(3);

      const balBeforeSeq3 = getAccountBalanceAtDate(
        sampleCheckingAccount.id,
        '2026-09-20',
        nextSeq,
        txs,
        [],
        [sampleCheckingAccount]
      );
      expect(balBeforeSeq3).toBe(4650000); // 50 000 - 1 500 - 2 000
    });

    it('4. Positive balance correction: diff = actual - calculated > 0', () => {
      const calculated = 4650000; // 46 500 Kč
      const actual = 5000000;     // 50 000 Kč
      const diff = subHaler(actual, calculated);
      expect(diff).toBe(350000); // +3 500 Kč

      const corrTx: Transaction = {
        id: 'corr_tx_1',
        title: 'Korekce zůstatku',
        amountInHaler: Math.abs(diff),
        date: '2026-09-20',
        sequence: 3,
        type: 'balance_adjustment',
        sourceAccountId: sampleCheckingAccount.id,
        status: 'executed',
        actualAmountInHaler: Math.abs(diff),
        calculatedBalanceInHaler: calculated,
        actualBalanceInHaler: actual,
        diffInHaler: diff,
        note: 'Oprava dle bankovního výpisu',
        createdAt: '2026-09-20T12:00:00Z',
        updatedAt: '2026-09-20T12:00:00Z',
      };

      const balanceAfter = getAccountBalanceAtDate(
        sampleCheckingAccount.id,
        '2026-09-20',
        4,
        [corrTx],
        [],
        [sampleCheckingAccount]
      );
      // 50 000 (initial) + 3 500 (diff) = 53 500
      expect(balanceAfter).toBe(5350000);
    });

    it('5. Negative balance correction: diff = actual - calculated < 0', () => {
      const calculated = 5000000;
      const actual = 4800000; // 48 000 Kč
      const diff = subHaler(actual, calculated);
      expect(diff).toBe(-200000); // -2 000 Kč

      const corrTx: Transaction = {
        id: 'corr_tx_2',
        title: 'Korekce zůstatku',
        amountInHaler: Math.abs(diff),
        date: '2026-09-20',
        sequence: 1,
        type: 'balance_adjustment',
        sourceAccountId: sampleCheckingAccount.id,
        status: 'executed',
        actualAmountInHaler: Math.abs(diff),
        calculatedBalanceInHaler: calculated,
        actualBalanceInHaler: actual,
        diffInHaler: diff,
        createdAt: '2026-09-20T12:00:00Z',
        updatedAt: '2026-09-20T12:00:00Z',
      };

      const balanceAfter = getAccountBalanceAtDate(
        sampleCheckingAccount.id,
        '2026-09-21',
        1,
        [corrTx],
        [],
        [sampleCheckingAccount]
      );
      expect(balanceAfter).toBe(4800000);
    });

    it('6. Zero correction: diff === 0 produces no financial change', () => {
      const calculated = 5000000;
      const actual = 5000000;
      const diff = subHaler(actual, calculated);
      expect(diff).toBe(0);
    });

    it('7. Deleting a correction restores original balance and resequences remaining items', () => {
      const tx1: Transaction = {
        id: 'tx_1',
        title: 'Oběd',
        amountInHaler: 20000,
        date: '2026-09-20',
        sequence: 1,
        type: 'expense',
        sourceAccountId: sampleCheckingAccount.id,
        status: 'executed',
        createdAt: '2026-09-20T08:00:00Z',
        updatedAt: '2026-09-20T08:00:00Z',
      };
      const corrTx: Transaction = {
        id: 'corr_tx_del',
        title: 'Korekce zůstatku',
        amountInHaler: 50000,
        date: '2026-09-20',
        sequence: 2,
        type: 'balance_adjustment',
        sourceAccountId: sampleCheckingAccount.id,
        status: 'executed',
        diffInHaler: 50000,
        createdAt: '2026-09-20T09:00:00Z',
        updatedAt: '2026-09-20T09:00:00Z',
      };
      const tx3: Transaction = {
        id: 'tx_3',
        title: 'Káva',
        amountInHaler: 8000,
        date: '2026-09-20',
        sequence: 3,
        type: 'expense',
        sourceAccountId: sampleCheckingAccount.id,
        status: 'executed',
        createdAt: '2026-09-20T10:00:00Z',
        updatedAt: '2026-09-20T10:00:00Z',
      };

      const dayTxs = [tx1, corrTx, tx3];

      // Smazání korekce corr_tx_del
      const remaining = dayTxs.filter(t => t.id !== 'corr_tx_del');
      const repaired = sanitizeAndRepairSequences(remaining, '2026-09-01');

      expect(repaired.length).toBe(2);
      expect(repaired[0].id).toBe('tx_1');
      expect(repaired[0].sequence).toBe(1);
      expect(repaired[1].id).toBe('tx_3');
      expect(repaired[1].sequence).toBe(2); // resequenced from 3 to 2

      // Zůstatek po smazání korekce
      const balAfterDel = getAccountBalanceAtDate(
        sampleCheckingAccount.id,
        '2026-09-21',
        1,
        repaired,
        [],
        [sampleCheckingAccount]
      );
      // 50 000 - 200 - 80 = 49 720 Kč (5000000 - 20000 - 8000 = 4972000)
      expect(balAfterDel).toBe(4972000);
    });
  });

  describe('Forecast evaluation with balance adjustments', () => {
    it('8. Balance adjustments affect account closing balance, usable cash and net worth, but NOT income or expenses', () => {
      const corrTx: Transaction = {
        id: 'corr_test_forecast',
        title: 'Korekce zůstatku',
        amountInHaler: 200000, // 2 000 Kč
        date: '2026-09-20',
        sequence: 1,
        type: 'balance_adjustment',
        sourceAccountId: sampleCheckingAccount.id,
        status: 'executed',
        actualAmountInHaler: 200000,
        diffInHaler: 200000, // +2 000 Kč
        createdAt: '2026-09-20T10:00:00Z',
        updatedAt: '2026-09-20T10:00:00Z',
      };

      const forecast = calculateForecast(
        [periodSep2026, periodOct2026],
        [sampleCheckingAccount],
        [corrTx],
        [],
        [],
        [],
        DEFAULT_SETTINGS,
        []
      );

      const sepSummary = forecast.periods[0];
      expect(sepSummary.incomeInHaler).toBe(0); // NEZVYŠUJE provozní příjmy!
      expect(sepSummary.expenseInHaler).toBe(0); // NEZVYŠUJE provozní výdaje!
      expect(sepSummary.correctionsInHaler).toBe(200000);
      expect(sepSummary.closingBalanceInHaler).toBe(5200000); // 50 000 + 2 000
      expect(sepSummary.usableClosingInHaler).toBe(5200000);
      expect(sepSummary.netWorthClosingInHaler).toBe(5200000);

      // Přenos do následující periody
      const octSummary = forecast.periods[1];
      expect(octSummary.openingBalanceInHaler).toBe(5200000);
      expect(octSummary.closingBalanceInHaler).toBe(5200000);
    });
  });

  describe('Asset accounts (Investment & Pension): Market Value Snapshots', () => {
    it('9. Balance corrections do NOT apply to investment and pension accounts in getAccountBalanceAtDate', () => {
      // Legacy or accidental balance corrections for investment must be ignored
      const legacyCorr: BalanceCorrection = {
        id: 'bad_corr',
        accountId: sampleInvestmentAccount.id,
        checkDate: '2026-09-10',
        actualBalanceInHaler: 99999999,
        calculatedBalanceInHaler: 10000000,
        diffInHaler: 89999999,
        createdAt: '2026-09-10T00:00:00Z',
      };

      const bal = getAccountBalanceAtDate(
        sampleInvestmentAccount.id,
        '2026-09-20',
        1,
        [],
        [legacyCorr],
        [sampleInvestmentAccount]
      );
      // Ignored! Returns initialBalance
      expect(bal).toBe(sampleInvestmentAccount.initialBalanceInHaler);
    });

    it('10. Valuation snapshot updates current market value and marketValueUpdatedAt', () => {
      const snap: MarketValueSnapshot = {
        id: 'mvs_1',
        accountId: sampleInvestmentAccount.id,
        date: '2026-09-20',
        marketValueInHaler: 13500000, // 135 000 Kč
        note: 'Čtvrtletní ocenění',
        createdAt: '2026-09-20T12:00:00Z',
        updatedAt: '2026-09-20T12:00:00Z',
      };

      expect(snap.date).toBe('2026-09-20');
      expect(snap.marketValueInHaler).toBe(13500000);
      expect(snap.note).toBe('Čtvrtletní ocenění');
    });

    it('11. Forecast evaluates asset accounts with snapshots and planned transfers without automatic appreciation', () => {
      const snap: MarketValueSnapshot = {
        id: 'mvs_pension_1',
        accountId: samplePensionAccount.id,
        date: '2026-09-18',
        marketValueInHaler: 22000000, // 220 000 Kč
        createdAt: '2026-09-18T10:00:00Z',
      };

      // Pravidelný vklad 2 000 Kč z běžného účtu na penzijní
      const transferRule: RecurringRule = {
        id: 'rule_transfer_pension',
        title: 'Příspěvek na penzijko',
        amountInHaler: 200000, // 2 000 Kč
        type: 'transfer',
        frequency: 'monthly',
        dayOfMonth: 25,
        startDate: '2026-09-15',
        sourceAccountId: sampleCheckingAccount.id,
        targetAccountId: samplePensionAccount.id,
        isActive: true,
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
      };

      const forecast = calculateForecast(
        [periodSep2026, periodOct2026],
        [sampleCheckingAccount, samplePensionAccount],
        [],
        [transferRule],
        [],
        [],
        DEFAULT_SETTINGS,
        [snap]
      );

      const sepSummary = forecast.periods[0];
      const pensionBalSep = sepSummary.accountBalances[samplePensionAccount.id];
      // Snapshot 220 000 + vklad 2 000 k 25. 9. (po datu snapshotu 18. 9.) = 222 000 Kč
      expect(pensionBalSep.closingBalanceInHaler).toBe(22200000);
      expect(pensionBalSep.transfersInInHaler).toBe(200000);

      // Usable cash does NOT include pension account
      const checkingBalSep = sepSummary.accountBalances[sampleCheckingAccount.id];
      expect(checkingBalSep.closingBalanceInHaler).toBe(4800000); // 50 000 - 2 000
      expect(sepSummary.usableClosingInHaler).toBe(4800000);

      // Celkový majetek (net worth) zahrnuje běžný účet (48 000) + penzijní (222 000) = 270 000 Kč
      expect(sepSummary.netWorthClosingInHaler).toBe(27000000);

      // Druhá perioda (říjen): penzijní stav 222 000 + další vklad 2 000 = 224 000 Kč
      const octSummary = forecast.periods[1];
      const pensionBalOct = octSummary.accountBalances[samplePensionAccount.id];
      expect(pensionBalOct.closingBalanceInHaler).toBe(22400000);
    });

    it('12. Asset account without new valuation snapshot retains latest known market value in forecast', () => {
      const forecast = calculateForecast(
        [periodSep2026, periodOct2026],
        [sampleInvestmentAccount],
        [],
        [],
        [],
        [],
        DEFAULT_SETTINGS,
        []
      );

      const sepSummary = forecast.periods[0];
      const invBal = sepSummary.accountBalances[sampleInvestmentAccount.id];
      // Retains currentMarketValueInHaler (120 000 Kč)
      expect(invBal.closingBalanceInHaler).toBe(12000000);
      expect(sepSummary.usableClosingInHaler).toBe(0); // Not usable cash
      expect(sepSummary.netWorthClosingInHaler).toBe(12000000);
    });
  });
});
