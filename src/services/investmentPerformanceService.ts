import { Account, BudgetPeriod, MarketValueSnapshot, Transaction } from '../types/finance';
import { getEffectiveInvestedAmount } from './accountService';
import { addHaler, subHaler } from './currencyService';
import { getPreviousPeriod, getTodayInPrague, isDateInPeriod } from './periodService';

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

/** Compare the same included accounts, requiring a fresh, complete valuation in both periods.
 * Never carry valuations forward or apply today's correction to legacy snapshots.
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
    const history = snapshots.filter(s => s.accountId === account.id &&
      s.date >= account.initialBalanceDate && s.date <= today)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    const current = history.find(s => isDateInPeriod(s.date, period));
    const prior = history.find(s => isDateInPeriod(s.date, previous));
    if (!current || !prior || !Number.isSafeInteger(current.effectiveInvestedAmountInHaler) ||
        !Number.isSafeInteger(prior.effectiveInvestedAmountInHaler)) return null;
    change = addHaler(change, subHaler(
      subHaler(current.marketValueInHaler, current.effectiveInvestedAmountInHaler!),
      subHaler(prior.marketValueInHaler, prior.effectiveInvestedAmountInHaler!),
    ));
  }
  return change;
}
