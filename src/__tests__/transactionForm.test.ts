import { describe, expect, it } from 'vitest';
import { createBudgetPeriod } from '../services/periodService';
import {
  TransactionFormData,
  TransactionFormMode,
  TransactionFormState,
  changeCategory,
  changeDate,
  changeType,
  createFormState,
  getAccountActivationErrors,
  getFormOptions,
  isSameForm,
  resetForAnother,
  setRecurring,
  toSaveAction,
  validateForm,
} from '../services/transactionForm';
import { Account, Category, RecurringRule, Transaction } from '../types/finance';

const account = (id: string, name: string, partial: Partial<Account> = {}): Account => ({
  id, name, type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01',
  isUsableCash: true, isNetWorth: true, color: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '', ...partial,
});

const category = (id: string, name: string, partial: Partial<Category> = {}): Category => ({
  id, name, type: 'expense', parentId: null, color: '', icon: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '', ...partial,
});

const tx = (partial: Partial<Transaction>): Transaction => ({
  id: 'tx', title: 'Nákup', type: 'expense', status: 'planned', date: '2026-09-25', sequence: 1,
  amountInHaler: 50000, sourceAccountId: 'chk', createdAt: '', updatedAt: '', ...partial,
} as Transaction);

const rentRule: RecurringRule = {
  id: 'rule_rent', title: 'Nájem', amountInHaler: 1500000, type: 'expense', frequency: 'monthly', dayOfMonth: 15,
  startDate: '2026-09-15', sourceAccountId: 'chk', isActive: true, createdAt: '', updatedAt: '',
};

const TODAY = '2026-09-20';
const period = createBudgetPeriod(2026, 9, 15);

const formData = (partial: Partial<TransactionFormData> = {}): TransactionFormData => ({
  transactions: [],
  recurringRules: [],
  recurringExceptions: [],
  accounts: [account('chk', 'Běžný', { isDefault: true }), account('sav', 'Spořicí')],
  categories: [],
  settings: { budgetStartDay: 15 },
  today: TODAY,
  ...partial,
});

const newMode = (partial: Partial<Extract<TransactionFormMode, { kind: 'new' }>> = {}): TransactionFormMode =>
  ({ kind: 'new', initialType: 'expense', period, ...partial });
const editMode = (transaction: Transaction): TransactionFormMode => ({ kind: 'edit', transaction, periodKey: period.key });

const filled = (form: TransactionFormState, patch: Partial<TransactionFormState> = {}): TransactionFormState =>
  ({ ...form, title: 'Nákup', amountStr: '120,50', ...patch });

