import { describe, it, expect } from 'vitest';
import { createEmptyAppData } from '../constants/defaultData';
import { AppData } from '../services/storageService';
import {
  addAccount,
  addMarketValue,
  archiveAccount,
  deleteAccount,
  deleteInvestmentFee,
  deleteMarketValue,
  deleteStandaloneCorrection,
  editMarketValue,
  reconcileBalance,
  reorderAccounts,
  restoreAccount,
  restoreCorrection,
  restoreDeletedAccount,
  restoreInvestmentFees,
  restoreMarketValue,
  saveInvestmentFee,
  undoArchiveAccount,
  updateAccount,
  updateCorrectionNote,
} from '../services/accountCommands';
import { createCommandContext } from '../services/transactionCommands';
import { getAccountBalanceAtDate } from '../services/accountBalance';
import { Account, BalanceCorrection, InvestmentFee, MarketValueSnapshot, RecurringRule, Transaction } from '../types/finance';

const ctx = createCommandContext('2026-09-20', new Date('2026-09-20T12:00:00Z'));

const acc = (partial: Partial<Account>): Account => ({
  id: 'chk', name: 'Běžný', type: 'checking', currency: 'CZK', initialBalanceInHaler: 100000, initialBalanceDate: '2026-01-01',
  isUsableCash: true, isNetWorth: true, color: '#000000', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '', ...partial,
});
const checking = acc({ isDefault: true });
const investment = acc({ id: 'inv', name: 'Investice', type: 'investment', sortOrder: 2 });

const tx = (partial: Partial<Transaction>): Transaction => ({
  id: 'tx', title: 'Položka', type: 'expense', status: 'executed', date: '2026-09-20', sequence: 1,
  amountInHaler: 1000, sourceAccountId: 'chk', createdAt: '', updatedAt: '', ...partial,
} as Transaction);

const rule: RecurringRule = {
  id: 'rule', title: 'Nájem', amountInHaler: 1000, type: 'expense', frequency: 'monthly', dayOfMonth: 20,
  startDate: '2026-02-20', sourceAccountId: 'chk', isActive: true, createdAt: '', updatedAt: '',
};

const dataWith = (partial: Partial<AppData>): AppData => ({ ...createEmptyAppData(), accounts: [checking, investment], ...partial });

