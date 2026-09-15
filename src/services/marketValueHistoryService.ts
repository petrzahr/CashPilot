import type { AppData } from './storageService';
import type { MarketValueSnapshot } from '../types/finance';
import { getInvestedAmountAtValuation, latestInvestmentSnapshot } from './investmentPerformanceService';
import { addHaler } from './currencyService';
import { getTodayInPrague } from './periodService';

const chronological = (a: MarketValueSnapshot, b: MarketValueSnapshot) =>
  a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** Resolve persisted derived fields after local mutations and cloud conflict resolution. */
export function reconcileMarketValueHistory(data: AppData): AppData {
  let snapshots = data.marketValueSnapshots;
  const accounts = data.accounts.map(account => {
    if (!account.marketValueHistoryManaged) return account;
    let correction: number | undefined = account.investmentCorrectionInitiallyZero ? 0 : undefined;
    const resolved = new Map<string, MarketValueSnapshot>();
    for (const snapshot of snapshots.filter(s => s.accountId === account.id).sort(chronological)) {
      if (snapshot.correctionChanged !== false) correction = snapshot.investedAmountAdjustmentInHaler;
      const base = snapshot.baseInvestedAmountInHaler ?? getInvestedAmountAtValuation(
        { ...account, investedAmountAdjustmentInHaler: 0 }, data.transactions, snapshot.date);
      const effective = correction === undefined ? undefined : addHaler(base, correction);
      resolved.set(snapshot.id, snapshot.investedAmountAdjustmentInHaler === correction &&
        snapshot.effectiveInvestedAmountInHaler === effective ? snapshot : {
          ...snapshot, investedAmountAdjustmentInHaler: correction, effectiveInvestedAmountInHaler: effective,
        });
    }
    snapshots = snapshots.map(s => resolved.get(s.id) ?? s);
    const latest = latestInvestmentSnapshot(account, snapshots, getTodayInPrague());
    return { ...account, currentMarketValueInHaler: latest?.marketValueInHaler,
      marketValueUpdatedAt: latest?.date,
      investedAmountAdjustmentInHaler: latest?.investedAmountAdjustmentInHaler };
  });
  return { ...data, accounts, marketValueSnapshots: snapshots };
}

export type MarketValueEdit = Pick<MarketValueSnapshot, 'date' | 'marketValueInHaler' | 'investedAmountAdjustmentInHaler' | 'note'>;

/** Freeze existing transitions BEFORE changing the order or removing a state. */
export function mutateMarketValueHistory(data: AppData, id: string, edit?: MarketValueEdit): AppData {
  const target = data.marketValueSnapshots.find(s => s.id === id);
  const account = data.accounts.find(a => a.id === target?.accountId);
  if (!target || !account || !['investment', 'pension'].includes(account.type)) return data;
  if (edit && (!/^\d{4}-\d{2}-\d{2}$/.test(edit.date) || edit.date < account.initialBalanceDate ||
    !Number.isSafeInteger(edit.marketValueInHaler) ||
    (edit.investedAmountAdjustmentInHaler !== undefined && !Number.isSafeInteger(edit.investedAmountAdjustmentInHaler)))) return data;
  const history = data.marketValueSnapshots.filter(s => s.accountId === account.id).sort(chronological);
  const initiallyZero = account.investmentCorrectionInitiallyZero || history.some(s => s.correctionPreviouslyZero);
  let previous: number | undefined = initiallyZero ? 0 : undefined;
  const transitions = new Map(history.map(s => {
    const changed = s.correctionChanged ?? (s.investedAmountAdjustmentInHaler !== previous);
    previous = s.investedAmountAdjustmentInHaler;
    return [s.id, { ...s, correctionChanged: changed }];
  }));
  const now = new Date().toISOString();
  const snapshots = data.marketValueSnapshots.filter(s => edit || s.id !== id).map(s => {
    const state = transitions.get(s.id) ?? s;
    if (s.id !== id || !edit) return state;
    return { ...state, ...edit, updatedAt: now,
      correctionChanged: state.correctionChanged || edit.investedAmountAdjustmentInHaler !== s.investedAmountAdjustmentInHaler,
      baseInvestedAmountInHaler: getInvestedAmountAtValuation(
        { ...account, investedAmountAdjustmentInHaler: 0 }, data.transactions, edit.date) };
  });
  return reconcileMarketValueHistory({ ...data, marketValueSnapshots: snapshots,
    accounts: data.accounts.map(a => a.id === account.id ? { ...a, marketValueHistoryManaged: true,
      investmentCorrectionInitiallyZero: initiallyZero, updatedAt: now } : a) });
}