describe('createFormState', () => {
  it('nová položka: dnešní datum v období, stav podle data, den opakování z data, výchozí účet', () => {
    const form = createFormState(newMode(), formData());
    expect(form).toMatchObject({
      date: TODAY, sequenceStr: '1', status: 'executed', dayOfMonth: 20, type: 'expense',
      sourceAccountId: 'chk', targetAccountId: '', categoryId: '', subcategoryId: '', title: '', amountStr: '',
      isRecurring: false, frequency: 'monthly', recurringEditMode: 'occurrence',
    });
    expect(createFormState(newMode({ initialDate: '2026-10-05' }), formData())).toMatchObject({ status: 'planned', dayOfMonth: 5 });
  });

  it('převod předvybere jen zdrojový účet', () => {
    expect(createFormState(newMode({ initialType: 'transfer' }), formData())).toMatchObject({ sourceAccountId: 'chk', targetAccountId: '' });
  });

  it('výchozí účet se nepředvybere, když je k datu ještě neaktivní nebo žádný výchozí není', () => {
    const late = formData({ accounts: [account('chk', 'Běžný', { isDefault: true, initialBalanceDate: '2026-10-01' })] });
    expect(createFormState(newMode(), late).sourceAccountId).toBe('');
    expect(createFormState(newMode({ initialDate: '2026-10-01' }), late).sourceAccountId).toBe('chk');

    const noDefault = formData({ accounts: [account('a', 'Air Bank'), account('b', 'Fio')] });
    expect(createFormState(newMode(), noDefault).sourceAccountId).toBe('');
  });

  it('pořadí nové položky počítá i s virtuálním výskytem opakující se platby', () => {
    const form = createFormState(newMode({ initialDate: '2026-10-15' }), formData({ recurringRules: [rentRule] }));
    expect(form.sequenceStr).toBe('2');
  });

  it('úprava převezme datum, pořadí, účet i kategorie položky beze změny výchozími hodnotami', () => {
    const existing = tx({
      id: 'tx_edit', date: '2026-08-25', sequence: 5, status: 'executed', actualAmountInHaler: 52000,
      sourceAccountId: 'sav', categoryId: 'food', subcategoryId: 'groceries', note: 'Účtenka',
    });
    expect(createFormState(editMode(existing), formData())).toMatchObject({
      date: '2026-08-25', sequenceStr: '5', status: 'executed', amountStr: '520', sourceAccountId: 'sav',
      categoryId: 'food', subcategoryId: 'groceries', note: 'Účtenka', dayOfMonth: 25, isRecurring: false,
    });
  });

  it('duplikace převezme údaje položky, ale datum a pořadí určí jako u nové', () => {
    const source = tx({ id: 'src', date: '2026-08-10', sequence: 4, title: 'Benzín', sourceAccountId: 'sav' });
    const form = createFormState({ kind: 'duplicate', source, period }, formData({ transactions: [tx({ id: 'other', date: TODAY })] }));
    expect(form).toMatchObject({ title: 'Benzín', sourceAccountId: 'sav', date: TODAY, sequenceStr: '2', status: 'executed' });
  });
});

describe('getFormOptions', () => {
  const categories = [
    category('zab', 'Zábava'), category('auto', 'Auto'), category('byd', 'Bydlení'),
    category('old', 'Archiv', { status: 'archived' }), category('mzda', 'Mzda', { type: 'income' }),
    category('servis', 'Servis', { parentId: 'auto' }), category('benzin', 'Benzín', { parentId: 'auto' }),
  ];
  const accounts = [account('s', 'Spořicí účet'), account('b', 'Běžný účet', { isDefault: true }), account('i', 'Investice', { status: 'archived' })];

  it('nová položka nabízí aktivní účty a kategorie typu A–Z, výchozí účet zůstává na svém místě', () => {
    const options = getFormOptions({ ...createFormState(newMode(), formData()), categoryId: 'auto' }, newMode(), { accounts, categories });
    expect(options.accounts.map(a => a.name)).toEqual(['Běžný účet', 'Spořicí účet']);
    expect(options.categories.map(c => c.name)).toEqual(['Auto', 'Bydlení', 'Zábava']);
    expect(options.subcategories.map(c => c.name)).toEqual(['Benzín', 'Servis']);
  });

  it('příjem nabízí jen příjmové kategorie, převod žádné', () => {
    const form = createFormState(newMode({ initialType: 'income' }), formData());
    expect(getFormOptions(form, newMode(), { accounts, categories }).categories.map(c => c.id)).toEqual(['mzda']);
    expect(getFormOptions({ ...form, type: 'transfer' }, newMode(), { accounts, categories }).categories).toEqual([]);
  });

  it('úprava ponechá právě vybraný archivovaný účet a kategorii', () => {
    const existing = tx({ sourceAccountId: 'i', categoryId: 'old' });
    const mode = editMode(existing);
    const options = getFormOptions(createFormState(mode, formData()), mode, { accounts, categories });
    expect(options.accounts.map(a => a.id)).toContain('i');
    expect(options.categories.map(c => c.id)).toContain('old');
  });
});

