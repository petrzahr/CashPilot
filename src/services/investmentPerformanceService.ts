import { Account, BudgetPeriod, InvestmentFee, MarketValueSnapshot, Transaction } from '../types/finance';
import { getAssetFlowInHaler } from './accountService';
import { addHaler, subHaler } from './currencyService';
import { getPeriodForDate, getPreviousPeriod, getTodayInPrague } from './periodService';

export function latestInvestmentSnapshot(account: Account, snapshots: MarketValueSnapshot[], date: string) {
  return snapshots.filter(s => s.accountId === account.id && s.date >= account.initialBalanceDate && s.date <= date)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
}

/** One fee per account and period; a sync collision keeps the most recently updated record. */
export function getAccountFees(fees: InvestmentFee[], accountId: string): InvestmentFee[] {
  const byPeriod = new Map<string, InvestmentFee>();
  for (const fee of fees) {
    if (fee.accountId !== accountId) continue;
    const old = byPeriod.get(fee.periodKey);
    const stamp = (f: InvestmentFee) => `${f.updatedAt || f.createdAt}|${f.id}`;
    if (!old || stamp(fee) > stamp(old)) byPeriod.set(fee.periodKey, fee);
  }
  return [...byPeriod.values()].sort((a, b) => a.periodKey.localeCompare(b.periodKey));
}

/** Fees of the given period and all earlier ones. */
export function getFeesUpToPeriod(fees: InvestmentFee[], accountId: string, periodKey: string): number {
  return getAccountFees(fees, accountId)
    .filter(f => f.periodKey <= periodKey)
    .reduce((sum, f) => addHaler(sum, f.amountInHaler), 0);
}

export function getFeesUpToDate(fees: InvestmentFee[], accountId: string, date: string, startDay: number): number {
  return getFeesUpToPeriod(fees, accountId, getPeriodForDate(date, startDay).key);
}

/** Net executed contributions up to the date, excluding future/planned ones. */
export function getInvestedAmountAtValuation(account: Account, transactions: Transaction[], date: string): number {
  let principal = account.initialBalanceInHaler;
  for (const tx of transactions) {
    if (tx.status !== 'executed' || tx.date < account.initialBalanceDate || tx.date > date) continue;
    principal = addHaler(principal, getAssetFlowInHaler(tx, account.id, tx.actualAmountInHaler ?? tx.amountInHaler));
  }
  return Math.max(0, principal);
}

/** Compare each included account using its last valuation at each period end.
 * Gain is after fees (market value − contributions), so it reconciles with the net worth change.
 * Later contributions do not change this unrealized gain/loss until another valuation.
 * Accounts without a valuation at both ends are skipped, not treated as blocking the rest.
 */
export function calculatePeriodInvestmentChange(
  accounts: Account[], snapshots: MarketValueSnapshot[], period: BudgetPeriod,
  startDay: number, today = getTodayInPrague(), transactions: Transaction[] = [],
): number | null {
  const previous = getPreviousPeriod(period, startDay);
  const included = accounts.filter(a => a.status === 'active' && a.isNetWorth &&
    (a.type === 'investment' || a.type === 'pension') && a.initialBalanceDate <= period.endDate);
  if (!included.length || period.startDate > today) return null;
  let change = 0;
  let counted = 0;
  for (const account of included) {
    const current = latestInvestmentSnapshot(account, snapshots, period.endDate < today ? period.endDate : today);
    const prior = latestInvestmentSnapshot(account, snapshots, previous.endDate < today ? previous.endDate : today);
    if (!current || !prior) continue;
    counted++;
    const gain = (s: MarketValueSnapshot) =>
      subHaler(s.marketValueInHaler, getInvestedAmountAtValuation(account, transactions, s.date));
    change = addHaler(change, subHaler(gain(current), gain(prior)));
  }
  return counted ? change : null;
}
