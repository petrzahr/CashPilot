import {
  Account,
  BalanceCorrection,
  BudgetPeriod,
  Category,
  MarketValueSnapshot,
  Transaction,
} from '../types/finance';
import { addHaler, subHaler } from './currencyService';
import {
  CZECH_MONTHS,
  createBudgetPeriod,
  getPeriodForDate,
  getPreviousPeriod,
  getNextPeriod,
  formatCzechDate,
  formatPeriodRange,
  getPreviousDayString,
  getTodayInPrague,
  isDateInPeriod,
  getOverviewPeriods,
  generatePeriodsBetween,
} from './periodService';
import { czechStringCompare } from './categoryService';
import { getAssetFlowInHaler, sortAccountsByOrder } from './accountService';

export type AnalyticsPeriodPreset = '3m' | '6m' | '12m' | 'ytd' | 'all' | 'custom';

export interface BudgetPeriodInfo {
  period: BudgetPeriod;
  key: string;            // YYYY-MM
  label: string;          // např. "Srpen 2026"
  shortLabel: string;     // např. "Srp 26"
  startDate: string;      // period.startDate (např. 2026-08-15)
  endDate: string;        // period.endDate (např. 2026-09-14)
  analysisEndDate: string;// min(period.endDate, todayStr) (např. 2026-09-13)
  dateRangeStr: string;   // formátovaný rozsah např. "15. 8. 2026 – 13. 9. 2026"
  isCurrentPeriod: boolean;
  daysInPeriodCount: number;
  totalDaysInPeriod: number;
}

export interface AnalyticsDateRange {
  preset: AnalyticsPeriodPreset;
  startDate: string;      // YYYY-MM-DD
  endDate: string;        // YYYY-MM-DD (až do todayStr u probíhajícího)
  fromPeriodKey: string;  // YYYY-MM
  toPeriodKey: string;    // YYYY-MM
  periods: BudgetPeriodInfo[];
}

export interface AnalyticsFilters {
  accountId?: string | null;
  categoryId?: string | null;
  subcategoryId?: string | null;
}

export interface AnalyticsKPIs {
  totalIncomeInHaler: number;
  totalExpenseInHaler: number;
  netChangeInHaler: number;
  savingsRate: number | null;
  avgMonthlyExpenseInHaler: number;
  netWorthChangeInHaler: number;
  hasPartialCurrentMonth: boolean;
  totalMonthsCount: number;
}

export interface MonthlyCashFlowPoint {
  monthKey: string;
  label: string;
  shortLabel: string;
  dateRangeStr: string;
  incomeInHaler: number;
  expenseInHaler: number;
  netChangeInHaler: number;
  savingsRate: number | null;
  isCurrentMonth: boolean;
}

export interface SubcategoryBreakdownItem {
  subcategoryId: string;
  name: string;
  totalInHaler: number;
  percentage: number;
}

export interface CategoryBreakdownItem {
  categoryId: string;
  name: string;
  color: string;
  icon?: string;
  totalInHaler: number;
  percentage: number;
  subcategories: SubcategoryBreakdownItem[];
}

export interface NetWorthHistoryPoint {
  monthKey: string;
  label: string;
  shortLabel: string;
  dateRangeStr: string;
  date: string;
  checkingAndCashInHaler: number;
  savingsInHaler: number;
  investmentsInHaler: number;
  pensionInHaler: number;
  totalNetWorthInHaler: number;
  isCurrentMonth: boolean;
}

export interface PortfolioCompositionSegment {
  key: string;            // accountId
  label: string;          // název konkrétního účtu
  color: string;
  balanceInHaler: number;
  pct: number | null;     // % podíl na celkovém majetku daného období (null, pokud total === 0)
}

export interface PortfolioCompositionPoint {
  periodKey: string;
  periodLabel: string;
  periodShortLabel: string;
  dateRangeStr: string;
  totalNetWorthInHaler: number;
  isCurrentMonth: boolean;
  segments: PortfolioCompositionSegment[];
}

export interface ExpenseTrendItem {
  monthKey: string;
  label: string;
  dateRangeStr: string;
  expenseInHaler: number;
  prevMonthExpenseInHaler: number | null;
  changePercent: number | null;
  isCurrentMonth: boolean;
  isSameDayComparison: boolean;
}

export interface FinancialExtremes {
  highestIncomeMonth: { monthKey: string; label: string; amountInHaler: number } | null;
  highestExpenseMonth: { monthKey: string; label: string; amountInHaler: number } | null;
  bestNetMonth: { monthKey: string; label: string; amountInHaler: number } | null;
  worstNetMonth: { monthKey: string; label: string; amountInHaler: number } | null;
  avgMonthlyIncomeInHaler: number;
  avgMonthlyNetChangeInHaler: number;
}

export interface TopExpenseItem {
  transaction: Transaction;
  accountName: string;
  categoryName: string;
  subcategoryName?: string;
}

/**
 * Spočítá počet kalendářních dnů mezi dvěma daty (včetně obou hranic).
 */
export function getDaysBetweenInclusive(startDate: string, endDate: string): number {
  const [y1, m1, d1] = startDate.split('-').map(Number);
  const [y2, m2, d2] = endDate.split('-').map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.max(1, Math.round((t2 - t1) / 86400000) + 1);
}

/**
 * Přičte počet dní k datu ve formátu YYYY-MM-DD a vrátí nový řetězec YYYY-MM-DD.
 */
