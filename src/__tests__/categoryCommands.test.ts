import { describe, it, expect } from 'vitest';
import { createEmptyAppData } from '../constants/defaultData';
import { AppData } from '../services/storageService';
import {
  CATEGORY_IN_USE_MESSAGE,
  addCategory,
  addMainCategory,
  archiveCategory,
  deleteCategory,
  moveSubcategory,
  restoreCategory,
  restoreDeletedCategories,
  undoArchiveCategory,
  updateCategory,
} from '../services/categoryCommands';
import { createCommandContext } from '../services/transactionCommands';
import { Category, RecurringRule, Transaction } from '../types/finance';

const ctx = createCommandContext('2026-09-20', new Date('2026-09-20T12:00:00Z'));

const cat = (id: string, parentId: string | null = null, partial: Partial<Category> = {}): Category => ({
  id, name: id, type: 'expense', parentId, color: '#111111', icon: '', sortOrder: 1, status: 'active',
  createdAt: '', updatedAt: '', ...partial,
});

const housing = cat('housing');
const rent = cat('rent', 'housing', { color: '#222222' });
const energy = cat('energy', 'housing', { status: 'archived' });
const car = cat('car');

const tx = (partial: Partial<Transaction>): Transaction => ({
  id: 'tx', title: 'Položka', type: 'expense', status: 'executed', date: '2026-09-20', sequence: 1,
  amountInHaler: 1000, sourceAccountId: 'chk', createdAt: '', updatedAt: '', ...partial,
} as Transaction);

const dataWith = (partial: Partial<AppData> = {}): AppData => ({
  ...createEmptyAppData(), categories: [housing, rent, energy, car], ...partial,
});

describe('vytvoření kategorie', () => {
  it('hlavní kategorie má vždy parentId = null, podkategorie si ho ponechá', () => {
    const main = addMainCategory(dataWith(), { ...cat('x', 'housing'), name: 'Nová' }, ctx);
    expect(main.outcome.category).toMatchObject({ name: 'Nová', parentId: null, createdAt: ctx.nowIso });
    expect(main.data.categories).toHaveLength(5);

    const sub = addCategory(dataWith(), { ...cat('x', 'housing'), name: 'Pod' }, ctx);
    expect(sub.outcome.category.parentId).toBe('housing');
  });
});

describe('úprava a přesun', () => {
  it('změna barvy hlavní kategorie se propíše do podkategorií, barva podkategorie ne', () => {
    const recolored = updateCategory(dataWith(), { ...housing, color: '#abcdef' }, ctx).data;
    expect(recolored.categories.filter(c => c.id === 'housing' || c.parentId === 'housing').map(c => c.color))
      .toEqual(['#abcdef', '#abcdef', '#abcdef']);

    const subOnly = updateCategory(dataWith(), { ...rent, color: '#000000' }, ctx).data;
    expect(subOnly.categories.find(c => c.id === 'housing')!.color).toBe('#111111');
    expect(subOnly.categories.find(c => c.id === 'energy')!.color).toBe('#111111');
  });

  it('přesun podkategorie přepíše hlavní kategorii u položek jen s updateHistorical', () => {
    const data = dataWith({ transactions: [tx({ categoryId: 'housing', subcategoryId: 'rent' })] });
    const kept = moveSubcategory(data, { subcategoryId: 'rent', newParentId: 'car', updateHistorical: false }, ctx);
    expect(kept.data.categories.find(c => c.id === 'rent')!.parentId).toBe('car');
    expect(kept.data.transactions[0].categoryId).toBe('housing');
    expect(kept.outcome).toEqual({ subName: 'rent', parentName: 'car' });

    const moved = moveSubcategory(data, { subcategoryId: 'rent', newParentId: 'car', updateHistorical: true }, ctx).data;
    expect(moved.transactions[0].categoryId).toBe('car');
  });
});

describe('archivace', () => {
  it('„Vrátit“ obnoví jen kategorie skryté archivací, dřív archivovaná podkategorie zůstane archivovaná', () => {
    const { data, outcome } = archiveCategory(dataWith(), 'housing', ctx);
    expect(data.categories.filter(c => c.status === 'archived').map(c => c.id)).toEqual(['housing', 'rent', 'energy']);
    expect(outcome).toEqual({ name: 'housing', affectedIds: ['housing', 'rent'] });

    const undone = undoArchiveCategory(data, outcome.affectedIds, ctx).data;
    expect(undone.categories.map(c => [c.id, c.status])).toEqual([
      ['housing', 'active'], ['rent', 'active'], ['energy', 'archived'], ['car', 'active'],
    ]);
  });

  it('obnova z archivu aktivuje kategorii i všechny podkategorie', () => {
    const archived = archiveCategory(dataWith(), 'housing', ctx).data;
    const { data, outcome } = restoreCategory(archived, 'housing', ctx);
    expect(data.categories.filter(c => c.id !== 'car').every(c => c.status === 'active')).toBe(true);
    expect(outcome).toEqual({ name: 'housing' });
  });
});

describe('smazání', () => {
  const rule: RecurringRule = {
    id: 'r', title: 'Nájem', amountInHaler: 1, type: 'expense', frequency: 'monthly', dayOfMonth: 1,
    startDate: '2026-01-01', sourceAccountId: 'chk', isActive: true, subcategoryId: 'rent', createdAt: '', updatedAt: '',
  };

  it('kategorii, jejíž podkategorii používá položka nebo pravidlo, nejde smazat', () => {
    const withTx = dataWith({ transactions: [tx({ categoryId: 'housing', subcategoryId: 'rent' })] });
    expect(deleteCategory(withTx, 'housing')).toEqual({ data: withTx, outcome: { error: CATEGORY_IN_USE_MESSAGE } });

    const withRule = dataWith({ recurringRules: [rule] });
    expect(deleteCategory(withRule, 'housing').outcome).toEqual({ error: CATEGORY_IN_USE_MESSAGE });
  });

  it('smaže kategorii i s podkategoriemi; „Vrátit“ je vrátí jednou', () => {
    const { data, outcome } = deleteCategory(dataWith(), 'housing');
    expect(data.categories.map(c => c.id)).toEqual(['car']);
    if ('error' in outcome) throw new Error('expected removal');
    expect(outcome.removed.map(c => c.id)).toEqual(['housing', 'rent', 'energy']);

    const restored = restoreDeletedCategories(data, outcome.removed, ctx).data;
    expect(restored.categories.map(c => c.id)).toEqual(['car', 'housing', 'rent', 'energy']);
    expect(restoreDeletedCategories(restored, outcome.removed, ctx).data).toBe(restored);
  });
});
