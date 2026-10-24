import { describe, expect, it } from 'vitest';
import { calculateForecast, ForecastData, getEffectiveTransactionsForPeriod } from '../services/financialEngine';
import { getAccountPeriodSummary } from '../services/accountSummaryService';
import { getDefaultAccountPeriodTotals, getOverdraftLimitInHaler } from '../services/budgetBalances';
import { calculateDefaultAccountKpis } from '../services/budgetKpiService';
import { getDefaultAccount } from '../services/accountScope';
import { createEmptyAppData } from '../services/demoData';
import { DEMO_ACCOUNTS, DEMO_RECURRING_RULES, DEMO_TRANSACTIONS } from '../fixtures/demoData';
import { ForecastResult } from '../types/finance';

/**
 * Characterization: pins the values the Budget tiles and KPIs, the Overview rows and the
 * Accounts summary show for the demo data. Only the adapters below may change in a refactor.
 */
const today = '2026-10-24';
const base = createEmptyAppData();
const data: ForecastData = {
  ...base,
  accounts: DEMO_ACCOUNTS,
  recurringRules: DEMO_RECURRING_RULES,
  transactions: DEMO_TRANSACTIONS,
};
const forecast = calculateForecast(data, { today });

// 2026-08 holds the accounts' activation date (after its first day), 2026-10 is current, 2027-02 is future
const BUDGET_KEYS = ['2026-08', '2026-09', '2026-10', '2027-02'];
const OVERVIEW_KEYS = ['2026-08', '2026-09', '2026-10', '2026-11', '2027-03'];

function budgetValues(f: ForecastResult, key: string) {
  const summary = getAccountPeriodSummary(f, key)!;
  const defaultAccount = getDefaultAccount(data.accounts);
  const balance = defaultAccount ? summary.accountBalances[defaultAccount.id] : undefined;
  const totals = getDefaultAccountPeriodTotals(defaultAccount, balance, summary.period, getOverdraftLimitInHaler(data.settings));
  const periodTxs = getEffectiveTransactionsForPeriod(
    summary.period, data.transactions, data.recurringRules, data.recurringExceptions, today, data.accounts
  );
  const kpis = calculateDefaultAccountKpis(defaultAccount, data.accounts, balance, periodTxs);
  return { ...totals, ...kpis, usableOpeningInHaler: summary.usableOpeningInHaler };
}

function overviewRow(f: ForecastResult, key: string) {
  const s = getAccountPeriodSummary(f, key)!;
  return {
    opening: s.openingBalanceInHaler,
    closing: s.closingBalanceInHaler,
    usableOpening: s.usableOpeningInHaler,
    usableClosing: s.usableClosingInHaler,
    netWorthOpening: s.netWorthOpeningInHaler,
    netWorthClosing: s.netWorthClosingInHaler,
    accounts: Object.fromEntries(Object.values(s.accountBalances).map(b => [b.accountId, [b.openingBalanceInHaler, b.closingBalanceInHaler]])),
  };
}

function accountsSummary(f: ForecastResult, key: string) {
  const s = getAccountPeriodSummary(f, key)!;
  return Object.values(s.accountBalances).map(b => ({ ...b }));
}

describe('period values on demo data (characterization)', () => {
  it('Budget tiles and KPIs', () => {
    expect(Object.fromEntries(BUDGET_KEYS.map(key => [key, budgetValues(forecast, key)]))).toMatchSnapshot();
  });

  it('Overview rows', () => {
    expect(Object.fromEntries(OVERVIEW_KEYS.map(key => [key, overviewRow(forecast, key)]))).toMatchSnapshot();
  });

  it('Accounts summary for the current and a past period', () => {
    expect({ current: accountsSummary(forecast, '2026-10'), past: accountsSummary(forecast, '2026-08') }).toMatchSnapshot();
  });
});