describe('přechody polí', () => {
  const data = formData({
    categories: [category('auto', 'Auto'), category('mzda', 'Mzda', { type: 'income' }), category('old', 'Archiv', { status: 'archived' })],
  });
  const base = createFormState(newMode(), data);

  it('změna kategorie vždy zruší podkategorii', () => {
    expect(changeCategory({ ...base, categoryId: 'auto', subcategoryId: 'benzin' }, 'mzda')).toMatchObject({ categoryId: 'mzda', subcategoryId: '' });
  });

  it('změna typu zruší kategorii jiného typu, archivovanou i u převodu; platnou ponechá', () => {
    const withCat = { ...base, categoryId: 'mzda', subcategoryId: 'x' };
    expect(changeType(withCat, 'expense', data.categories)).toMatchObject({ type: 'expense', categoryId: '', subcategoryId: '' });
    expect(changeType(withCat, 'income', data.categories)).toMatchObject({ categoryId: 'mzda', subcategoryId: 'x' });
    expect(changeType(withCat, 'transfer', data.categories)).toMatchObject({ categoryId: '', subcategoryId: '' });
    expect(changeType({ ...base, categoryId: 'old' }, 'expense', data.categories).categoryId).toBe('');
  });

  it('nová položka: datum přepočte den opakování, pořadí i stav; účet se nemaže', () => {
    const withTxs = formData({ transactions: [tx({ id: 'a', date: '2026-10-05' })] });
    const moved = changeDate(base, '2026-10-05', newMode(), withTxs);
    expect(moved).toMatchObject({ date: '2026-10-05', dayOfMonth: 5, sequenceStr: '2', status: 'planned', sourceAccountId: 'chk' });
    expect(changeDate(moved, '2026-10-31', newMode(), withTxs)).toMatchObject({ dayOfMonth: 31, sequenceStr: '1' });
  });

  it('úprava: nový den dá pořadí na konec dne bez sebe sama, návrat na původní den vrátí původní pořadí', () => {
    const existing = tx({ id: 'e', date: '2026-09-25', sequence: 3 });
    const mode = editMode(existing);
    const data2 = formData({ transactions: [existing, tx({ id: 'b', date: '2026-09-26' })] });
    const form = createFormState(mode, data2);
    const moved = changeDate(form, '2026-09-26', mode, data2);
    expect(moved).toMatchObject({ sequenceStr: '2', status: form.status, dayOfMonth: 26 });
    expect(changeDate(moved, '2026-09-25', mode, data2).sequenceStr).toBe('3');
  });

  it('úprava pravidelné položky nemění den opakování', () => {
    const occurrence = tx({ id: 'occ', date: '2026-09-15', recurringRuleId: rentRule.id });
    const mode = editMode(occurrence);
    const form = createFormState(mode, formData({ recurringRules: [rentRule] }));
    expect(changeDate(form, '2026-09-18', mode, formData({ recurringRules: [rentRule] })).dayOfMonth).toBe(15);
  });

  it('zapnutí opakování převezme den z data, ruční den zůstane', () => {
    const on = setRecurring({ ...base, date: '2026-09-27', dayOfMonth: 1 }, true);
    expect(on).toMatchObject({ isRecurring: true, dayOfMonth: 27 });
    expect(setRecurring({ ...on, dayOfMonth: 5 }, false)).toMatchObject({ isRecurring: false, dayOfMonth: 5 });
  });

  it('„Uložit a další“ vyprázdní název, částku a poznámku a posune pořadí', () => {
    const form = filled(base, { note: 'x', sequenceStr: '3', categoryId: 'auto' });
    expect(resetForAnother(form)).toMatchObject({ title: '', amountStr: '', note: '', sequenceStr: '4', categoryId: 'auto', date: base.date });
  });

  it('isSameForm porovnává všechna pole', () => {
    expect(isSameForm(base, { ...base })).toBe(true);
    expect(isSameForm(base, { ...base, recurringEditMode: 'series' })).toBe(false);
  });
});

