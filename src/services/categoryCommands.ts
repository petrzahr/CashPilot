import { Category } from '../types/finance';
import type { AppData } from './storageService';
import type { CommandContext, CommandResult } from './transactionCommands';
import { getCategoryUsage, isInUse } from './usageService';

/**
 * Příkazy nad kategoriemi. Stejně jako transactionCommands: čisté funkce
 * (data, vstup, ctx) → { data, outcome }; kontroly běží nad aktuálními daty.
 */

type NewCategory = Omit<Category, 'id' | 'createdAt' | 'updatedAt'>;

/** Vytvoří kategorii (hlavní nebo podkategorii podle parentId). */
export function addCategory(data: AppData, catData: NewCategory, ctx: CommandContext): CommandResult<{ category: Category }> {
  const category: Category = { ...catData, id: ctx.newId('cat'), createdAt: ctx.nowIso, updatedAt: ctx.nowIso };
  return { data: { ...data, categories: [...data.categories, category] }, outcome: { category } };
}

/** Vytvoří hlavní kategorii: parentId je vždy null, ani podvržený vstup nevytvoří podkategorii. */
export function addMainCategory(data: AppData, catData: NewCategory, ctx: CommandContext): CommandResult<{ category: Category }> {
  return addCategory(data, { ...catData, parentId: null }, ctx);
}

/** Upraví kategorii; změna barvy hlavní kategorie se propíše do všech jejích podkategorií. */
export function updateCategory(data: AppData, cat: Category, ctx: CommandContext): CommandResult<null> {
  const original = data.categories.find(c => c.id === cat.id);
  const propagateColor = !cat.parentId && !!original && original.color !== cat.color;
  return {
    data: {
      ...data,
      categories: data.categories.map(c => {
        if (c.id === cat.id) return { ...cat, updatedAt: ctx.nowIso };
        if (propagateColor && c.parentId === cat.id) return { ...c, color: cat.color, updatedAt: ctx.nowIso };
        return c;
      }),
    },
    outcome: null,
  };
}

/** Přesune podkategorii pod jinou hlavní kategorii; s updateHistorical i u existujících položek. */
export function moveSubcategory(
  data: AppData,
  input: { subcategoryId: string; newParentId: string; updateHistorical: boolean },
  ctx: CommandContext
): CommandResult<{ subName?: string; parentName?: string }> {
  const { subcategoryId, newParentId, updateHistorical } = input;
  return {
    data: {
      ...data,
      categories: data.categories.map(c => c.id === subcategoryId ? { ...c, parentId: newParentId, updatedAt: ctx.nowIso } : c),
      transactions: updateHistorical
        ? data.transactions.map(t => t.subcategoryId === subcategoryId ? { ...t, categoryId: newParentId, updatedAt: ctx.nowIso } : t)
        : data.transactions,
    },
    outcome: {
      subName: data.categories.find(c => c.id === subcategoryId)?.name,
      parentName: data.categories.find(c => c.id === newParentId)?.name,
    },
  };
}

/**
 * Archivuje kategorii i její podkategorie. outcome.affectedIds jsou jen ty, které archivace
 * skutečně skryla - „Vrátit“ dřív archivované podkategorie nechá archivované.
 */
export function archiveCategory(data: AppData, id: string, ctx: CommandContext): CommandResult<{ name?: string; affectedIds: string[] }> {
  const inScope = (c: Category) => c.id === id || c.parentId === id;
  return {
    data: {
      ...data,
      categories: data.categories.map(c => inScope(c) ? { ...c, status: 'archived', updatedAt: ctx.nowIso } : c),
    },
    outcome: {
      name: data.categories.find(c => c.id === id)?.name,
      affectedIds: data.categories.filter(c => inScope(c) && c.status !== 'archived').map(c => c.id),
    },
  };
}

/** „Vrátit“ archivaci: znovu aktivuje jen kategorie, které archivace skryla. */
export function undoArchiveCategory(data: AppData, affectedIds: string[], ctx: CommandContext): CommandResult<null> {
  const ids = new Set(affectedIds);
  return {
    data: { ...data, categories: data.categories.map(c => ids.has(c.id) ? { ...c, status: 'active', updatedAt: ctx.nowIso } : c) },
    outcome: null,
  };
}

/** Obnoví kategorii z archivu i s jejími podkategoriemi. */
export function restoreCategory(data: AppData, id: string, ctx: CommandContext): CommandResult<{ name?: string }> {
  return {
    data: {
      ...data,
      categories: data.categories.map(c => (c.id === id || c.parentId === id) ? { ...c, status: 'active', updatedAt: ctx.nowIso } : c),
    },
    outcome: { name: data.categories.find(c => c.id === id)?.name },
  };
}

export const CATEGORY_IN_USE_MESSAGE =
  'Kategorii používají položky nebo pravidelné položky, a proto ji nejde smazat. Můžete ji archivovat – zmizí z nabídek, ale historie zůstane.';

/**
 * Smaže kategorii i s podkategoriemi. Kategorii, kterou (včetně podkategorií) používají
 * položky nebo pravidelné položky, smazat nejde. outcome.removed slouží pro „Vrátit“.
 */
export function deleteCategory(data: AppData, id: string): CommandResult<{ error: string } | { name?: string; removed: Category[] }> {
  if (isInUse(getCategoryUsage(id, data.categories, data.transactions, data.recurringRules))) {
    return { data, outcome: { error: CATEGORY_IN_USE_MESSAGE } };
  }
  const removed = data.categories.filter(c => c.id === id || c.parentId === id);
  return {
    data: { ...data, categories: data.categories.filter(c => c.id !== id && c.parentId !== id) },
    outcome: { name: removed.find(c => c.id === id)?.name, removed },
  };
}

/** „Vrátit“ smazání kategorie: vrátí ji i s podkategoriemi; opakované vrácení nic nezdvojí. */
export function restoreDeletedCategories(data: AppData, removed: Category[], ctx: CommandContext): CommandResult<null> {
  const ids = new Set(removed.map(c => c.id));
  if (ids.size === 0 || data.categories.some(c => ids.has(c.id))) return { data, outcome: null };
  return {
    data: { ...data, categories: [...data.categories, ...removed.map(c => ({ ...c, updatedAt: ctx.nowIso }))] },
    outcome: null,
  };
}