export function addDaysToDateString(dateStr: string, daysToAdd: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + daysToAdd);
  const resY = dt.getUTCFullYear();
  const resM = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const resD = String(dt.getUTCDate()).padStart(2, '0');
  return `${resY}-${resM}-${resD}`;
}

/**
 * Zjistí datum nejstaršího relevantního historického záznamu v aplikaci.
 */
export function getEarliestActivityDate(
  accounts: Account[] = [],
  transactions: Transaction[] = [],
  corrections: BalanceCorrection[] = [],
  snapshots: MarketValueSnapshot[] = [],
  todayStr: string = getTodayInPrague()
): string {
  let earliest = todayStr;

  for (const a of accounts) {
    if (a.initialBalanceDate && a.initialBalanceDate < earliest) {
      earliest = a.initialBalanceDate;
    }
  }

  for (const t of transactions) {
    if (t.status === 'executed' && t.date && t.date < earliest) {
      earliest = t.date;
    }
  }

  for (const c of corrections) {
    if (c.checkDate && c.checkDate < earliest) {
      earliest = c.checkDate;
    }
  }

  for (const s of snapshots) {
    if (s.date && s.date < earliest) {
      earliest = s.date;
    }
  }

  return earliest;
}

/**
 * Vytvoří objekt BudgetPeriodInfo pro danou rozpočtovou periodu.
 */
export function createBudgetPeriodInfo(
  period: BudgetPeriod,
  todayStr: string = getTodayInPrague()
): BudgetPeriodInfo {
  const isCurrentPeriod = isDateInPeriod(todayStr, period);
  const analysisEndDate = isCurrentPeriod ? (todayStr < period.endDate ? todayStr : period.endDate) : period.endDate;
  const monthName = CZECH_MONTHS[period.month - 1];
  const label = `${monthName} ${period.year}`;
  const shortLabel = `${monthName.substring(0, 3)} ${period.year}`;

  const totalDaysInPeriod = getDaysBetweenInclusive(period.startDate, period.endDate);
  const daysInPeriodCount = getDaysBetweenInclusive(period.startDate, analysisEndDate);

  const dateRangeStr = `${formatCzechDate(period.startDate)} – ${formatCzechDate(analysisEndDate)}`;

  return {
    period,
    key: period.key,
    label,
    shortLabel,
    startDate: period.startDate,
    endDate: period.endDate,
    analysisEndDate,
    dateRangeStr,
    isCurrentPeriod,
    daysInPeriodCount,
    totalDaysInPeriod,
  };
}

/**
 * Vygeneruje sekvenci rozpočtových period od startPeriod do endPeriod (včetně obou).
 */
export function generateBudgetPeriodSequence(
  startPeriod: BudgetPeriod,
  endPeriod: BudgetPeriod,
  startDay: number = 15,
  todayStr: string = getTodayInPrague()
): BudgetPeriodInfo[] {
  const result: BudgetPeriodInfo[] = [];
  let cur: BudgetPeriod = startPeriod;

  while (cur.key <= endPeriod.key) {
    result.push(createBudgetPeriodInfo(cur, todayStr));
    if (cur.key === endPeriod.key) break;
    cur = getNextPeriod(cur, startDay);
  }

  return result;
}

/**
 * Vypočítá přesný rozsah rozpočtových period na základě nastavení startovního dne
 * a zvolené rychlé volby nebo vlastního výběru Od–Do.
 */