describe('validateForm', () => {
  const accounts = [account('chk', 'Běžný'), account('late', 'Pozdní', { initialBalanceDate: '2026-10-01' })];
  const base = createFormState(newMode(), formData({ accounts }));
  const inactive = 'Tento účet je aktivní až od 1. 10. 2026. Zvolte stejné nebo pozdější datum.';

  it('prázdný formulář: název, částka a účet', () => {
    expect(validateForm(base, newMode(), accounts)).toEqual({
      title: 'Zadejte prosím název položky.',
      amount: 'Zadejte částku větší než 0.',
      source: 'Vyberte prosím účet.',
    });
  });

  it('účet aktivní až po datu položky (zdroj i cíl převodu)', () => {
    expect(validateForm(filled(base, { sourceAccountId: 'late' }), newMode(), accounts)).toEqual({ source: inactive });
    const transfer = filled(base, { type: 'transfer', sourceAccountId: 'chk', targetAccountId: 'late' });
    expect(validateForm(transfer, newMode(), accounts)).toEqual({ target: inactive });
    expect(getAccountActivationErrors(transfer, accounts)).toEqual({ source: null, target: inactive });
  });

  it('převod: cílový účet je povinný a jiný než zdrojový', () => {
    const transfer = filled(base, { type: 'transfer', sourceAccountId: 'chk' });
    expect(validateForm(transfer, newMode(), accounts).target).toBe('Pro převod vyberte cílový účet.');
    expect(validateForm({ ...transfer, targetAccountId: 'chk' }, newMode(), accounts).target)
      .toBe('Vyberte jiný účet, než ze kterého peníze odcházejí.');
  });

  it('konec opakování nesmí být před datem položky', () => {
    const recurring = filled(base, { sourceAccountId: 'chk', isRecurring: true, recurringEndDate: '2026-09-01' });
    expect(validateForm(recurring, newMode(), accounts)).toEqual({ endDate: 'Konec opakování musí být stejný den jako datum položky, nebo pozdější.' });
  });
});

