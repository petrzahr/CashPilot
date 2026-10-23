import { describe, it, expect } from 'vitest';
import { getAccountFlowInHaler, getDefaultAccount, getEffectiveAmountInHaler } from '../services/accountScope';
import { Account, Transaction } from '../types/finance';

const acc = (id: string, partial: Partial<Account> = {}): Account => ({
  id, name: id, type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2025-01-01',
  isUsableCash: true, isNetWorth: true, color: '#000000', sortOrder: 1, status: 'active',
  createdAt: '', updatedAt: '', ...partial,
});

const tx = (partial: Partial<Transaction>): Transaction => ({
  id: 'tx', title: 'Položka', type: 'expense', status: 'executed', date: '2026-08-20',
  amountInHaler: 1000, sourceAccountId: 'chk', createdAt: '', updatedAt: '', ...partial,
} as Transaction);

describe('getDefaultAccount', () => {
  it('vrací výchozí účet', () => {
    expect(getDefaultAccount([acc('a'), acc('b', { isDefault: true })])?.id).toBe('b');
  });

  it('archivovaný výchozí účet ani žádný výchozí účet nevrací nic', () => {
    expect(getDefaultAccount([acc('a', { isDefault: true, status: 'archived' })])).toBeUndefined();
    expect(getDefaultAccount([acc('a')])).toBeUndefined();
  });
});

describe('getEffectiveAmountInHaler', () => {
  it('provedená položka se skutečnou částkou ji použije', () => {
    expect(getEffectiveAmountInHaler(tx({ actualAmountInHaler: 1200 }))).toBe(1200);
  });

  it('provedená položka bez skutečné částky použije plánovanou', () => {
    expect(getEffectiveAmountInHaler(tx({}))).toBe(1000);
  });

  it('plánovaná položka ignoruje zastaralou skutečnou částku', () => {
    expect(getEffectiveAmountInHaler(tx({ status: 'planned', actualAmountInHaler: 1200 }))).toBe(1000);
  });
});

describe('getAccountFlowInHaler', () => {
  it('příjem přičítá a výdaj odečítá jen na svém účtu', () => {
    expect(getAccountFlowInHaler(tx({ type: 'income' }), 'chk')).toBe(1000);
    expect(getAccountFlowInHaler(tx({ type: 'expense' }), 'chk')).toBe(-1000);
    expect(getAccountFlowInHaler(tx({ type: 'expense' }), 'sav')).toBe(0);
  });

  it('převod ven odečítá, převod dovnitř přičítá, převod na sebe je 0', () => {
    const transfer = tx({ type: 'transfer', targetAccountId: 'sav', actualAmountInHaler: 1500 });
    expect(getAccountFlowInHaler(transfer, 'chk')).toBe(-1500);
    expect(getAccountFlowInHaler(transfer, 'sav')).toBe(1500);
    expect(getAccountFlowInHaler(transfer, 'other')).toBe(0);
    expect(getAccountFlowInHaler(tx({ type: 'transfer', targetAccountId: 'chk' }), 'chk')).toBe(0);
  });

  it('korekce nemá tok a explicitní částka má přednost', () => {
    expect(getAccountFlowInHaler(tx({ type: 'balance_adjustment', diffInHaler: 500 }), 'chk')).toBe(0);
    expect(getAccountFlowInHaler(tx({ type: 'income' }), 'chk', 42)).toBe(42);
  });
});