export function resolveAnalyticsDateRange(
  preset: AnalyticsPeriodPreset,
  customFrom?: string, // klíč YYYY-MM
  customTo?: string,   // klíč YYYY-MM
  allData?: {
    accounts: Account[];
    transactions: Transaction[];
    corrections: BalanceCorrection[];
    snapshots: MarketValueSnapshot[];
  },
  todayStr: string = getTodayInPrague(),
  startDay: number = 15
): { range: AnalyticsDateRange; error?: string } {
  const safeStartDay = Math.max(1, Math.min(31, Math.round(startDay || 15)));
  const currentPeriod = getPeriodForDate(todayStr, safeStartDay);

  if (preset === 'custom') {
    if (!customFrom || !customTo) {
      return {
        range: resolveAnalyticsDateRange('12m', undefined, undefined, allData, todayStr, safeStartDay).range,
        error: 'Vyberte prosím počáteční i koncový měsíc.',
      };
    }

    if (customFrom > customTo) {
      return {
        range: resolveAnalyticsDateRange('12m', undefined, undefined, allData, todayStr, safeStartDay).range,
        error: 'Počáteční měsíc nesmí být pozdější než koncový měsíc.',
      };
    }

    if (customTo > currentPeriod.key) {
      return {
        range: resolveAnalyticsDateRange('12m', undefined, undefined, allData, todayStr, safeStartDay).range,
        error: 'Koncové rozpočtové období nesmí být v budoucnosti.',
      };
    }

    const [fromY, fromM] = customFrom.split('-').map(Number);
    const [toY, toM] = customTo.split('-').map(Number);
    const startPeriod = createBudgetPeriod(fromY, fromM, safeStartDay);
    const endPeriod = createBudgetPeriod(toY, toM, safeStartDay);

    const periods = generateBudgetPeriodSequence(startPeriod, endPeriod, safeStartDay, todayStr);
    const lastInfo = periods[periods.length - 1];

    return {
      range: {
        preset: 'custom',
        startDate: startPeriod.startDate,
        endDate: lastInfo ? lastInfo.analysisEndDate : endPeriod.endDate,
        fromPeriodKey: customFrom,
        toPeriodKey: customTo,
        periods,
      },
    };
  }

  if (preset === '3m') {
    let p = currentPeriod;
    for (let i = 0; i < 2; i++) {
      p = getPreviousPeriod(p, safeStartDay);
    }
    const periods = generateBudgetPeriodSequence(p, currentPeriod, safeStartDay, todayStr);
    const lastInfo = periods[periods.length - 1];

    return {
      range: {
        preset: '3m',
        startDate: p.startDate,
        endDate: lastInfo ? lastInfo.analysisEndDate : todayStr,
        fromPeriodKey: p.key,
        toPeriodKey: currentPeriod.key,
        periods,
      },
    };
  }

  if (preset === '6m') {
    let p = currentPeriod;
    for (let i = 0; i < 5; i++) {
      p = getPreviousPeriod(p, safeStartDay);
    }
    const periods = generateBudgetPeriodSequence(p, currentPeriod, safeStartDay, todayStr);
    const lastInfo = periods[periods.length - 1];

    return {
      range: {
        preset: '6m',
        startDate: p.startDate,
        endDate: lastInfo ? lastInfo.analysisEndDate : todayStr,
        fromPeriodKey: p.key,
        toPeriodKey: currentPeriod.key,
        periods,
      },
    };
  }

  if (preset === 'ytd') {
    // Začíná prvním rozpočtovým obdobím označeným aktuálním rokem (Leden [currentPeriod.year])
    // a končí aktuálním rozpočtovým obdobím k aktuálnímu dni
    const curYear = currentPeriod.year;
    const startPeriod = createBudgetPeriod(curYear, 1, safeStartDay);
    const periods = generateBudgetPeriodSequence(startPeriod, currentPeriod, safeStartDay, todayStr);
    const lastInfo = periods[periods.length - 1];

    return {
      range: {
        preset: 'ytd',
        startDate: startPeriod.startDate,
        endDate: lastInfo ? lastInfo.analysisEndDate : todayStr,
        fromPeriodKey: startPeriod.key,
        toPeriodKey: currentPeriod.key,
        periods,
      },
    };
  }

  if (preset === 'all') {
    const earliestDate = getEarliestActivityDate(
      allData?.accounts || [],
      allData?.transactions || [],
      allData?.corrections || [],
      allData?.snapshots || [],
      todayStr
    );
    const startPeriod = getPeriodForDate(earliestDate, safeStartDay);
    const periods = generateBudgetPeriodSequence(startPeriod, currentPeriod, safeStartDay, todayStr);
    const lastInfo = periods[periods.length - 1];

    return {
      range: {
        preset: 'all',
        startDate: startPeriod.startDate,
        endDate: lastInfo ? lastInfo.analysisEndDate : todayStr,
        fromPeriodKey: startPeriod.key,
        toPeriodKey: currentPeriod.key,
        periods,
      },
    };
  }

  // Výchozí: 12 měsíců (rozpočtových period)
  let p = currentPeriod;
  for (let i = 0; i < 11; i++) {
    p = getPreviousPeriod(p, safeStartDay);
  }
  const periods = generateBudgetPeriodSequence(p, currentPeriod, safeStartDay, todayStr);
  const lastInfo = periods[periods.length - 1];

  return {
    range: {
      preset: '12m',
      startDate: p.startDate,
      endDate: lastInfo ? lastInfo.analysisEndDate : todayStr,
      fromPeriodKey: p.key,
      toPeriodKey: currentPeriod.key,
      periods,
    },
  };
}

/**
 * Stav duálního filtru Budoucnost/Historie sdíleného mezi sekcemi Přehled a Analýza & trendy.
 */
export type DualPeriodRange = {
  direction: 'future' | 'past';
  months?: 3 | 6 | 12 | 18 | 24;
  preset?: 'ytd' | 'all' | 'custom';
  from?: string; // klíč YYYY-MM
  to?: string;   // klíč YYYY-MM
};

/**
 * Vyhodnotí sekvenci rozpočtových period pro duální filtr Budoucnost/Historie.
 */
export function resolveDualPeriodRange(
  range: DualPeriodRange,
  current: BudgetPeriod,
  allData: {
    accounts: Account[];
    transactions: Transaction[];
    corrections: BalanceCorrection[];
    snapshots: MarketValueSnapshot[];
  },
  todayStr: string = getTodayInPrague(),
  startDay: number = 15
): BudgetPeriodInfo[] {
  let rawPeriods: BudgetPeriod[];

  if (range.preset === 'custom' && range.from && range.to) {
    const [fromY, fromM] = range.from.split('-').map(Number);
    const [toY, toM] = range.to.split('-').map(Number);
    rawPeriods = generatePeriodsBetween(
      createBudgetPeriod(fromY, fromM, startDay),
      createBudgetPeriod(toY, toM, startDay),
      startDay
    );
  } else if (range.preset) {
    rawPeriods = resolveAnalyticsDateRange(range.preset, undefined, undefined, allData, todayStr, startDay)
      .range.periods.map((info) => info.period);
  } else {
    rawPeriods = getOverviewPeriods(current, { direction: range.direction, months: range.months || 12 }, startDay);
  }

  return rawPeriods.map((p) => createBudgetPeriodInfo(p, todayStr));
}

/**
 * Vyfiltruje uskutečněné transakce podle časového rozsahu a volitelných filtrů.
 */
