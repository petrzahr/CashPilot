import { Account, Category, Transaction } from '../types/finance';
import { getEffectiveAmountInHaler } from './accountScope';
import { formatCurrency } from './currencyService';
import { getCorrectionDiffInHaler } from './itemFilter';

/**
 * Model řádku položky ve výpisech (Rozpočet, Všechny položky, historie účtu): příznaky,
 * znaménková částka s tónem, popisek kategorie a účtů. Bez Reactu, JSX staví ItemRowParts.
 */

export type ItemAmountTone = 'positive' | 'negative' | 'neutral';

export interface ItemRowAmount {
  /** Znaménko před částkou; korekce místo něj nese znaménko rozdílu (showPlus). */
  sign: '+' | '−' | '';
  /** Absolutní částka, u korekce znaménkový rozdíl. */
  valueInHaler: number;
  isCorrectionDiff: boolean;
  tone: ItemAmountTone;
}

export type ItemRowCategory =
  | { kind: 'correction'; label: 'Korekce zůstatku' }
  | { kind: 'category'; name: string; subName: string | null; color: string }
  | { kind: 'transfer'; label: 'Převod' }
  | { kind: 'none'; label: 'Bez kategorie' };

export interface ItemRowConflict {
  reason: string;
}

export interface ItemRow {
  isCancelled: boolean;
  isCorrection: boolean;
  isRecurring: boolean;
  conflict: ItemRowConflict | null;
  amount: ItemRowAmount;
  category: ItemRowCategory;
  sourceAccountName: string | null;
  targetAccountName: string | null;
}

export interface ItemRowContext {
  accounts: Account[];
  categories: Category[];
  conflicts?: { transaction: Transaction; reason: string }[];
  /** Účet, z jehož pohledu se znaménkuje převod (historie účtu): příchozí +, odchozí −. */
  perspectiveAccountId?: string;
}

export function getItemRowAmount(tx: Transaction, perspectiveAccountId?: string): ItemRowAmount {
  if (tx.type === 'balance_adjustment') {
    const diff = getCorrectionDiffInHaler(tx);
    return { sign: '', valueInHaler: diff, isCorrectionDiff: true, tone: diff >= 0 ? 'positive' : 'negative' };
  }
  const valueInHaler = getEffectiveAmountInHaler(tx);
  if (tx.type === 'income') return { sign: '+', valueInHaler, isCorrectionDiff: false, tone: 'positive' };
  if (tx.type === 'expense') return { sign: '−', valueInHaler, isCorrectionDiff: false, tone: 'negative' };
  const sign = perspectiveAccountId === undefined
    ? ''
    : tx.targetAccountId === perspectiveAccountId ? '+' : tx.sourceAccountId === perspectiveAccountId ? '−' : '';
  return { sign, valueInHaler, isCorrectionDiff: false, tone: 'neutral' };
}

/** Text částky: korekce jako znaménkový rozdíl, ostatní jako znaménko + částka. */
export function formatItemAmount(amount: ItemRowAmount): string {
  return amount.isCorrectionDiff
    ? formatCurrency(amount.valueInHaler, { showPlus: true })
    : `${amount.sign}${formatCurrency(amount.valueInHaler)}`;
}

export function getItemRowCategory(tx: Transaction, categories: Category[]): ItemRowCategory {
  if (tx.type === 'balance_adjustment') return { kind: 'correction', label: 'Korekce zůstatku' };
  const cat = categories.find(c => c.id === tx.categoryId);
  if (cat) {
    const subCat = categories.find(c => c.id === tx.subcategoryId);
    return { kind: 'category', name: cat.name, subName: subCat?.name ?? null, color: cat.color };
  }
  if (tx.type === 'transfer') return { kind: 'transfer', label: 'Převod' };
  return { kind: 'none', label: 'Bez kategorie' };
}

/** Kategorie na jeden řádek: „Kategorie › Podkategorie“. */
export function formatCategoryPath(category: Extract<ItemRowCategory, { kind: 'category' }>): string {
  return category.subName ? `${category.name} › ${category.subName}` : category.name;
}

/** Účty na jeden řádek: „Zdroj → Cíl“, bez zdrojového účtu null. */
export function formatAccountPath(row: Pick<ItemRow, 'sourceAccountName' | 'targetAccountName'>): string | null {
  if (!row.sourceAccountName) return null;
  return row.targetAccountName ? `${row.sourceAccountName} → ${row.targetAccountName}` : row.sourceAccountName;
}

export function buildItemRow(tx: Transaction, ctx: ItemRowContext): ItemRow {
  const sourceAcc = ctx.accounts.find(a => a.id === tx.sourceAccountId);
  const targetAcc = tx.targetAccountId ? ctx.accounts.find(a => a.id === tx.targetAccountId) : undefined;
  const conflict = ctx.conflicts?.find(c => c.transaction.id === tx.id);

  return {
    isCancelled: tx.status === 'cancelled',
    isCorrection: tx.type === 'balance_adjustment',
    isRecurring: Boolean(tx.recurringRuleId),
    conflict: conflict ? { reason: conflict.reason } : null,
    amount: getItemRowAmount(tx, ctx.perspectiveAccountId),
    category: getItemRowCategory(tx, ctx.categories),
    sourceAccountName: sourceAcc?.name ?? null,
    // Cílový účet bez zdrojového se nezobrazuje
    targetAccountName: sourceAcc && targetAcc ? targetAcc.name : null,
  };
}
