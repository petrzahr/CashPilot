import { Account, BudgetPeriod, MarketValueSnapshot, Transaction } from '../types/finance';
import { getEffectiveInvestedAmount } from './accountService';
import { addHaler, subHaler } from './currencyService';
import { getPreviousPeriod, getTodayInPrague } from './periodService';

export function latestInvestmentSnapshot(account: Account, snapshots: MarketValueSnapshot[], date: string) {
  return snapshots.filter(s => s.accountId === account.id && s.date >= account.initialBalanceDate && s.date <= date)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
}

/** Unknown legacy corrections stay unknown. Never infer them from today's account value. */
export function getHistoricalInvestmentCorrection(account: Account, snapshots: MarketValueSnapshot[], date: string): number | undefined {
  const snapshot = latestInvestmentSnapshot(account, snapshots, date);
  if (snapshot) return snapshot.investedAmountAdjustmentInHaler;
  const history = snapshots.filter(s => s.accountId === account.id);
  if (account.investmentCorrectionInitiallyZero || history.some(s => s.correctionPreviouslyZero) ||
      (!history.length && !account.marketValueHistoryManaged && account.investedAmountAdjustmentInHaler === undefined)) return 0;
  return undefined;
}

/** Carry captured capital with net contributions after the valuation, including forecast capital. */
export function getHistoricalInvestedAmount(account: Account, snapshots: MarketValueSnapshot[], transactions: Transaction[], date: string, base: number): number | undefined {
  if (date < account.initialBalanceDate) return 0;
  const snapshot = latestInvestmentSnapshot(account, snapshots, date);
  if (snapshot && Number.isSafeInteger(snapshot.effectiveInvestedAmountInHaler)) {
    const capturedBase = snapshot.baseInvestedAmountInHaler ?? getInvestedAmountAtValuation(
      { ...account, investedAmountAdjustmentInHaler: 0 }, transactions, snapshot.date);
    return addHaler(snapshot.effectiveInvestedAmountInHaler!, subHaler(base, capturedBase));
  }
  const correction = getHistoricalInvestmentCorrection(account, snapshots, date);
  return correction === undefined ? undefined : addHaler(base, correction);
}

/** Capture actual capital at valuation time, excluding future/planned contributions. */
export function getInvestedAmountAtValuation(account: Account, transactions: Transaction[], date: string): number {
  let principal = account.initialBalanceInHaler;
  for (const tx of transactions) {
    if (tx.type !== 'transfer' || tx.status !== 'executed' ||
        tx.date < account.initialBalanceDate || tx.date > date) continue;
    const amount = tx.actualAmountInHaler ?? tx.amountInHaler;
    if (tx.targetAccountId === account.id) principal = addHaler(principal, amount);
    if (tx.sourceAccountId === account.id) principal = subHaler(principal, amount);
  }
  return getEffectiveInvestedAmount(account, Math.max(0, principal));
}

/** Compare the same included accounts using their last known state at each period end.
 * Carry market value and captured capital together; never apply today's correction to history.
 * Later contributions do not change this unrealized gain/loss until another valuation.
 */
export function calculatePeriodInvestmentChange(
  accounts: Account[], snapshots: MarketValueSnapshot[], period: BudgetPeriod,
  startDay: number, today = getTodayInPrague(),
): number | null {
  const previous = getPreviousPeriod(period, startDay);
  const included = accounts.filter(a => a.status === 'active' && a.isNetWorth &&
    (a.type === 'investment' || a.type === 'pension') && a.initialBalanceDate <= period.endDate);
  if (!included.length || period.startDate > today) return null;
  let change = 0;
  for (const account of included) {
    const current = latestInvestmentSnapshot(account, snapshots, period.endDate < today ? period.endDate : today);
    const prior = latestInvestmentSnapshot(account, snapshots, previous.endDate < today ? previous.endDate : today);
    if (!current || !prior || !Number.isSafeInteger(current.effectiveInvestedAmountInHaler) ||
        !Number.isSafeInteger(prior.effectiveInvestedAmountInHaler)) return null;
    change = addHaler(change, subHaler(
      subHaler(current.marketValueInHaler, current.effectiveInvestedAmountInHaler!),
      subHaler(prior.marketValueInHaler, prior.effectiveInvestedAmountInHaler!),
    ));
  }
  return change;
}
