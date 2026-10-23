import { describe, it, expect } from 'vitest';
import { getAccountBalanceAtDate } from '../services/accountBalance';
import { Account, BalanceCorrection, MarketValueSnapshot, Transaction } from '../types/finance';

const acc = (partial: Partial<Account> = {}): Account => ({
  id: 'chk', name: 'Běžný', type: 'checking', currency: 'CZK', initialBalanceInHaler: 100000, initialBalanceDate: '2026-01-01',
  isUsableCash: true, isNetWorth: true, color: '#000000', sortOrder: 1, status: 'active',
  createdAt: '', updatedAt: '', ...partial,
});

let seq = 0;
const tx = (partial: Partial<Transaction>): Transaction => ({
  id: `tx_${++seq}`, title: 'Položka', type: 'expense', status: 'executed', date: '2026-02-10',
  amountInHaler: 1000, sourceAccountId: 'chk', createdAt: '', updatedAt: '', ...partial,
} as Transaction);

const corr = (partial: Partial<BalanceCorrection> = {}): BalanceCorrection => ({
  id: 'c1', accountId: 'chk', checkDate: '2026-02-15', actualBalanceInHaler: 0, calculatedBalanceInHaler: 0,
  diffInHaler: 500, createdAt: '', ...partial,
});

describe('getAccountBalanceAtDate - běžný účet', () => {
  const checking = acc();

  it('před aktivací je 0, v den aktivace počáteční zůstatek', () => {
    expect(getAccountBalanceAtDate(checking, '2025-12-31', { transactions: [] })).toBe(0);
    expect(getAccountBalanceAtDate(checking, '2026-01-01', { transactions: [] })).toBe(100000);
  });

  it('výchozí stav počítá jen provedené položky, includePlanned i plánované', () => {
    const transactions = [tx({}), tx({ status: 'planned', amountInHaler: 2000 }), tx({ status: 'cancelled', amountInHaler: 4000 })];
    expect(getAccountBalanceAtDate(checking, '2026-02-28', { transactions })).toBe(99000);
    expect(getAccountBalanceAtDate(checking, '2026-02-28', { transactions }, { includePlanned: true })).toBe(97000);
  });

  it('nezapočítá položky po datu ani položky v daný den od zadaného pořadí', () => {
    const transactions = [tx({ sequence: 1 }), tx({ sequence: 2, amountInHaler: 2000 }), tx({ date: '2026-03-01' })];
    expect(getAccountBalanceAtDate(checking, '2026-02-10', { transactions })).toBe(97000);
    expect(getAccountBalanceAtDate(checking, '2026-02-10', { transactions }, { beforeSequence: 2 })).toBe(99000);
  });

  it('převody a korekce jako položka mění zůstatek, korekce v libovolném stavu', () => {
    const transactions = [
      tx({ type: 'transfer', targetAccountId: 'sav' }),
      tx({ type: 'transfer', sourceAccountId: 'sav', targetAccountId: 'chk', amountInHaler: 3000 }),
      tx({ type: 'balance_adjustment', status: 'planned', diffInHaler: -200 }),
    ];
    expect(getAccountBalanceAtDate(checking, '2026-02-28', { transactions })).toBe(100000 - 1000 + 3000 - 200);
  });

  it('starší korekci započítá jednou, i když je uložená i jako položka', () => {
    const c = corr();
    expect(getAccountBalanceAtDate(checking, '2026-02-28', { transactions: [], corrections: [c] })).toBe(100500);
    expect(getAccountBalanceAtDate(checking, '2026-02-14', { transactions: [], corrections: [c] })).toBe(100000);
    const asTx = tx({ id: 'c1', type: 'balance_adjustment', date: '2026-02-15', diffInHaler: 500 });
    expect(getAccountBalanceAtDate(checking, '2026-02-28', { transactions: [asTx], corrections: [c] })).toBe(100500);
  });
});

describe('getAccountBalanceAtDate - investiční a penzijní účet', () => {
  const investment = acc({ id: 'inv', type: 'investment' });
  const deposit = (date: string, partial: Partial<Transaction> = {}) =>
    tx({ type: 'transfer', sourceAccountId: 'chk', targetAccountId: 'inv', date, amountInHaler: 10000, ...partial });

  it('bez ocenění = počáteční zůstatek + toky od aktivace včetně', () => {
    const transactions = [deposit('2026-01-01'), deposit('2026-02-01'), deposit('2026-02-02', { status: 'planned' })];
    expect(getAccountBalanceAtDate(investment, '2026-02-28', { transactions })).toBe(120000);
    expect(getAccountBalanceAtDate(investment, '2026-02-28', { transactions }, { includePlanned: true })).toBe(130000);
  });

  it('vychází z posledního snapshotu k datu a přičte jen toky po něm', () => {
    const snapshots: MarketValueSnapshot[] = [
      { id: 's1', accountId: 'inv', date: '2026-02-01', marketValueInHaler: 150000, createdAt: '' },
      { id: 's2', accountId: 'inv', date: '2026-04-01', marketValueInHaler: 999999, createdAt: '' },
    ];
    const transactions = [deposit('2026-02-01'), deposit('2026-03-01')];
    expect(getAccountBalanceAtDate(investment, '2026-03-15', { transactions, snapshots })).toBe(160000);
  });

  it('bez snapshotu použije tržní hodnotu na účtu k jejímu datu', () => {
    const valued = { ...investment, currentMarketValueInHaler: 200000, marketValueUpdatedAt: '2026-02-01' };
    const transactions = [deposit('2026-02-01'), deposit('2026-03-01')];
    expect(getAccountBalanceAtDate(valued, '2026-03-15', { transactions })).toBe(210000);
    // Před datem ocenění se tržní hodnota nepoužije
    expect(getAccountBalanceAtDate(valued, '2026-01-31', { transactions })).toBe(100000);
  });

  it('ignoruje korekce zůstatku', () => {
    expect(getAccountBalanceAtDate(investment, '2026-02-28', { transactions: [], corrections: [corr({ accountId: 'inv' })] })).toBe(100000);
  });
});