describe('toSaveAction', () => {
  const data = formData();
  const base = filled(createFormState(newMode(), data), { categoryId: 'food' });

  it('nová položka: plánovaná částka, skutečná jen u provedené, prázdná podkategorie jako null', () => {
    expect(toSaveAction(base, newMode())).toEqual({
      kind: 'addTransaction',
      transaction: {
        title: 'Nákup', amountInHaler: 12050, plannedAmountInHaler: 12050, actualAmountInHaler: 12050, date: TODAY, sequence: 1,
        type: 'expense', sourceAccountId: 'chk', targetAccountId: undefined, categoryId: 'food', subcategoryId: null,
        status: 'executed', note: '',
      },
    });
    const planned = toSaveAction({ ...base, status: 'planned' }, newMode());
    expect(planned.kind === 'addTransaction' && planned.transaction.actualAmountInHaler).toBeUndefined();
  });

  it('převod nese cílový účet a žádnou kategorii', () => {
    const action = toSaveAction({ ...base, type: 'transfer', targetAccountId: 'sav' }, newMode());
    expect(action).toMatchObject({ kind: 'addTransaction', transaction: { targetAccountId: 'sav', categoryId: null, subcategoryId: null } });
  });

  it('nové opakování: ručně zvolený den, neplatný den spadne na den data; úprava běžné položky ji převezme', () => {
    const recurring = { ...base, isRecurring: true, dayOfMonth: 5, recurringEndDate: '' };
    expect(toSaveAction(recurring, newMode())).toEqual({
      kind: 'addRecurringRule',
      rule: {
        title: 'Nákup', amountInHaler: 12050, type: 'expense', frequency: 'monthly', dayOfMonth: 5, endDate: null,
        startDate: TODAY, sourceAccountId: 'chk', targetAccountId: undefined, categoryId: 'food', subcategoryId: null,
        note: '', isActive: true,
      },
      initialSequence: 1,
      initialStatus: 'executed',
      existingTransactionId: undefined,
    });
    expect(toSaveAction({ ...recurring, dayOfMonth: 0 }, newMode())).toMatchObject({ rule: { dayOfMonth: 20 } });

    const plain = tx({ id: 'plain' });
    expect(toSaveAction({ ...recurring }, editMode(plain))).toMatchObject({ kind: 'addRecurringRule', existingTransactionId: 'plain' });
  });

  it('úprava běžné položky: skutečná částka podle stavu, zrušená si drží původní', () => {
    const existing = tx({ id: 'e', status: 'cancelled', actualAmountInHaler: 40000, sequence: 2 });
    const form = filled(createFormState(editMode(existing), data));
    expect(toSaveAction(form, editMode(existing))).toEqual({
      kind: 'updateTransaction',
      transaction: { ...existing, title: 'Nákup', amountInHaler: 12050, actualAmountInHaler: 40000, categoryId: null, subcategoryId: null, note: '' },
    });
    expect(toSaveAction({ ...form, status: 'executed' }, editMode(existing))).toMatchObject({ transaction: { actualAmountInHaler: 12050 } });
    const planned = toSaveAction({ ...form, status: 'planned' }, editMode(existing));
    expect(planned.kind === 'updateTransaction' && planned.transaction.actualAmountInHaler).toBeUndefined();
  });

  describe('pravidelná položka', () => {
    const virtual = tx({ id: 'virtual_rule_rent_2026-09', date: '2026-09-15', sequence: 2, amountInHaler: 1500000, recurringRuleId: rentRule.id });
    const real = tx({ id: 'occ', date: '2026-09-15', sequence: 2, amountInHaler: 1500000, recurringRuleId: rentRule.id });
    const editForm = (occ: Transaction, patch: Partial<TransactionFormState> = {}) =>
      ({ ...createFormState(editMode(occ), formData({ recurringRules: [rentRule] })), ...patch });

    it('výskyt: virtuální se zhmotní s původní plánovanou částkou, reálný se upraví', () => {
      expect(toSaveAction(editForm(virtual, { amountStr: '16 000' }), editMode(virtual))).toMatchObject({
        kind: 'addTransaction',
        transaction: { amountInHaler: 1600000, plannedAmountInHaler: 1500000, recurringRuleId: rentRule.id, sequence: 2 },
      });
      expect(toSaveAction(editForm(real), editMode(real))).toMatchObject({ kind: 'updateTransaction', transaction: { id: 'occ' } });
    });

    it('série: datum a pozice jen při skutečné změně', () => {
      const unchanged = toSaveAction(editForm(virtual, { recurringEditMode: 'series' }), editMode(virtual));
      expect(unchanged).toEqual({
        kind: 'updateRecurringRule', ruleId: rentRule.id, mode: 'series', periodKey: period.key,
        overrideData: {
          title: 'Nákup', amountInHaler: 1500000, date: undefined, sourceAccountId: 'chk',
          targetAccountId: undefined, categoryId: null, subcategoryId: null, note: '',
        },
        originalTransactionId: virtual.id,
        placement: undefined,
      });

      const reordered = toSaveAction(editForm(virtual, { recurringEditMode: 'series', sequenceStr: '1' }), editMode(virtual));
      expect(reordered).toMatchObject({ overrideData: { date: undefined }, placement: { date: '2026-09-15', position: 1 } });

      const moved = toSaveAction(editForm(virtual, { recurringEditMode: 'series', date: '2026-09-18' }), editMode(virtual));
      expect(moved).toMatchObject({ overrideData: { date: '2026-09-18' }, placement: { date: '2026-09-18', position: 2 } });
    });

    it('tento a budoucí: datum se posílá vždy', () => {
      expect(toSaveAction(editForm(real, { recurringEditMode: 'future' }), editMode(real)))
        .toMatchObject({ kind: 'updateRecurringRule', mode: 'future', overrideData: { date: '2026-09-15' }, placement: undefined });
    });
  });
});
