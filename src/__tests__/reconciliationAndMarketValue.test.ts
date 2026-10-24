import { describe, it, expect } from 'vitest';
import { Account, BalanceCorrection, BudgetPeriod, MarketValueSnapshot, RecurringRule, Transaction } from '../types/finance';
import { summarizePeriods } from '../services/financialEngine';
import { getAccountBalanceAtDate } from '../services/accountBalance';
import { getNextSequenceForDate, normalizeDaySequences } from '../services/sequenceService';
import { DEFAULT_SETTINGS } from '../services/demoData';
import { AppData } from '../services/storageService';
import { createEmptyAppData } from '../constants/defaultData';
import { reconcileBalance } from '../services/accountCommands';
import { createCommandContext } from '../services/transactionCommands';

// Vypočtený stav pro korekci: včetně plánovaných položek, před zadaným pořadím v rámci dne
const balanceAt = (
  accountId: string,
  date: string,
  beforeSequence: number | undefined,
  transactions: Transaction[],
  corrections: BalanceCorrection[],
  accounts: Account[]
): number => {
  const account = accounts.find(a => a.id === accountId);
  return account
    ? getAccountBalanceAtDate(account, date, { transactions, corrections }, { includePlanned: true, beforeSequence })
    : 0;
};

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
    startDay: 15,
  };

  const periodOct2026: BudgetPeriod = {
    key: '2026-10',
    name: 'Říjen 2026',
    year: 2026,
    month: 10,
    startDate: '2026-10-15',
    endDate: '2026-11-14',
    startDay: 15,
  };

  describe('Current market value forecast', () => {
    it.each([35000000, 25000000, 0])('anchors assets at %i without predicting returns', marketValue => {
      const investment = { ...sampleInvestmentAccount, initialBalanceInHaler: 30000000,
        currentMarketValueInHaler: marketValue, marketValueUpdatedAt: '2026-09-20' };
      const pension = { ...samplePensionAccount, currentMarketValueInHaler: 18000000,
        marketValueUpdatedAt: '2026-09-20' };
      const accounts = [sampleCheckingAccount, investment, pension];
      const result = summarizePeriods(
        [periodSep2026, periodOct2026],
        { accounts },
        { currentPeriodKey: periodSep2026.key, today: '2026-09-21' }
      );
      const projectedSep = result.getPeriod(periodSep2026.key)!.projected;
      expect(projectedSep.usableClosingInHaler).toBe(5000000);
      expect(projectedSep.netWorthClosingInHaler).toBe(23000000 + marketValue);
      // Current period keeps its period-start opening; only the closing is anchored at today
      const [current, ...later] = result.forecastPeriods!;
      expect(current.accountBalances[investment.id].openingBalanceInHaler).toBe(30000000);
      expect(current.accountBalances[investment.id].closingBalanceInHaler).toBe(marketValue);
      expect(current.openingBalanceInHaler).toBe(55000000);
      expect(current.netWorthOpeningInHaler).toBe(55000000);
      expect(current.closingBalanceInHaler).toBe(23000000 + marketValue);
      for (const period of later) {
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
      const result = summarizePeriods(
        [periodSep2026, periodOct2026],
        { accounts: [sampleCheckingAccount, investment], transactions, marketValueSnapshots: snapshots },
        { currentPeriodKey: periodSep2026.key, today: '2026-09-21' }
      );
      const first = result.forecastPeriods![0];
      expect(first.accountBalances[investment.id].openingBalanceInHaler).toBe(12000000);
      expect(first.accountBalances[investment.id].transfersInInHaler).toBe(300000);
      expect(first.accountBalances[investment.id].closingBalanceInHaler).toBe(35300000);
      expect(result.forecastPeriods![1].accountBalances[investment.id].closingBalanceInHaler).toBe(35300000);
      expect(first.usableClosingInHaler).toBe(5150000);
      expect(result.getPeriod(periodSep2026.key)!.projected.usableClosingInHaler).toBe(first.usableClosingInHaler);
      expect(result.periods[0].accountBalances[investment.id].openingBalanceInHaler).toBe(12000000);
    });

    it('keeps asset income out of transfers and rows add up in current and future periods', () => {
      const pension: Account = { ...samplePensionAccount, currentMarketValueInHaler: undefined, marketValueUpdatedAt: undefined };
      const tx = (id: string, date: string, status: Transaction['status'], type: Transaction['type'], amount: number): Transaction => ({
        id, date, status, type, sequence: 1, amountInHaler: amount,
        sourceAccountId: type === 'transfer' ? sampleCheckingAccount.id : pension.id,
        targetAccountId: type === 'transfer' ? pension.id : undefined,
        title: id, createdAt: date, updatedAt: date,
      });
      const transactions = [
        tx('sep_contribution', '2026-09-16', 'executed', 'transfer', 170000),
        tx('sep_state', '2026-10-01', 'planned', 'income', 220000),
        tx('oct_contribution', '2026-10-20', 'planned', 'transfer', 170000),
        tx('oct_state', '2026-10-25', 'planned', 'income', 220000),
      ];
      const result = summarizePeriods(
        [periodSep2026, periodOct2026],
        { accounts: [sampleCheckingAccount, pension], transactions },
        { currentPeriodKey: periodSep2026.key, today: '2026-09-21' }
      );
      const [sep, oct] = result.forecastPeriods!;

      expect(sep.accountBalances[pension.id]).toMatchObject({
        openingBalanceInHaler: 20000000, incomeInHaler: 220000, transfersInInHaler: 170000, closingBalanceInHaler: 20390000,
      });
      expect(oct.accountBalances[pension.id]).toMatchObject({
        openingBalanceInHaler: 20390000, incomeInHaler: 220000, transfersInInHaler: 170000, closingBalanceInHaler: 20780000,
      });

      for (const p of [sep, oct]) {
        let flows = 0;
        for (const b of Object.values(p.accountBalances)) {
          flows += b.incomeInHaler - b.expenseInHaler + b.transfersInInHaler - b.transfersOutInHaler + b.correctionsInHaler;
        }
        expect(p.openingBalanceInHaler + flows).toBe(p.closingBalanceInHaler);
        expect(p.netWorthOpeningInHaler + p.netChangeInHaler).toBe(p.netWorthClosingInHaler);
      }
    });
  });

  describe('Standard accounts: getAccountBalanceAtDate and sequence handling', () => {
    it('1. Computes initial balance before any movements', () => {
      const bal = balanceAt(
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

      const bal = balanceAt(
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
      const balBeforeSeq1 = balanceAt(
        sampleCheckingAccount.id,
        '2026-09-20',
        1,
        txs,
        [],
        [sampleCheckingAccount]
      );
      expect(balBeforeSeq1).toBe(5000000);

      // Before sequence 2 (includes seq 1)
      const balBeforeSeq2 = balanceAt(
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

      const balBeforeSeq3 = balanceAt(
        sampleCheckingAccount.id,
        '2026-09-20',
        nextSeq,
        txs,
        [],
        [sampleCheckingAccount]
      );
      expect(balBeforeSeq3).toBe(4650000); // 50 000 - 1 500 - 2 000
    });

    const reconcileCtx = createCommandContext('2026-09-20', new Date('2026-09-20T12:00:00Z'));
    const reconcileData = (transactions: Transaction[]): AppData => ({
      ...createEmptyAppData(),
      accounts: [sampleCheckingAccount],
      transactions,
    });
    const expense = (id: string, sequence: number, amountInHaler: number): Transaction => ({
      id, title: 'Výdaj', amountInHaler, actualAmountInHaler: amountInHaler, date: '2026-09-20', sequence,
      type: 'expense', sourceAccountId: sampleCheckingAccount.id, status: 'executed', createdAt: '', updatedAt: '',
    });

    it('4. Positive balance correction: diff = actual - calculated > 0', () => {
      // Vypočteno 50 000 - 1 500 - 2 000 = 46 500 Kč, v bance je 50 000 Kč
      const { data, outcome } = reconcileBalance(
        reconcileData([expense('t1', 1, 150000), expense('t2', 2, 200000)]),
        { accountId: sampleCheckingAccount.id, actualBalanceInHaler: 5000000, checkDate: '2026-09-20', note: 'Oprava dle bankovního výpisu' },
        reconcileCtx
      );
      expect(outcome).toEqual({ kind: 'corrected', diffInHaler: 350000 }); // +3 500 Kč

      const corrTx = data.transactions.find(t => t.type === 'balance_adjustment')!;
      expect(corrTx).toMatchObject({
        sequence: 3, amountInHaler: 350000, diffInHaler: 350000,
        calculatedBalanceInHaler: 4650000, actualBalanceInHaler: 5000000, note: 'Oprava dle bankovního výpisu',
      });
      expect(data.corrections).toEqual([expect.objectContaining({ id: corrTx.id, diffInHaler: 350000, sequence: 3 })]);

      // Po korekci odpovídá zůstatek bance
      expect(balanceAt(sampleCheckingAccount.id, '2026-09-20', 4, data.transactions, data.corrections, data.accounts)).toBe(5000000);
    });

    it('5. Negative balance correction: diff = actual - calculated < 0', () => {
      const { data, outcome } = reconcileBalance(
        reconcileData([]),
        { accountId: sampleCheckingAccount.id, actualBalanceInHaler: 4800000, checkDate: '2026-09-20' },
        reconcileCtx
      );
      expect(outcome).toEqual({ kind: 'corrected', diffInHaler: -200000 }); // -2 000 Kč
      expect(data.transactions[0]).toMatchObject({ amountInHaler: 200000, diffInHaler: -200000, note: 'Aktualizace skutečného stavu' });
      expect(balanceAt(sampleCheckingAccount.id, '2026-09-21', 1, data.transactions, data.corrections, data.accounts)).toBe(4800000);
    });

    it('6. Zero correction: diff === 0 produces no financial change', () => {
      const before = reconcileData([]);
      const result = reconcileBalance(
        before,
        { accountId: sampleCheckingAccount.id, actualBalanceInHaler: 5000000, checkDate: '2026-09-20' },
        reconcileCtx
      );
      expect(result.outcome).toEqual({ kind: 'unchanged' });
      expect(result.data).toBe(before);
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
      const repaired = normalizeDaySequences(remaining);

      expect(repaired.length).toBe(2);
      expect(repaired[0].id).toBe('tx_1');
      expect(repaired[0].sequence).toBe(1);
      expect(repaired[1].id).toBe('tx_3');
      expect(repaired[1].sequence).toBe(2); // resequenced from 3 to 2

      // Zůstatek po smazání korekce
      const balAfterDel = balanceAt(
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

      const forecast = summarizePeriods(
        [periodSep2026, periodOct2026],
        { accounts: [sampleCheckingAccount], transactions: [corrTx] }
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

      const bal = balanceAt(
        sampleInvestmentAccount.id,
        '2026-09-20',
        1,
        [],
        [legacyCorr],
        [sampleInvestmentAccount]
      );
      // Correction ignored; the account's market value applies
      expect(bal).toBe(sampleInvestmentAccount.currentMarketValueInHaler);
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

      const forecast = summarizePeriods(
        [periodSep2026, periodOct2026],
        { accounts: [sampleCheckingAccount, samplePensionAccount], recurringRules: [transferRule], marketValueSnapshots: [snap] }
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
      const forecast = summarizePeriods(
        [periodSep2026, periodOct2026],
        { accounts: [sampleInvestmentAccount] }
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
