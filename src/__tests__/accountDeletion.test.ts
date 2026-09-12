import { describe, it, expect } from 'vitest';
import { Account, BalanceCorrection, MarketValueSnapshot, RecurringException, RecurringRule, Transaction } from '../types/finance';
import { sanitizeCorrections } from '../services/storageService';

describe('Account Deletion and Orphaned Corrections Sanitization', () => {
  const emptyAccount: Account = {
    id: 'demo_acc_savings2',
    name: 'Spořicí účet Air Bank',
    type: 'savings',
    currency: 'CZK',
    initialBalanceInHaler: 8000000,
    initialBalanceDate: '2026-09-01',
    isUsableCash: true,
    isNetWorth: true,
    status: 'active',
    color: '#84cc16',
    sortOrder: 4,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  };

  const activeAccount: Account = {
    id: 'demo_acc_checking',
    name: 'Běžný účet',
    type: 'checking',
    currency: 'CZK',
    initialBalanceInHaler: 5000000,
    initialBalanceDate: '2026-09-01',
    isUsableCash: true,
    isNetWorth: true,
    status: 'active',
    color: '#0284c7',
    sortOrder: 1,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  };

  const accountWithRule: Account = {
    id: 'demo_acc_savings',
    name: 'Spořicí účet',
    type: 'savings',
    currency: 'CZK',
    initialBalanceInHaler: 10000000,
    initialBalanceDate: '2026-09-01',
    isUsableCash: true,
    isNetWorth: true,
    status: 'active',
    color: '#10b981',
    sortOrder: 2,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  };

  const sampleTx: Transaction = {
    id: 'tx_1',
    title: 'Nákup potravin',
    amountInHaler: 50000,
    date: '2026-09-05',
    sequence: 1,
    type: 'expense',
    sourceAccountId: 'demo_acc_checking',
    status: 'executed',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  };

  const sampleRule: RecurringRule = {
    id: 'rule_1',
    title: 'Pravidelný převod na spoření',
    amountInHaler: 200000,
    type: 'transfer',
    sourceAccountId: 'demo_acc_checking',
    targetAccountId: 'demo_acc_savings',
    frequency: 'monthly',
    dayOfMonth: 15,
    startDate: '2026-09-01',
    isActive: true,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  };

  const orphanCorrection: BalanceCorrection = {
    id: 'legacy_corr_airbank',
    accountId: 'demo_acc_savings2',
    checkDate: '2026-09-02',
    calculatedBalanceInHaler: 8000000,
    actualBalanceInHaler: 8500000,
    diffInHaler: 500000,
    note: 'Stará testovací korekce',
    createdAt: '2026-09-02T10:00:00Z',
    updatedAt: '2026-09-02T10:00:00Z',
  };

  const validCorrection: BalanceCorrection = {
    id: 'corr_checking_1',
    accountId: 'demo_acc_checking',
    checkDate: '2026-09-08',
    calculatedBalanceInHaler: 4500000,
    actualBalanceInHaler: 5000000,
    diffInHaler: 500000,
    note: 'Korekce zůstatku běžného účtu',
    createdAt: '2026-09-08T10:00:00Z',
    updatedAt: '2026-09-08T10:00:00Z',
  };

  describe('sanitizeCorrections function', () => {
    it('removes orphaned legacy correction for an empty account with no transactions and no rules', () => {
      const { cleanedCorrections, hasCorrectionsRemoved } = sanitizeCorrections(
        [orphanCorrection],
        [sampleTx],
        [sampleRule]
      );

      expect(hasCorrectionsRemoved).toBe(true);
      expect(cleanedCorrections).toHaveLength(0);
    });

    it('preserves corrections for accounts that have transactions', () => {
      const { cleanedCorrections, hasCorrectionsRemoved } = sanitizeCorrections(
        [validCorrection],
        [sampleTx],
        [sampleRule]
      );

      expect(hasCorrectionsRemoved).toBe(false);
      expect(cleanedCorrections).toHaveLength(1);
      expect(cleanedCorrections[0].id).toBe('corr_checking_1');
    });

    it('preserves corrections for accounts that have recurring rules', () => {
      const ruleSavingsCorr: BalanceCorrection = {
        id: 'corr_savings_1',
        accountId: 'demo_acc_savings',
        checkDate: '2026-09-05',
        calculatedBalanceInHaler: 10000000,
        actualBalanceInHaler: 10500000,
        diffInHaler: 500000,
        createdAt: '2026-09-05T00:00:00Z',
        updatedAt: '2026-09-05T00:00:00Z',
      };

      const { cleanedCorrections, hasCorrectionsRemoved } = sanitizeCorrections(
        [orphanCorrection, ruleSavingsCorr],
        [sampleTx],
        [sampleRule]
      );

      expect(hasCorrectionsRemoved).toBe(true);
      expect(cleanedCorrections).toHaveLength(1);
      expect(cleanedCorrections[0].id).toBe('corr_savings_1');
    });

    it('does not touch any other account data or transactions', () => {
      const { cleanedCorrections } = sanitizeCorrections(
        [orphanCorrection, validCorrection],
        [sampleTx],
        [sampleRule]
      );

      expect(cleanedCorrections).toEqual([validCorrection]);
    });
  });

  describe('deleteAccount referential integrity logic', () => {
    function simulateDeleteAccount(
      id: string,
      accounts: Account[],
      transactions: Transaction[],
      recurringRules: RecurringRule[],
      corrections: BalanceCorrection[],
      snapshots: MarketValueSnapshot[] = [],
      exceptions: RecurringException[] = [],
      usableOverrides: Record<string, boolean> = {}
    ): {
      success: boolean;
      message?: string;
      newAccounts?: Account[];
      newCorrections?: BalanceCorrection[];
      newSnapshots?: MarketValueSnapshot[];
      newExceptions?: RecurringException[];
      newOverrides?: Record<string, boolean>;
    } {
      const hasTransactions = transactions.some(t => t.sourceAccountId === id || t.targetAccountId === id);
      const hasRules = recurringRules.some(r => r.sourceAccountId === id || r.targetAccountId === id);
      const hasActiveCorrections = corrections.some(c =>
        c.accountId === id && (
          hasTransactions ||
          transactions.some(t => t.id === c.id || (t.type === 'balance_adjustment' && t.sourceAccountId === id))
        )
      );

      if (hasTransactions || hasRules || hasActiveCorrections) {
        return {
          success: false,
          message: 'Účet s existující historií (transakce, trvalé příkazy nebo korekce) nelze fyzicky smazat. Můžete jej bezpečně archivovat.'
        };
      }

      const newOverrides = { ...usableOverrides };
      delete newOverrides[id];

      return {
        success: true,
        newAccounts: accounts.filter(a => a.id !== id),
        newCorrections: corrections.filter(c => c.accountId !== id),
        newSnapshots: snapshots.filter(s => s.accountId !== id),
        newExceptions: exceptions.filter(e => e.overrideSourceAccountId !== id && e.overrideTargetAccountId !== id),
        newOverrides,
      };
    }

    it('allows deleting Spořicí účet Air Bank even if an orphaned legacy correction exists in data', () => {
      const res = simulateDeleteAccount(
        'demo_acc_savings2',
        [activeAccount, emptyAccount, accountWithRule],
        [sampleTx],
        [sampleRule],
        [orphanCorrection, validCorrection],
        [{ id: 'snap_1', accountId: 'demo_acc_savings2', date: '2026-09-01', marketValueInHaler: 8000000, createdAt: '', updatedAt: '' }],
        [],
        { 'demo_acc_savings2': true }
      );

      expect(res.success).toBe(true);
      expect(res.newAccounts?.map(a => a.id)).not.toContain('demo_acc_savings2');
      expect(res.newCorrections?.map(c => c.accountId)).not.toContain('demo_acc_savings2');
      expect(res.newCorrections?.map(c => c.id)).toContain('corr_checking_1');
      expect(res.newSnapshots?.map(s => s.accountId)).not.toContain('demo_acc_savings2');
      expect(res.newOverrides?.['demo_acc_savings2']).toBeUndefined();
    });

    it('blocks deleting an account that has real transactions', () => {
      const res = simulateDeleteAccount(
        'demo_acc_checking',
        [activeAccount, emptyAccount],
        [sampleTx],
        [],
        []
      );

      expect(res.success).toBe(false);
      expect(res.message).toContain('nelze fyzicky smazat');
    });

    it('blocks deleting an account that is part of a recurring rule', () => {
      const res = simulateDeleteAccount(
        'demo_acc_savings',
        [accountWithRule, emptyAccount],
        [],
        [sampleRule],
        []
      );

      expect(res.success).toBe(false);
      expect(res.message).toContain('nelze fyzicky smazat');
    });

    it('blocks deleting an account that has an active balance adjustment transaction', () => {
      const balanceAdjTx: Transaction = {
        id: 'corr_tx_1',
        title: 'Korekce zůstatku',
        amountInHaler: 500000,
        diffInHaler: 500000,
        date: '2026-09-08',
        sequence: 1,
        type: 'balance_adjustment',
        sourceAccountId: 'demo_acc_savings2',
        status: 'executed',
        createdAt: '2026-09-08T00:00:00Z',
        updatedAt: '2026-09-08T00:00:00Z',
      };

      const res = simulateDeleteAccount(
        'demo_acc_savings2',
        [emptyAccount],
        [balanceAdjTx],
        [],
        [orphanCorrection]
      );

      expect(res.success).toBe(false);
      expect(res.message).toContain('nelze fyzicky smazat');
    });
  });
});
