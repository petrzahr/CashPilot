import type { AppData } from './storageService';
import type { Account, MarketValueSnapshot } from '../types/finance';
import { latestInvestmentSnapshot } from './investmentPerformanceService';
import { getTodayInPrague } from './periodService';

// Removed invested-amount correction model; broker fees replaced it.
const LEGACY_ACCOUNT_FIELDS = ['investedAmountAdjustmentInHaler', 'investmentCorrectionInitiallyZero'];
const LEGACY_SNAPSHOT_FIELDS = ['investedAmountAdjustmentInHaler', 'effectiveInvestedAmountInHaler',
  'baseInvestedAmountInHaler', 'correctionChanged', 'correctionPreviouslyZero'];

function stripFields<T extends object>(entity: T, fields: string[]): T {
  if (!fields.some(f => f in entity)) return entity;
  const copy = { ...entity } as Record<string, unknown>;
  for (const f of fields) delete copy[f];
  return copy as unknown as T;
}

/** Resolve persisted derived fields after local mutations and cloud conflict resolution. */
export function reconcileMarketValueHistory(data: AppData): AppData {
  const snapshots = data.marketValueSnapshots.map(s => stripFields(s, LEGACY_SNAPSHOT_FIELDS));
  const accounts = data.accounts.map(original => {
    const account: Account = stripFields(original, LEGACY_ACCOUNT_FIELDS);
    if (!account.marketValueHistoryManaged) return account;
    const latest = latestInvestmentSnapshot(account, snapshots, getTodayInPrague());
    if (account.currentMarketValueInHaler === latest?.marketValueInHaler &&
      account.marketValueUpdatedAt === latest?.date) return account;
    return { ...account, currentMarketValueInHaler: latest?.marketValueInHaler, marketValueUpdatedAt: latest?.date };
  });
  return { ...data, accounts, marketValueSnapshots: snapshots };
}

export type MarketValueEdit = Pick<MarketValueSnapshot, 'date' | 'marketValueInHaler' | 'note'>;

/** Edit (or delete without `edit`) a valuation and rebuild the account's current value from history. */
export function mutateMarketValueHistory(data: AppData, id: string, edit?: MarketValueEdit): AppData {
  const target = data.marketValueSnapshots.find(s => s.id === id);
  const account = data.accounts.find(a => a.id === target?.accountId);
  if (!target || !account || !['investment', 'pension'].includes(account.type)) return data;
  if (edit && (!/^\d{4}-\d{2}-\d{2}$/.test(edit.date) || edit.date < account.initialBalanceDate ||
    !Number.isSafeInteger(edit.marketValueInHaler))) return data;
  const now = new Date().toISOString();
  const snapshots = data.marketValueSnapshots
    .filter(s => edit || s.id !== id)
    .map(s => s.id === id && edit ? { ...s, ...edit, updatedAt: now } : s);
  return reconcileMarketValueHistory({ ...data, marketValueSnapshots: snapshots,
    accounts: data.accounts.map(a => a.id === account.id ? { ...a, marketValueHistoryManaged: true, updatedAt: now } : a) });
}