describe('účty', () => {
  it('nový výchozí účet zruší příznak u ostatních a zařadí se na konec pořadí', () => {
    const { data, outcome } = addAccount(dataWith({}), { ...acc({}), name: 'Nový', isDefault: true, sortOrder: 99 }, ctx);
    expect(outcome.account).toMatchObject({ name: 'Nový', isDefault: true, sortOrder: 3 });
    expect(data.accounts.filter(a => a.isDefault).map(a => a.id)).toEqual([outcome.account.id]);
  });

  it('úprava počátečního zůstatku investice bez ocenění se promítne do zůstatku účtu', () => {
    // AccountModal creates an investment with currentMarketValueInHaler = initial balance and no date
    const created = addAccount(dataWith({}), { ...investment, currentMarketValueInHaler: 100000 }, ctx);
    const edited = updateAccount(created.data, { ...created.outcome.account, initialBalanceInHaler: 250000 }, ctx);
    const account = edited.data.accounts.find(a => a.id === created.outcome.account.id)!;
    expect(getAccountBalanceAtDate(account, '2026-09-20', { transactions: [], snapshots: [] })).toBe(250000);
    expect(account.currentMarketValueInHaler).toBeUndefined();
  });

  it('úprava počátečního zůstatku nemaže skutečné ocenění investice', () => {
    const dated = { ...investment, currentMarketValueInHaler: 100000, marketValueUpdatedAt: '2026-09-01' };
    const undatedOther = { ...investment, id: 'inv2', currentMarketValueInHaler: 300000 };
    const data = dataWith({ accounts: [checking, dated, undatedOther] });
    const a = updateAccount(data, { ...dated, initialBalanceInHaler: 250000 }, ctx);
    const b = updateAccount(data, { ...undatedOther, initialBalanceInHaler: 250000 }, ctx);
    expect(a.data.accounts[1]).toMatchObject({ currentMarketValueInHaler: 100000, marketValueUpdatedAt: '2026-09-01' });
    expect(b.data.accounts[2].currentMarketValueInHaler).toBe(300000);
  });

  it('počáteční zůstatek nesmí začínat po prvním pohybu účtu', () => {
    const data = dataWith({ transactions: [tx({ date: '2026-03-01' })], recurringRules: [rule] });
    const late = updateAccount(data, { ...checking, initialBalanceDate: '2026-02-21' }, ctx);
    expect(late.data).toBe(data);
    expect(late.outcome).toMatchObject({ error: expect.stringContaining('20. 2. 2026') });

    const ok = updateAccount(data, { ...checking, initialBalanceDate: '2026-02-20', name: 'Hlavní' }, ctx);
    expect(ok.data.accounts[0]).toMatchObject({ name: 'Hlavní', initialBalanceDate: '2026-02-20', updatedAt: ctx.nowIso });
  });

  it('archivace: blokuje ji aktivní pravidlo, „Vrátit“ vrátí i výchozí příznak', () => {
    expect(archiveAccount(dataWith({ recurringRules: [rule] }), 'chk', ctx).outcome).toMatchObject({ error: expect.stringContaining('Nájem') });

    const { data, outcome } = archiveAccount(dataWith({}), 'chk', ctx);
    expect(data.accounts[0]).toMatchObject({ status: 'archived', isDefault: false });
    if (!('before' in outcome) || !outcome.before) throw new Error('expected before');

    const undone = undoArchiveAccount(data, outcome.before, ctx).data;
    expect(undone.accounts[0]).toMatchObject({ status: 'active', isDefault: true });
  });

  it('obnova z archivu vrátí účet jako nevýchozí', () => {
    const data = dataWith({ accounts: [{ ...checking, status: 'archived' }] });
    const { data: after, outcome } = restoreAccount(data, 'chk', ctx);
    expect(after.accounts[0]).toMatchObject({ status: 'active', isDefault: false });
    expect(outcome).toEqual({ name: 'Běžný' });
  });

  it('smazání účtu s historií se odmítne', () => {
    const data = dataWith({ transactions: [tx({ sourceAccountId: 'inv' })] });
    const result = deleteAccount(data, 'inv');
    expect(result.data).toBe(data);
    expect(result.outcome).toHaveProperty('error');
  });

  it('smazání účtu odstraní jeho ocenění, poplatky, výjimky a nastavení; „Vrátit“ vše vrátí jednou', () => {
    const snapshot: MarketValueSnapshot = { id: 's', accountId: 'inv', date: '2026-05-01', marketValueInHaler: 5000, createdAt: '2026-05-01T00:00:00Z' };
    const fee: InvestmentFee = { id: 'f', accountId: 'inv', periodKey: '2026-05', amountInHaler: 100, createdAt: '', updatedAt: '' };
    const data = dataWith({
      marketValueSnapshots: [snapshot],
      investmentFees: [fee],
      recurringExceptions: [{ id: 'ex', ruleId: 'other', periodKey: '2026-05', overrideTargetAccountId: 'inv', createdAt: '' }],
      settings: { ...createEmptyAppData().settings, accountUsableOverrides: { inv: true } },
    });
    const { data: after, outcome } = deleteAccount(data, 'inv');
    if (!('removed' in outcome) || !outcome.removed) throw new Error('expected removed');
    expect(after.accounts.map(a => a.id)).toEqual(['chk']);
    expect(after.marketValueSnapshots).toEqual([]);
    expect(after.investmentFees).toEqual([]);
    expect(after.recurringExceptions).toEqual([]);
    expect(after.settings.accountUsableOverrides).toEqual({});

    const restored = restoreDeletedAccount(after, outcome.removed, ctx).data;
    expect(restored.accounts.map(a => a.id)).toEqual(['chk', 'inv']);
    expect(restored.marketValueSnapshots.map(s => s.id)).toEqual(['s']);
    expect(restored.investmentFees.map(f => f.id)).toEqual(['f']);
    expect(restored.recurringExceptions.map(e => e.id)).toEqual(['ex']);
    expect(restored.settings.accountUsableOverrides).toEqual({ inv: true });
    expect(restoreDeletedAccount(restored, outcome.removed, ctx).data).toBe(restored);
  });
});