export function getFilteredExecutedTransactions(
  transactions: Transaction[] = [],
  range: AnalyticsDateRange,
  filters: AnalyticsFilters = {},
  categories: Category[] = [],
  todayStr: string = getTodayInPrague()
): Transaction[] {
  const safeTxs = Array.isArray(transactions) ? transactions : [];

  return safeTxs.filter((t) => {
    if (t.status !== 'executed') return false;
    if (t.date > todayStr) return false;
    if (t.date < range.startDate || t.date > range.endDate) return false;

    if (filters.accountId) {
      if (t.sourceAccountId !== filters.accountId && t.targetAccountId !== filters.accountId) {
        return false;
      }
    }

    if (filters.categoryId) {
      const txCat = categories.find((c) => c.id === t.categoryId);
      const mainCatId = txCat ? (txCat.parentId ? txCat.parentId : txCat.id) : null;
      if (mainCatId !== filters.categoryId) {
        return false;
      }
    }

    if (filters.subcategoryId) {
      if (t.subcategoryId !== filters.subcategoryId && t.categoryId !== filters.subcategoryId) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Spočítá stav likvidního účtu k danému dni.
 */
export function computeLiquidAccountBalanceAtDate(
  acc: Account,
  pointDate: string,
  transactions: Transaction[] = [],
  corrections: BalanceCorrection[] = []
): number {
  const initDate = acc.initialBalanceDate || '1970-01-01';
  if (initDate > pointDate) return 0;

  let bal = acc.initialBalanceInHaler || 0;

  for (const t of transactions) {
    if (t.status === 'cancelled') continue;
    if (t.status !== 'executed' && t.type !== 'balance_adjustment') continue;
    if (t.date < initDate || t.date > pointDate) continue;

    const amt =
      t.status === 'executed' && t.actualAmountInHaler !== undefined
        ? t.actualAmountInHaler
        : t.amountInHaler;

    if (t.type === 'income' && t.sourceAccountId === acc.id) {
      bal = addHaler(bal, amt);
    } else if (t.type === 'expense' && t.sourceAccountId === acc.id) {
      bal = subHaler(bal, amt);
    } else if (t.type === 'transfer') {
      if (t.sourceAccountId === acc.id) bal = subHaler(bal, amt);
      if (t.targetAccountId === acc.id) bal = addHaler(bal, amt);
    } else if (t.type === 'balance_adjustment' && t.sourceAccountId === acc.id) {
      const diff = t.diffInHaler !== undefined ? t.diffInHaler : amt;
      bal = addHaler(bal, diff);
    }
  }

  const relevantCorrections = (corrections || []).filter((c) => {
    if (c.accountId !== acc.id) return false;
    if (c.checkDate < initDate || c.checkDate > pointDate) return false;
    const isAlreadyInTxs = transactions.some(
      (t) =>
        t.id === c.id ||
        (t.type === 'balance_adjustment' &&
          t.sourceAccountId === c.accountId &&
          t.date === c.checkDate &&
          t.diffInHaler === c.diffInHaler)
    );
    return !isAlreadyInTxs;
  });

  for (const c of relevantCorrections) {
    bal = addHaler(bal, c.diffInHaler);
  }

  return bal;
}

/**
 * Spočítá stav investičního / penzijního účtu k danému dni.
 */
export function computeAssetAccountBalanceAtDate(
  acc: Account,
  pointDate: string,
  transactions: Transaction[] = [],
  snapshots: MarketValueSnapshot[] = []
): number {
  const initDate = acc.initialBalanceDate || '1970-01-01';
  if (initDate > pointDate) return 0;

  const validSnapshots = (snapshots || [])
    .filter((s) => s.accountId === acc.id && s.date >= initDate && s.date <= pointDate)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || '') || b.id.localeCompare(a.id));

  let baseVal = acc.initialBalanceInHaler || 0;
  let valDate = initDate;
  let hasValuation = false;

  if (validSnapshots.length > 0) {
    baseVal = validSnapshots[0].marketValueInHaler;
    valDate = validSnapshots[0].date;
    hasValuation = true;
  } else if (
    acc.currentMarketValueInHaler !== undefined &&
    acc.marketValueUpdatedAt &&
    acc.marketValueUpdatedAt >= initDate &&
    acc.marketValueUpdatedAt <= pointDate
  ) {
    baseVal = acc.currentMarketValueInHaler;
    valDate = acc.marketValueUpdatedAt;
    hasValuation = true;
  } else if (acc.currentMarketValueInHaler !== undefined && !acc.marketValueUpdatedAt) {
    baseVal = acc.currentMarketValueInHaler;
    valDate = initDate;
  }

  for (const t of transactions) {
    if (t.status !== 'executed') continue;
    if (hasValuation) {
      if (t.date <= valDate || t.date > pointDate) continue;
    } else {
      if (t.date < initDate || t.date > pointDate) continue;
    }

    const amt = t.actualAmountInHaler !== undefined ? t.actualAmountInHaler : t.amountInHaler;
    baseVal = addHaler(baseVal, getAssetFlowInHaler(t, acc.id, amt));
  }

  return baseVal;
}

/**
 * Spočítá celkové jmění k danému dni.
 */
export function calculateNetWorthAtDate(
  accounts: Account[] = [],
  pointDate: string,
  transactions: Transaction[] = [],
  corrections: BalanceCorrection[] = [],
  snapshots: MarketValueSnapshot[] = [],
  filterAccountId?: string | null
): {
  checkingAndCashInHaler: number;
  savingsInHaler: number;
  investmentsInHaler: number;
  pensionInHaler: number;
  totalNetWorthInHaler: number;
} {
  const targetAccounts = filterAccountId
    ? accounts.filter((a) => a.id === filterAccountId)
    : accounts;

  let checkingAndCashInHaler = 0;
  let savingsInHaler = 0;
  let investmentsInHaler = 0;
  let pensionInHaler = 0;

  for (const acc of targetAccounts) {
    if (acc.type === 'checking' || acc.type === 'cash' || acc.type === 'other') {
      checkingAndCashInHaler = addHaler(
        checkingAndCashInHaler,
        computeLiquidAccountBalanceAtDate(acc, pointDate, transactions, corrections)
      );
    } else if (acc.type === 'savings') {
      savingsInHaler = addHaler(
        savingsInHaler,
        computeLiquidAccountBalanceAtDate(acc, pointDate, transactions, corrections)
      );
    } else if (acc.type === 'investment') {
      investmentsInHaler = addHaler(
        investmentsInHaler,
        computeAssetAccountBalanceAtDate(acc, pointDate, transactions, snapshots)
      );
    } else if (acc.type === 'pension') {
      pensionInHaler = addHaler(
        pensionInHaler,
        computeAssetAccountBalanceAtDate(acc, pointDate, transactions, snapshots)
      );
    }
  }

  const totalNetWorthInHaler = addHaler(
    checkingAndCashInHaler,
    savingsInHaler,
    investmentsInHaler,
    pensionInHaler
  );

  return {
    checkingAndCashInHaler,
    savingsInHaler,
    investmentsInHaler,
    pensionInHaler,
    totalNetWorthInHaler,
  };
}

/**
 * Spočítá 6 hlavních souhrnných KPI karet pro sekci Analýza & trendy.
 */
export function calculateAnalyticsKPIs(
  range: AnalyticsDateRange,
  filteredTxs: Transaction[],
  accounts: Account[],
  allTxs: Transaction[],
  corrections: BalanceCorrection[],
  snapshots: MarketValueSnapshot[],
  filterAccountId?: string | null,
  todayStr: string = getTodayInPrague()
): AnalyticsKPIs {
  let totalIncomeInHaler = 0;
  let totalExpenseInHaler = 0;

  for (const t of filteredTxs) {
    if (t.type === 'transfer' || t.type === 'balance_adjustment') continue;

    const amt = t.actualAmountInHaler !== undefined ? t.actualAmountInHaler : t.amountInHaler;

    if (t.type === 'income') {
      totalIncomeInHaler = addHaler(totalIncomeInHaler, amt);
    } else if (t.type === 'expense') {
      totalExpenseInHaler = addHaler(totalExpenseInHaler, amt);
    }
  }

  const netChangeInHaler = subHaler(totalIncomeInHaler, totalExpenseInHaler);

  const savingsRate =
    totalIncomeInHaler > 0
      ? ((totalIncomeInHaler - totalExpenseInHaler) / totalIncomeInHaler) * 100
      : null;

  const totalMonthsCount = Math.max(1, range.periods.length);
  const avgMonthlyExpenseInHaler = Math.round(totalExpenseInHaler / totalMonthsCount);

  // Změna celkového jmění = stav ke konci období - stav k předchozímu dni před startem období
  const prevDayStr = getPreviousDayString(range.startDate);

  const netWorthStart = calculateNetWorthAtDate(
    accounts,
    prevDayStr,
    allTxs,
    corrections,
    snapshots,
    filterAccountId
  ).totalNetWorthInHaler;

  const netWorthEnd = calculateNetWorthAtDate(
    accounts,
    range.endDate,
    allTxs,
    corrections,
    snapshots,
    filterAccountId
  ).totalNetWorthInHaler;

  const netWorthChangeInHaler = subHaler(netWorthEnd, netWorthStart);
  const hasPartialCurrentMonth = range.periods.some((p) => p.isCurrentPeriod);

  return {
    totalIncomeInHaler,
    totalExpenseInHaler,
    netChangeInHaler,
    savingsRate,
    avgMonthlyExpenseInHaler,
    netWorthChangeInHaler,
    hasPartialCurrentMonth,
    totalMonthsCount,
  };
}

/**
 * Spočítá cash flow podle rozpočtových period pro hlavní sloupcový graf.
 */
export function calculateMonthlyCashFlow(
  periods: BudgetPeriodInfo[],
  filteredTxs: Transaction[],
  startDay: number = 15
): MonthlyCashFlowPoint[] {
  return periods.map((p) => {
    let incomeInHaler = 0;
    let expenseInHaler = 0;

    for (const t of filteredTxs) {
      if (t.type === 'transfer' || t.type === 'balance_adjustment') continue;
      // Ověříme, zda transakce patří do této rozpočtové periody
      if (isDateInPeriod(t.date, p.period) && t.date <= p.analysisEndDate) {
        const amt = t.actualAmountInHaler !== undefined ? t.actualAmountInHaler : t.amountInHaler;
        if (t.type === 'income') incomeInHaler = addHaler(incomeInHaler, amt);
        if (t.type === 'expense') expenseInHaler = addHaler(expenseInHaler, amt);
      }
    }

    const netChangeInHaler = subHaler(incomeInHaler, expenseInHaler);
    const savingsRate =
      incomeInHaler > 0
        ? ((incomeInHaler - expenseInHaler) / incomeInHaler) * 100
        : null;

    return {
      monthKey: p.key,
      label: p.label,
      shortLabel: p.shortLabel,
      dateRangeStr: p.dateRangeStr,
      incomeInHaler,
      expenseInHaler,
      netChangeInHaler,
      savingsRate,
      isCurrentMonth: p.isCurrentPeriod,
    };
  });
}

/**
 * Spočítá rozpad kategorií seřazený sestupně podle částky a abecedně A–Z.
 */
export function calculateCategoryBreakdown(
  type: 'expense' | 'income',
  filteredTxs: Transaction[],
  categories: Category[]
): CategoryBreakdownItem[] {
  const relevantTxs = filteredTxs.filter((t) => t.type === type);

  let totalAmountInHaler = 0;
  for (const t of relevantTxs) {
    const amt = t.actualAmountInHaler !== undefined ? t.actualAmountInHaler : t.amountInHaler;
    totalAmountInHaler = addHaler(totalAmountInHaler, amt);
  }

  const catMap = new Map<string, Category>();
  for (const c of categories) {
    catMap.set(c.id, c);
  }

  const mainAgg = new Map<
    string,
    {
      name: string;
      color: string;
      icon?: string;
      total: number;
      subMap: Map<string, { name: string; total: number }>;
    }
  >();

  for (const t of relevantTxs) {
    const amt = t.actualAmountInHaler !== undefined ? t.actualAmountInHaler : t.amountInHaler;
    const cat = t.categoryId ? catMap.get(t.categoryId) : undefined;

    let mainCatId = 'uncategorized';
    let mainCatName = 'Bez kategorie';
    let mainColor = '#94a3b8';
    let mainIcon: string | undefined = undefined;

    let subId = t.subcategoryId || (cat && cat.parentId ? cat.id : 'no_sub');
    let subName = 'Bez podkategorie';

    if (cat) {
      if (cat.parentId) {
        const parent = catMap.get(cat.parentId);
        mainCatId = cat.parentId;
        mainCatName = parent ? parent.name : 'Neznámá kategorie';
        mainColor = parent ? parent.color : cat.color;
        mainIcon = parent ? parent.icon : cat.icon;
        subId = cat.id;
        subName = cat.name;
      } else {
        mainCatId = cat.id;
        mainCatName = cat.name;
        mainColor = cat.color;
        mainIcon = cat.icon;

        if (t.subcategoryId) {
          const subCat = catMap.get(t.subcategoryId);
          subId = t.subcategoryId;
          subName = subCat ? subCat.name : 'Podkategorie';
        }
      }
    }

    if (!mainAgg.has(mainCatId)) {
      mainAgg.set(mainCatId, {
        name: mainCatName,
        color: mainColor,
        icon: mainIcon,
        total: 0,
        subMap: new Map(),
      });
    }

    const mItem = mainAgg.get(mainCatId)!;
    mItem.total = addHaler(mItem.total, amt);

    if (!mItem.subMap.has(subId)) {
      mItem.subMap.set(subId, { name: subName, total: 0 });
    }
    const sItem = mItem.subMap.get(subId)!;
    sItem.total = addHaler(sItem.total, amt);
  }

  const result: CategoryBreakdownItem[] = [];

  for (const [id, data] of mainAgg.entries()) {
    if (data.total <= 0) continue;

    const percentage =
      totalAmountInHaler > 0 ? (data.total / totalAmountInHaler) * 100 : 0;

    const subcategories: SubcategoryBreakdownItem[] = [];
    for (const [sId, sData] of data.subMap.entries()) {
      if (sData.total <= 0) continue;
      subcategories.push({
        subcategoryId: sId,
        name: sData.name,
        totalInHaler: sData.total,
        percentage: data.total > 0 ? (sData.total / data.total) * 100 : 0,
      });
    }

    subcategories.sort((a, b) => {
      if (b.totalInHaler !== a.totalInHaler) {
        return b.totalInHaler - a.totalInHaler;
      }
      return czechStringCompare(a.name, b.name);
    });

    result.push({
      categoryId: id,
      name: data.name,
      color: data.color,
      icon: data.icon,
      totalInHaler: data.total,
      percentage,
      subcategories,
    });
  }

  result.sort((a, b) => {
    if (b.totalInHaler !== a.totalInHaler) {
      return b.totalInHaler - a.totalInHaler;
    }
    return czechStringCompare(a.name, b.name);
  });

  return result;
}

/**
 * Spočítá vývoj celkového jmění podle rozpočtových period.
 */
export function calculateNetWorthHistory(
  periods: BudgetPeriodInfo[],
  accounts: Account[],
  transactions: Transaction[],
  corrections: BalanceCorrection[],
  snapshots: MarketValueSnapshot[],
  filterAccountId?: string | null
): NetWorthHistoryPoint[] {
  return periods.map((p) => {
    const pointDate = p.analysisEndDate;
    const nw = calculateNetWorthAtDate(
      accounts,
      pointDate,
      transactions,
      corrections,
      snapshots,
      filterAccountId
    );

    return {
      monthKey: p.key,
      label: p.label,
      shortLabel: p.shortLabel,
      dateRangeStr: p.dateRangeStr,
      date: pointDate,
      checkingAndCashInHaler: nw.checkingAndCashInHaler,
      savingsInHaler: nw.savingsInHaler,
      investmentsInHaler: nw.investmentsInHaler,
      pensionInHaler: nw.pensionInHaler,
      totalNetWorthInHaler: nw.totalNetWorthInHaler,
      isCurrentMonth: p.isCurrentPeriod,
    };
  });
}

/**
 * Spočítá procentuální rozložení celkového majetku (podíl jednotlivých účtů na celkovém
 * majetku) podle rozpočtových period. Úplně všechny způsobilé účty (běžné, hotovostní,
 * "jiné", spořicí, penzijní i investiční) se zobrazují jako samostatné segmenty se svou
 * vlastní barvou. Pořadí i barvy segmentů odpovídají pořadí a barvám účtů v sekci Účty
 * (sortAccountsByOrder), konzistentně napříč obdobími. Základna pro % (= 100 %, y=100 %,
 * resp. y=-100 % pro zápornou stranu) je VĚTŠÍ z dvojice: součet kladných zůstatků, nebo
 * absolutní hodnota součtu záporných zůstatků. Díky tomu je dominantní strana (typicky
 * kladná, ale u záporného celkového jmění záporná) vždy přesně na 100 % a ta menší strana
 * je vůči ní poměrově menší, místo aby přesahovala hranici grafu.
 */
export function calculatePortfolioComposition(
  periods: BudgetPeriodInfo[],
  accounts: Account[],
  transactions: Transaction[],
  corrections: BalanceCorrection[],
  snapshots: MarketValueSnapshot[]
): PortfolioCompositionPoint[] {
  const eligibleAccounts = sortAccountsByOrder(accounts).filter(
    (a) => a.isNetWorth && a.status === 'active'
  );

  return periods.map((p) => {
    const pointDate = p.analysisEndDate;

    const rawSegments = eligibleAccounts.map((acc) => {
      const balanceInHaler =
        acc.type === 'investment' || acc.type === 'pension'
          ? computeAssetAccountBalanceAtDate(acc, pointDate, transactions, snapshots)
          : computeLiquidAccountBalanceAtDate(acc, pointDate, transactions, corrections);

      return { key: acc.id, label: acc.name, color: acc.color, balanceInHaler };
    });

    const totalNetWorthInHaler = rawSegments.reduce(
      (sum, s) => addHaler(sum, s.balanceInHaler),
      0
    );

    // % základna = větší z dvojice (součet kladných zůstatků, |součet záporných zůstatků|).
    // Dominantní strana je tak vždy přesně 100 % (resp. -100 %), menší strana je vůči ní
    // poměrově menší.
    const positiveSumInHaler = rawSegments.reduce(
      (sum, s) => (s.balanceInHaler > 0 ? addHaler(sum, s.balanceInHaler) : sum),
      0
    );
    const negativeSumInHaler = rawSegments.reduce(
      (sum, s) => (s.balanceInHaler < 0 ? addHaler(sum, s.balanceInHaler) : sum),
      0
    );
    const pctBaseInHaler = Math.max(positiveSumInHaler, Math.abs(negativeSumInHaler));

    const segments: PortfolioCompositionSegment[] = rawSegments.map((s) => ({
      ...s,
      pct: pctBaseInHaler !== 0 ? (s.balanceInHaler / pctBaseInHaler) * 100 : null,
    }));

    return {
      periodKey: p.key,
      periodLabel: p.label,
      periodShortLabel: p.shortLabel,
      dateRangeStr: p.dateRangeStr,
      totalNetWorthInHaler,
      isCurrentMonth: p.isCurrentPeriod,
      segments,
    };
  });
}

/**
 * Spočítá meziměsíční trend výdajů mezi rozpočtovými obdobími.
 * U probíhajícího období srovnává 1.–N. den s 1.–N. dnem předchozího rozpočtového období.
 */
export function calculateExpenseMoMTrend(
  periods: BudgetPeriodInfo[],
  allExecutedTxs: Transaction[],
  filters: AnalyticsFilters = {},
  categories: Category[] = [],
  todayStr: string = getTodayInPrague(),
  startDay: number = 15
): ExpenseTrendItem[] {
  const safeStartDay = Math.max(1, Math.min(31, Math.round(startDay || 15)));
  const result: ExpenseTrendItem[] = [];

  const getExpensesInDateRange = (sDate: string, eDate: string): number => {
    let sum = 0;
    for (const t of allExecutedTxs) {
      if (t.status !== 'executed' || t.type !== 'expense') continue;
      if (t.date > todayStr) continue;
      if (t.date >= sDate && t.date <= eDate) {
        if (filters.accountId && t.sourceAccountId !== filters.accountId && t.targetAccountId !== filters.accountId) {
          continue;
        }
        if (filters.categoryId) {
          const txCat = categories.find((c) => c.id === t.categoryId);
          const mainCatId = txCat ? (txCat.parentId ? txCat.parentId : txCat.id) : null;
          if (mainCatId !== filters.categoryId) continue;
        }
        if (filters.subcategoryId && t.subcategoryId !== filters.subcategoryId && t.categoryId !== filters.subcategoryId) {
          continue;
        }

        const amt = t.actualAmountInHaler !== undefined ? t.actualAmountInHaler : t.amountInHaler;
        sum = addHaler(sum, amt);
      }
    }
    return sum;
  };

  for (let i = 0; i < periods.length; i++) {
    const curP = periods[i];
    const curExpenses = getExpensesInDateRange(curP.startDate, curP.analysisEndDate);

    const prevPeriod = getPreviousPeriod(curP.period, safeStartDay);
    let prevExpenses: number | null = null;
    let isSameDayComparison = false;

    if (curP.isCurrentPeriod) {
      // Shodný počet uplynulých dní (1.–N. den)
      const elapsedDays = getDaysBetweenInclusive(curP.startDate, curP.analysisEndDate);
      const prevCompareEndDate = addDaysToDateString(prevPeriod.startDate, elapsedDays - 1);
      const effectivePrevEnd = prevCompareEndDate < prevPeriod.endDate ? prevCompareEndDate : prevPeriod.endDate;
      prevExpenses = getExpensesInDateRange(prevPeriod.startDate, effectivePrevEnd);
      isSameDayComparison = true;
    } else {
      // Celé předchozí rozpočtové období
      prevExpenses = getExpensesInDateRange(prevPeriod.startDate, prevPeriod.endDate);
    }

    let changePercent: number | null = null;
    if (prevExpenses !== null && prevExpenses > 0) {
      changePercent = ((curExpenses - prevExpenses) / prevExpenses) * 100;
    }

    result.push({
      monthKey: curP.key,
      label: curP.label,
      dateRangeStr: curP.dateRangeStr,
      expenseInHaler: curExpenses,
      prevMonthExpenseInHaler: prevExpenses,
      changePercent,
      isCurrentMonth: curP.isCurrentPeriod,
      isSameDayComparison,
    });
  }

  return result;
}

/**
 * Vrátí 10 nejvyšších uskutečněných výdajů ve vybraném rozsahu.
 */
export function getTopExpenses(
  filteredTxs: Transaction[],
  accounts: Account[],
  categories: Category[]
): TopExpenseItem[] {
  const expenseTxs = filteredTxs.filter((t) => t.type === 'expense');

  const sorted = [...expenseTxs].sort((a, b) => {
    const amtA = a.actualAmountInHaler !== undefined ? a.actualAmountInHaler : a.amountInHaler;
    const amtB = b.actualAmountInHaler !== undefined ? b.actualAmountInHaler : b.amountInHaler;
    return amtB - amtA;
  });

  const top10 = sorted.slice(0, 10);

  const accMap = new Map<string, Account>();
  for (const a of accounts) accMap.set(a.id, a);

  const catMap = new Map<string, Category>();
  for (const c of categories) catMap.set(c.id, c);

  return top10.map((tx) => {
    const acc = accMap.get(tx.sourceAccountId);
    const cat = tx.categoryId ? catMap.get(tx.categoryId) : undefined;
    const sub = tx.subcategoryId ? catMap.get(tx.subcategoryId) : undefined;

    let categoryName = 'Bez kategorie';
    let subcategoryName: string | undefined = undefined;

    if (cat) {
      if (cat.parentId) {
        const parent = catMap.get(cat.parentId);
        categoryName = parent ? parent.name : cat.name;
        subcategoryName = cat.name;
      } else {
        categoryName = cat.name;
        if (sub) {
          subcategoryName = sub.name;
        }
      }
    }

    return {
      transaction: tx,
      accountName: acc ? acc.name : 'Neznámý účet',
      categoryName,
      subcategoryName,
    };
  });
}

/**
 * Spočítá finanční extrémy a průměry.
 */
export function calculateFinancialExtremes(
  monthlyCashFlow: MonthlyCashFlowPoint[]
): FinancialExtremes {
  if (!monthlyCashFlow || monthlyCashFlow.length === 0) {
    return {
      highestIncomeMonth: null,
      highestExpenseMonth: null,
      bestNetMonth: null,
      worstNetMonth: null,
      avgMonthlyIncomeInHaler: 0,
      avgMonthlyNetChangeInHaler: 0,
    };
  }

  let highestIncome = -Infinity;
  let highestIncomeItem: MonthlyCashFlowPoint | null = null;

  let highestExpense = -Infinity;
  let highestExpenseItem: MonthlyCashFlowPoint | null = null;

  let bestNet = -Infinity;
  let bestNetItem: MonthlyCashFlowPoint | null = null;

  let worstNet = Infinity;
  let worstNetItem: MonthlyCashFlowPoint | null = null;

  let totalIncome = 0;
  let totalNet = 0;

  for (const m of monthlyCashFlow) {
    totalIncome = addHaler(totalIncome, m.incomeInHaler);
    totalNet = addHaler(totalNet, m.netChangeInHaler);

    if (m.incomeInHaler > highestIncome) {
      highestIncome = m.incomeInHaler;
      highestIncomeItem = m;
    }

    if (m.expenseInHaler > highestExpense) {
      highestExpense = m.expenseInHaler;
      highestExpenseItem = m;
    }

    if (m.netChangeInHaler > bestNet) {
      bestNet = m.netChangeInHaler;
      bestNetItem = m;
    }

    if (m.netChangeInHaler < worstNet) {
      worstNet = m.netChangeInHaler;
      worstNetItem = m;
    }
  }

  const count = monthlyCashFlow.length;

  return {
    highestIncomeMonth: highestIncomeItem
      ? {
          monthKey: highestIncomeItem.monthKey,
          label: highestIncomeItem.label,
          amountInHaler: highestIncomeItem.incomeInHaler,
        }
      : null,
    highestExpenseMonth: highestExpenseItem
      ? {
          monthKey: highestExpenseItem.monthKey,
          label: highestExpenseItem.label,
          amountInHaler: highestExpenseItem.expenseInHaler,
        }
      : null,
    bestNetMonth: bestNetItem
      ? {
          monthKey: bestNetItem.monthKey,
          label: bestNetItem.label,
          amountInHaler: bestNetItem.netChangeInHaler,
        }
      : null,
    worstNetMonth: worstNetItem
      ? {
          monthKey: worstNetItem.monthKey,
          label: worstNetItem.label,
          amountInHaler: worstNetItem.netChangeInHaler,
        }
      : null,
    avgMonthlyIncomeInHaler: Math.round(totalIncome / count),
    avgMonthlyNetChangeInHaler: Math.round(totalNet / count),
  };
}
