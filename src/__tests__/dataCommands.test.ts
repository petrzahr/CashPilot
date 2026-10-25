import { describe, it, expect } from 'vitest';
import { createEmptyAppData, createResetAppData, DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from '../constants/defaultData';
import {
  clearAllAccounts,
  clearAllCategories,
  clearAllTransactions,
  importBackup,
  repairRecurringRules,
  replaceWithDemoData,
  resetAllData,
  updateSettings,
} from '../services/dataCommands';
import { AppData } from '../services/storageService';
import { Account, BalanceCorrection, Category, InvestmentFee, MarketValueSnapshot, RecurringException, RecurringRule, Transaction } from '../types/finance';

const tx = (id: string, date: string, sequence: number, partial: Partial<Transaction> = {}): Transaction => ({
  id, title: id, type: 'expense', status: 'executed', date, sequence, amountInHaler: 1000,
  sourceAccountId: 'chk', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', ...partial,
});

const dataWith = (transactions: Transaction[]): AppData => ({ ...createEmptyAppData(), transactions });

const order = (data: AppData, date: string) =>
  data.transactions.filter(t => t.date === date).map(t => [t.id, t.sequence]);

describe('importBackup', () => {
  it('existující položky dne zůstanou na místě, nové se připojí za ně v pořadí ze souboru', () => {
    const current = dataWith([tx('mine_1', '2026-09-15', 1), tx('mine_2', '2026-09-15', 2)]);
    const backup = dataWith([tx('new_b', '2026-09-15', 2), tx('new_a', '2026-09-15', 1)]);

    const { data } = importBackup(current, backup);
    expect(order(data, '2026-09-15')).toEqual([['mine_1', 1], ['mine_2', 2], ['new_a', 3], ['new_b', 4]]);
  });

  it('položka se stejným ID se nezdvojí ani nepřečísluje', () => {
    const current = dataWith([tx('same', '2026-09-15', 1)]);
    const { data } = importBackup(current, dataWith([tx('same', '2026-09-15', 5)]));
    expect(order(data, '2026-09-15')).toEqual([['same', 1]]);
  });

  it('nový den se seřadí podle pořadí v souboru, při shodě podle data vytvoření', () => {
    const backup = dataWith([
      tx('late', '2026-09-20', 1, { createdAt: '2026-09-20T12:00:00Z' }),
      tx('early', '2026-09-20', 1, { createdAt: '2026-09-20T08:00:00Z' }),
      tx('second', '2026-09-20', 2),
    ]);
    const { data } = importBackup(dataWith([]), backup);
    expect(order(data, '2026-09-20')).toEqual([['early', 1], ['late', 2], ['second', 3]]);
  });
});

const acc: Account = {
  id: 'chk', name: 'Běžný', type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01',
  isUsableCash: true, isNetWorth: true, color: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '',
};
const cat: Category = {
  id: 'cat', name: 'Auto', type: 'expense', parentId: null, color: '', icon: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '',
};
const rule = (id: string, partial: Partial<RecurringRule> = {}): RecurringRule => ({
  id, title: id, amountInHaler: 1000, type: 'expense', frequency: 'monthly', dayOfMonth: 15, startDate: '2026-01-15',
  sourceAccountId: 'chk', categoryId: 'cat', subcategoryId: 'sub', isActive: true, createdAt: '', updatedAt: '', ...partial,
});
const exception: RecurringException = {
  id: 'exc', ruleId: 'r1', periodKey: '2026-10', overrideCategoryId: 'cat', overrideSubcategoryId: 'sub', createdAt: '',
};
const correction: BalanceCorrection = {
  id: 'corr', accountId: 'chk', checkDate: '2026-09-01', actualBalanceInHaler: 0, calculatedBalanceInHaler: 0, diffInHaler: 0, createdAt: '',
};
const snapshot: MarketValueSnapshot = { id: 'mv', accountId: 'chk', date: '2026-09-01', marketValueInHaler: 1, createdAt: '' };
const fee: InvestmentFee = { id: 'fee', accountId: 'chk', periodKey: '2026-09', amountInHaler: 1, createdAt: '' };

const full = (): AppData => ({
  ...createEmptyAppData(),
  settings: { ...DEFAULT_SETTINGS, budgetStartDay: 10 },
  accounts: [acc],
  categories: [cat],
  transactions: [tx('t1', '2026-09-15', 1, { categoryId: 'cat', subcategoryId: 'sub' })],
  recurringRules: [rule('r1')],
  recurringExceptions: [exception],
  corrections: [correction],
  marketValueSnapshots: [snapshot],
  investmentFees: [fee],
});

describe('hromadné mazání', () => {
  it('clearAllTransactions smaže položky, pravidla, výjimky a korekce; zbytek zachová', () => {
    const before = full();
    const { data } = clearAllTransactions(before);
    expect(data).toMatchObject({ transactions: [], recurringRules: [], recurringExceptions: [], corrections: [] });
    expect(data.accounts).toBe(before.accounts);
    expect(data.categories).toBe(before.categories);
    expect(data.marketValueSnapshots).toBe(before.marketValueSnapshots);
    expect(data.investmentFees).toBe(before.investmentFees);
    expect(data.settings).toBe(before.settings);
  });

  it('clearAllAccounts smaže účty a všechna navázaná data; kategorie a nastavení zachová', () => {
    const before = full();
    const { data } = clearAllAccounts(before);
    expect(data).toMatchObject({
      accounts: [], transactions: [], recurringRules: [], recurringExceptions: [], corrections: [],
      marketValueSnapshots: [], investmentFees: [],
    });
    expect(data.categories).toBe(before.categories);
    expect(data.settings).toEqual(before.settings);
  });

  it('clearAllCategories smaže kategorie a odpojí je od položek, pravidel i výjimek', () => {
    const before = full();
    const { data } = clearAllCategories(before);
    expect(data.categories).toEqual([]);
    expect(data.transactions).toMatchObject([{ id: 't1', categoryId: null, subcategoryId: null }]);
    expect(data.recurringRules).toMatchObject([{ id: 'r1', categoryId: null, subcategoryId: null }]);
    expect(data.recurringExceptions).toMatchObject([{ id: 'exc', overrideCategoryId: null, overrideSubcategoryId: null }]);
    expect(data.accounts).toBe(before.accounts);
    expect(data.corrections).toBe(before.corrections);
  });

  it('původní data zůstanou beze změny', () => {
    const before = full();
    const snapshotJson = JSON.stringify(before);
    clearAllTransactions(before);
    clearAllAccounts(before);
    clearAllCategories(before);
    expect(JSON.stringify(before)).toBe(snapshotJson);
  });
});

describe('reset a ukázková data', () => {
  it('resetAllData vrátí kompletně prázdná data', () => {
    expect(resetAllData(full()).data).toEqual(createResetAppData());
  });

  it('replaceWithDemoData nahradí data ukázkovými a výchozími kategoriemi', () => {
    const demo = { accounts: [acc], recurringRules: [rule('demo_rule')], transactions: [tx('demo_tx', '2026-09-01', 1)] };
    const { data } = replaceWithDemoData(full(), demo);
    expect(data).toEqual({
      ...createResetAppData(),
      settings: { ...DEFAULT_SETTINGS },
      categories: [...DEFAULT_CATEGORIES],
      accounts: demo.accounts,
      recurringRules: demo.recurringRules,
      transactions: demo.transactions,
    });
    expect(data.accounts).not.toBe(demo.accounts);
  });
});

describe('nastavení a oprava dat', () => {
  it('updateSettings sloučí změněná nastavení s existujícími', () => {
    const { data } = updateSettings(full(), { budgetStartDay: 1 });
    expect(data.settings).toEqual({ ...DEFAULT_SETTINGS, budgetStartDay: 1 });
  });

  it('repairRecurringRules posune konec staré části rozštěpeného pravidla o den zpět', () => {
    const before = { ...full(), recurringRules: [rule('old', { endDate: '2026-06-15' }), rule('new', { startDate: '2026-06-15' })] };
    const { data, outcome } = repairRecurringRules(before);
    expect(outcome).toEqual({ fixedCount: 1 });
    expect(data.recurringRules.find(r => r.id === 'old')?.endDate).toBe('2026-06-14');
  });

  it('repairRecurringRules bez nálezu vrátí původní data', () => {
    const before = full();
    expect(repairRecurringRules(before)).toEqual({ data: before, outcome: { fixedCount: 0 } });
    expect(repairRecurringRules(before).data).toBe(before);
  });
});