describe('korekce zůstatku', () => {
  it('uloží korekci i položku na konec dne s rozdílem proti vypočtenému stavu', () => {
    const { data, outcome } = reconcileBalance(
      dataWith({ transactions: [tx({ id: 'a', amountInHaler: 30000 })] }),
      { accountId: 'chk', actualBalanceInHaler: 50000, checkDate: '2026-09-20', note: '  výpis  ' },
      ctx
    );
    expect(outcome).toEqual({ kind: 'corrected', diffInHaler: -20000 });
    const corrTx = data.transactions.find(t => t.type === 'balance_adjustment')!;
    expect(corrTx).toMatchObject({ sequence: 2, amountInHaler: 20000, calculatedBalanceInHaler: 70000, note: 'výpis' });
    expect(data.corrections).toEqual([expect.objectContaining({ id: corrTx.id, diffInHaler: -20000 })]);
  });

  it('nulový rozdíl nic neukládá, neaktivní a investiční účet vrací upozornění', () => {
    const data = dataWith({});
    expect(reconcileBalance(data, { accountId: 'chk', actualBalanceInHaler: 100000, checkDate: '2026-09-20' }, ctx))
      .toEqual({ data, outcome: { kind: 'unchanged' } });
    expect(reconcileBalance(data, { accountId: 'chk', actualBalanceInHaler: 1, checkDate: '2025-12-31' }, ctx).outcome)
      .toMatchObject({ kind: 'warning', message: expect.stringContaining('aktivní až od') });
    expect(reconcileBalance(data, { accountId: 'inv', actualBalanceInHaler: 1, checkDate: '2026-09-20' }, ctx).outcome)
      .toMatchObject({ kind: 'warning', message: expect.stringContaining('tržní hodnota') });
  });

  it('poznámka se uloží u položky i u korekce; samostatnou korekci jde smazat a vrátit jednou', () => {
    const correction: BalanceCorrection = {
      id: 'c', accountId: 'chk', checkDate: '2026-09-01', actualBalanceInHaler: 0, calculatedBalanceInHaler: 0, diffInHaler: 5, createdAt: '',
    };
    const data = dataWith({ corrections: [correction], transactions: [tx({ id: 'c', type: 'balance_adjustment' })] });
    const noted = updateCorrectionNote(data, { id: 'c', note: 'Banka' }, ctx).data;
    expect(noted.transactions[0].note).toBe('Banka');
    expect(noted.corrections[0].note).toBe('Banka');

    const { data: deleted, outcome } = deleteStandaloneCorrection(dataWith({ corrections: [correction] }), 'c');
    expect(deleted.corrections).toEqual([]);
    const restored = restoreCorrection(deleted, outcome.deleted!, ctx).data;
    expect(restored.corrections.map(c => c.id)).toEqual(['c']);
    expect(restoreCorrection(restored, outcome.deleted!, ctx).data).toBe(restored);
  });
});

