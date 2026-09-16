import { Account, MarketValueSnapshot, PeriodSummary, Transaction } from '../types/finance';
import { computeAssetAccountBalanceAtDate } from './analyticsEngine';
import { getPreviousDayString } from './periodService';
import { subHaler } from './currencyService';

/** Period account totals using recorded asset valuations, as in the account breakdown. */
export function getAccountPeriodSummary(
  summary: PeriodSummary,
  accounts: Account[],
  transactions: Transaction[],
  marketValueSnapshots: MarketValueSnapshot[],
): PeriodSummary {
  const result = { ...summary, accountBalances: { ...summary.accountBalances } };
  const openingDate = getPreviousDayString(summary.period.startDate);
  for (const acc of accounts) {
    if (acc.type !== 'investment' && acc.type !== 'pension') continue;
    const original = summary.accountBalances[acc.id];
    if (!original) continue;
    const opening = computeAssetAccountBalanceAtDate(acc, openingDate, transactions, marketValueSnapshots);
    const closing = computeAssetAccountBalanceAtDate(acc, summary.period.endDate, transactions, marketValueSnapshots);
    result.accountBalances[acc.id] = {
      ...original, openingBalanceInHaler: opening, closingBalanceInHaler: closing,
    };
    result.openingBalanceInHaler += opening - original.openingBalanceInHaler;
    result.closingBalanceInHaler += closing - original.closingBalanceInHaler;
    if (acc.isNetWorth) {
      result.netWorthOpeningInHaler += opening - original.openingBalanceInHaler;
      result.netWorthClosingInHaler += closing - original.closingBalanceInHaler;
    }
  }
  result.netChangeInHaler = subHaler(result.closingBalanceInHaler, result.openingBalanceInHaler);
  return result;
}