describe('tržní hodnoty', () => {
  it('odmítne běžný účet; aktuální hodnotu účtu změní jen nejnovější ocenění', () => {
    expect(addMarketValue(dataWith({}), { accountId: 'chk', marketValueInHaler: 1 }, ctx).outcome).toMatchObject({ kind: 'warning' });

    const latest = addMarketValue(dataWith({}), { accountId: 'inv', marketValueInHaler: 9000 }, ctx);
    expect(latest.outcome).toEqual({ kind: 'saved', accountType: 'investment' });
    expect(latest.data.accounts[1]).toMatchObject({ currentMarketValueInHaler: 9000, marketValueUpdatedAt: '2026-09-20' });

    const older = addMarketValue(latest.data, { accountId: 'inv', marketValueInHaler: 7000, date: '2026-06-01' }, ctx);
    expect(older.data.accounts[1]).toMatchObject({ currentMarketValueInHaler: 9000, marketValueUpdatedAt: '2026-09-20' });
    expect(older.data.marketValueSnapshots).toHaveLength(2);
  });

  it('smazané ocenění jde vrátit jednou', () => {
    const saved = addMarketValue(dataWith({}), { accountId: 'inv', marketValueInHaler: 9000 }, ctx).data;
    const id = saved.marketValueSnapshots[0].id;
    const { data: deleted, outcome } = deleteMarketValue(saved, id);
    expect(deleted.marketValueSnapshots).toEqual([]);
    const restored = restoreMarketValue(deleted, outcome.deleted!, ctx).data;
    expect(restored.marketValueSnapshots.map(s => s.id)).toEqual([id]);
    expect(restoreMarketValue(restored, outcome.deleted!, ctx).data).toBe(restored);
  });

  it('úprava ocenění přepočítá aktuální hodnotu účtu, neplatná úprava nic nezmění', () => {
    const saved = addMarketValue(dataWith({}), { accountId: 'inv', marketValueInHaler: 9000 }, ctx).data;
    const id = saved.marketValueSnapshots[0].id;
    const edited = editMarketValue(saved, { id, edit: { date: '2026-09-20', marketValueInHaler: 9500, note: 'opraveno' } }).data;
    expect(edited.marketValueSnapshots[0]).toMatchObject({ marketValueInHaler: 9500, note: 'opraveno' });
    expect(edited.accounts[1]).toMatchObject({ currentMarketValueInHaler: 9500 });

    expect(editMarketValue(saved, { id, edit: { date: '2025-12-31', marketValueInHaler: 1 } }).data).toBe(saved);
    expect(editMarketValue(saved, { id: 'missing', edit: { date: '2026-09-20', marketValueInHaler: 1 } }).data).toBe(saved);
  });
});

describe('pořadí účtů', () => {
  it('uloží zadané pořadí a účty mimo seznam zařadí za něj', () => {
    const third = acc({ id: 'sav', name: 'Spoření', sortOrder: 3 });
    const { data } = reorderAccounts(dataWith({ accounts: [checking, investment, third] }), ['sav', 'chk']);
    const order = [...data.accounts].sort((a, b) => a.sortOrder - b.sortOrder).map(a => a.id);
    expect(order).toEqual(['sav', 'chk', 'inv']);
  });
});

describe('poplatky', () => {
  it('nejvýše jeden poplatek za období, neplatná částka se odmítne', () => {
    const first = saveInvestmentFee(dataWith({}), { accountId: 'inv', periodKey: '2026-09', amountInHaler: 100 }, ctx).data;
    const second = saveInvestmentFee(first, { accountId: 'inv', periodKey: '2026-09', amountInHaler: 200, note: ' x ' }, ctx).data;
    expect(second.investmentFees).toEqual([expect.objectContaining({ amountInHaler: 200, note: 'x', id: first.investmentFees[0].id })]);
    expect(saveInvestmentFee(first, { accountId: 'inv', periodKey: '2026-09', amountInHaler: -1 }, ctx).outcome).toHaveProperty('error');
  });

  it('„Vrátit“ smazání jen když mezitím pro období nevznikl nový poplatek', () => {
    const saved = saveInvestmentFee(dataWith({}), { accountId: 'inv', periodKey: '2026-09', amountInHaler: 100 }, ctx).data;
    const { data: deleted, outcome } = deleteInvestmentFee(saved, saved.investmentFees[0].id);
    expect(deleted.investmentFees).toEqual([]);
    expect(restoreInvestmentFees(deleted, outcome.deleted, ctx).data.investmentFees).toHaveLength(1);

    const replaced = saveInvestmentFee(deleted, { accountId: 'inv', periodKey: '2026-09', amountInHaler: 300 }, ctx).data;
    expect(restoreInvestmentFees(replaced, outcome.deleted, ctx).data).toBe(replaced);
  });
});
