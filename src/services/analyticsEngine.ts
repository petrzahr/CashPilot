import {
  Account,
  BalanceCorrection,
  Category,
  MarketValueSnapshot,
  Transaction,
} from '../types/finance';
import { addHaler, subHaler } from './currencyService';
import {
  CZECH_MONTHS,
  getDaysInMonth,
  getPeriodKey,
  getTodayInPrague,
} from './periodService';
import { czechStringCompare } from './categoryService';

export type AnalyticsPeriodPreset = '3m' | '6m' | '12m' | 'ytd' | 'all' | 'custom';

export interface CalendarMonthInfo {
  year: number;
  month: number;
  key: string;        // YYYY-MM
  label: string;      // např. "Září 2026"
  shortLabel: string; // např. "Zář 26"
  startDate: string;  // YYYY-MM-01
  endDate: string;    // YYYY-MM-DD (konec měsíce nebo todayStr pro aktuální měsíc)
  isCurrentMonth: boolean;
  daysInMonthCount: number;
  totalDaysInMonth: number;
}

export interface AnalyticsDateRange {
  preset: AnalyticsPeriodPreset;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  fromMonthKey: string; // YYYY-MM
  toMonthKey: string;   // YYYY-MM
  months: CalendarMonthInfo[];
}

export interface AnalyticsFilters {
  accountId?: string | null; // null = Všechny účty
  categoryId?: string | null;// null = Všechny kategorie
  subcategoryId?: string | null; // null = Všechny podkategorie
}

export interface AnalyticsKPIs {
  totalIncomeInHaler: number;
  totalExpenseInHaler: number;
  netChangeInHaler: number;
  savingsRate: number | null; // null pokud příjem === 0
  avgMonthlyExpenseInHaler: number;
  netWorthChangeInHaler: number;
  hasPartialCurrentMonth: boolean;
  totalMonthsCount: number;
}

export interface MonthlyCashFlowPoint {
  monthKey: string;
  label: string;
  shortLabel: string;
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
  date: string;
  checkingAndCashInHaler: number;
  savingsInHaler: number;
  investmentsInHaler: number;
  pensionInHaler: number;
  totalNetWorthInHaler: number;
  isCurrentMonth: boolean;
}

export interface ExpenseTrendItem {
  monthKey: string;
  label: string;
  expenseInHaler: number;
  prevMonthExpenseInHaler: number | null;
  changePercent: number | null; // kladné = nárůst výdajů, záporné = pokles
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
 * Zjistí datum nejstaršího relevantního historického záznamu v aplikaci:
 * - datum počátečního stavu účtu,
 * - datum uskutečněné finanční položky,
 * - datum korekce,
 * - datum tržní hodnoty.
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
 * Pomocná funkce pro vygenerování seznamu kalendářních měsíců mezi startDate a endDate.
 */
export function generateCalendarMonths(
  startDate: string,
  endDate: string,
  todayStr: string = getTodayInPrague()
): CalendarMonthInfo[] {
  const [startYear, startMonth] = startDate.split('-').map(Number);
  const [endYear, endMonth] = endDate.split('-').map(Number);
  const [todayYear, todayMonth] = todayStr.split('-').map(Number);

  const result: CalendarMonthInfo[] = [];

  let curY = startYear;
  let curM = startMonth;

  while (curY < endYear || (curY === endYear && curM <= endMonth)) {
    const key = getPeriodKey(curY, curM);
    const monthName = CZECH_MONTHS[curM - 1];
    const label = `${monthName} ${curY}`;
    const shortLabel = `${monthName.substring(0, 3)} ${String(curY).slice(-2)}`;
    const totalDays = getDaysInMonth(curY, curM);

    const mStartDate = `${key}-01`;
    const isCurrent = curY === todayYear && curM === todayMonth;
    const mEndDate = isCurrent
      ? todayStr
      : `${key}-${String(totalDays).padStart(2, '0')}`;

    // Počet započítaných dnů v měsíci
    const sDay = curY === startYear && curM === startMonth ? Number(startDate.split('-')[2]) : 1;
    const eDay = curY === endYear && curM === endMonth ? Number(mEndDate.split('-')[2]) : totalDays;
    const daysInMonthCount = Math.max(1, eDay - sDay + 1);

    result.push({
      year: curY,
      month: curM,
      key,
      label,
      shortLabel,
      startDate: mStartDate,
      endDate: mEndDate,
      isCurrentMonth: isCurrent,
      daysInMonthCount,
      totalDaysInMonth: totalDays,
    });

    curM++;
    if (curM > 12) {
      curM = 1;
      curY++;
    }
  }

  return result;
}

/**
 * Vypočítá přesný časový rozsah na základě vybrané předvolby nebo vlastního rozsahu.
 */
export function resolveAnalyticsDateRange(
  preset: AnalyticsPeriodPreset,
  customFrom?: string, // YYYY-MM
  customTo?: string,   // YYYY-MM
  allData?: {
    accounts: Account[];
    transactions: Transaction[];
    corrections: BalanceCorrection[];
    snapshots: MarketValueSnapshot[];
  },
  todayStr: string = getTodayInPrague()
): { range: AnalyticsDateRange; error?: string } {
  const [curY, curM] = todayStr.split('-').map(Number);
  const currentMonthKey = getPeriodKey(curY, curM);

  if (preset === 'custom') {
    if (!customFrom || !customTo) {
      return {
        range: resolveAnalyticsDateRange('12m', undefined, undefined, allData, todayStr).range,
        error: 'Vyberte prosím počáteční i koncový měsíc.',
      };
    }

    if (customFrom > customTo) {
      return {
        range: resolveAnalyticsDateRange('12m', undefined, undefined, allData, todayStr).range,
        error: 'Počáteční měsíc nesmí být pozdější než koncový měsíc.',
      };
    }

    if (customTo > currentMonthKey) {
      return {
        range: resolveAnalyticsDateRange('12m', undefined, undefined, allData, todayStr).range,
        error: 'Koncový měsíc nesmí být v budoucnosti.',
      };
    }

    const startDate = `${customFrom}-01`;
    const [toY, toM] = customTo.split('-').map(Number);
    const toMonthDays = getDaysInMonth(toY, toM);
    const nominalEndDate = `${customTo}-${String(toMonthDays).padStart(2, '0')}`;
    const endDate = nominalEndDate > todayStr ? todayStr : nominalEndDate;

    const months = generateCalendarMonths(startDate, endDate, todayStr);
    return {
      range: {
        preset: 'custom',
        startDate,
        endDate,
        fromMonthKey: customFrom,
        toMonthKey: customTo,
        months,
      },
    };
  }

  if (preset === '3m') {
    let startY = curY;
    let startM = curM - 2;
    if (startM < 1) {
      startM += 12;
      startY -= 1;
    }
    const fromMonthKey = getPeriodKey(startY, startM);
    const startDate = `${fromMonthKey}-01`;
    const months = generateCalendarMonths(startDate, todayStr, todayStr);
    return {
      range: {
        preset: '3m',
        startDate,
        endDate: todayStr,
        fromMonthKey,
        toMonthKey: currentMonthKey,
        months,
      },
    };
  }

  if (preset === '6m') {
    let startY = curY;
    let startM = curM - 5;
    if (startM < 1) {
      startM += 12;
      startY -= 1;
    }
    const fromMonthKey = getPeriodKey(startY, startM);
    const startDate = `${fromMonthKey}-01`;
    const months = generateCalendarMonths(startDate, todayStr, todayStr);
    return {
      range: {
        preset: '6m',
        startDate,
        endDate: todayStr,
        fromMonthKey,
        toMonthKey: currentMonthKey,
        months,
      },
    };
  }

  if (preset === 'ytd') {
    const fromMonthKey = `${curY}-01`;
    const startDate = `${curY}-01-01`;
    const months = generateCalendarMonths(startDate, todayStr, todayStr);
    return {
      range: {
        preset: 'ytd',
        startDate,
        endDate: todayStr,
        fromMonthKey,
        toMonthKey: currentMonthKey,
        months,
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
    const [eY, eM] = earliestDate.split('-').map(Number);
    const fromMonthKey = getPeriodKey(eY, eM);
    const startDate = `${fromMonthKey}-01`;
    const months = generateCalendarMonths(startDate, todayStr, todayStr);
    return {
      range: {
        preset: 'all',
        startDate,
        endDate: todayStr,
        fromMonthKey,
        toMonthKey: currentMonthKey,
        months,
      },
    };
  }

  // Výchozí: 12 měsíců
  let startY = curY;
  let startM = curM - 11;
  if (startM < 1) {
    startM += 12;
    startY -= 1;
  }
  const fromMonthKey = getPeriodKey(startY, startM);
  const startDate = `${fromMonthKey}-01`;
  const months = generateCalendarMonths(startDate, todayStr, todayStr);
  return {
    range: {
      preset: '12m',
      startDate,
      endDate: todayStr,
      fromMonthKey,
      toMonthKey: currentMonthKey,
      months,
    },
  };
}

/**
 * Vyfiltruje uskutečněné transakce podle časového rozsahu a volitelných filtrů.
 * Zahrnuje jak aktivní, tak archivované účty a kategorie.
 * Nezahrnuje budoucí položky, plánované položky ani zrušené položky.
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
    // Pouze uskutečněné
    if (t.status !== 'executed') return false;
    // Nesmí být v budoucnosti
    if (t.date > todayStr) return false;
    // Musí spadat do vybraného rozsahu
    if (t.date < range.startDate || t.date > range.endDate) return false;

    // Filtr účtu
    if (filters.accountId) {
      if (t.sourceAccountId !== filters.accountId && t.targetAccountId !== filters.accountId) {
        return false;
      }
    }

    // Filtr kategorie
    if (filters.categoryId) {
      // Zjistit hlavní kategorii transakce
      const txCat = categories.find((c) => c.id === t.categoryId);
      const mainCatId = txCat ? (txCat.parentId ? txCat.parentId : txCat.id) : null;
      if (mainCatId !== filters.categoryId) {
        return false;
      }
    }

    // Filtr podkategorie
    if (filters.subcategoryId) {
      if (t.subcategoryId !== filters.subcategoryId && t.categoryId !== filters.subcategoryId) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Spočítá stav likvidního účtu (checking, cash, savings, other) k přesnému datu pointDate.
 * Nezahrnuje budoucí ani plánované položky.
 * Zahrnuje uskutečněné platby, převody a korekce.
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

  // Legacy korekce
  const relevantCorrections = (corrections || []).filter((c) => {
    if (c.accountId !== acc.id) return false;
    if (c.checkDate < initDate || c.checkDate > pointDate) return false;
    const isAlreadyInTxs = transactions.some(
      (t) =>
        t.id === c.id ||
        (t.type === 'balance_adjustment' &&
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
 * Spočítá stav investičního / penzijního účtu k přesnému datu pointDate.
 * Používá nejnovější tržní snapshot k danému dni + uskutečněné převody po tomto datu.
 * Korekce zůstatku se na investiční/penzijní účty neaplikují.
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
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));

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

  // Uskutečněné převody po ocenění
  for (const t of transactions) {
    if (t.status !== 'executed' || t.type !== 'transfer') continue;
    if (hasValuation) {
      if (t.date <= valDate || t.date > pointDate) continue;
    } else {
      if (t.date < initDate || t.date > pointDate) continue;
    }

    const amt = t.actualAmountInHaler !== undefined ? t.actualAmountInHaler : t.amountInHaler;
    if (t.targetAccountId === acc.id) baseVal = addHaler(baseVal, amt);
    if (t.sourceAccountId === acc.id) baseVal = subHaler(baseVal, amt);
  }

  return baseVal;
}

/**
 * Spočítá celkové jmění (nebo zůstatek vybraného účtu) k danému datu.
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
    // Převody a korekce se NIKDY nezapočítávají do příjmů ani výdajů
    if (t.type === 'transfer' || t.type === 'balance_adjustment') continue;

    const amt = t.actualAmountInHaler !== undefined ? t.actualAmountInHaler : t.amountInHaler;

    if (t.type === 'income') {
      totalIncomeInHaler = addHaler(totalIncomeInHaler, amt);
    } else if (t.type === 'expense') {
      totalExpenseInHaler = addHaler(totalExpenseInHaler, amt);
    }
  }

  const netChangeInHaler = subHaler(totalIncomeInHaler, totalExpenseInHaler);

  // Míra úspor v %: (příjmy - výdaje) / příjmy * 100
  const savingsRate =
    totalIncomeInHaler > 0
      ? ((totalIncomeInHaler - totalExpenseInHaler) / totalIncomeInHaler) * 100
      : null;

  const totalMonthsCount = Math.max(1, range.months.length);
  const avgMonthlyExpenseInHaler = Math.round(totalExpenseInHaler / totalMonthsCount);

  // Změna celkového jmění = stav ke konci období - stav na začátku období
  // Stav na začátku = stav k předcházejícímu dni před startem období
  const startDay = range.startDate;
  const prevDayDate = new Date(startDay);
  prevDayDate.setDate(prevDayDate.getDate() - 1);
  const prevDayStr = prevDayDate.toISOString().slice(0, 10);

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

  const hasPartialCurrentMonth = range.months.some((m) => m.isCurrentMonth);

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
 * Spočítá měsíční cash flow (příjmy, výdaje, čistá změna) pro hlavní sloupcový graf.
 */
export function calculateMonthlyCashFlow(
  months: CalendarMonthInfo[],
  filteredTxs: Transaction[]
): MonthlyCashFlowPoint[] {
  return months.map((m) => {
    let incomeInHaler = 0;
    let expenseInHaler = 0;

    for (const t of filteredTxs) {
      if (t.type === 'transfer' || t.type === 'balance_adjustment') continue;
      if (t.date >= m.startDate && t.date <= m.endDate) {
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
      monthKey: m.key,
      label: m.label,
      shortLabel: m.shortLabel,
      incomeInHaler,
      expenseInHaler,
      netChangeInHaler,
      savingsRate,
      isCurrentMonth: m.isCurrentMonth,
    };
  });
}

/**
 * Spočítá rozpad kategorií (výdaje nebo příjmy) seřazený sestupně podle částky
 * a při shodě abecedně A–Z podle českého řazení.
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

  // Mapa kategorií podle ID pro rychlé dohledání
  const catMap = new Map<string, Category>();
  for (const c of categories) {
    catMap.set(c.id, c);
  }

  // Struktura pro agregaci: mainCatId -> { total, subMap: subId -> total }
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
        // t.categoryId byla podkategorie
        const parent = catMap.get(cat.parentId);
        mainCatId = cat.parentId;
        mainCatName = parent ? parent.name : 'Neznámá kategorie';
        mainColor = parent ? parent.color : cat.color;
        mainIcon = parent ? parent.icon : cat.icon;
        subId = cat.id;
        subName = cat.name;
      } else {
        // t.categoryId byla hlavní kategorie
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

  // Převod na výsledné pole a řazení
  const result: CategoryBreakdownItem[] = [];

  for (const [id, data] of mainAgg.entries()) {
    if (data.total <= 0) continue; // Nezobrazovat kategorie s nulovou částkou

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

    // Řadit podkategorie: částka sestupně, pak abecedně A–Z
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

  // Řadit hlavní kategorie: částka sestupně, pak abecedně A–Z
  result.sort((a, b) => {
    if (b.totalInHaler !== a.totalInHaler) {
      return b.totalInHaler - a.totalInHaler;
    }
    return czechStringCompare(a.name, b.name);
  });

  return result;
}

/**
 * Spočítá vývoj celkového jmění a jeho 4 skupin v jednotlivých kalendářních měsících.
 */
export function calculateNetWorthHistory(
  months: CalendarMonthInfo[],
  accounts: Account[],
  transactions: Transaction[],
  corrections: BalanceCorrection[],
  snapshots: MarketValueSnapshot[],
  filterAccountId?: string | null
): NetWorthHistoryPoint[] {
  return months.map((m) => {
    const pointDate = m.endDate;
    const nw = calculateNetWorthAtDate(
      accounts,
      pointDate,
      transactions,
      corrections,
      snapshots,
      filterAccountId
    );

    return {
      monthKey: m.key,
      label: m.label,
      date: pointDate,
      checkingAndCashInHaler: nw.checkingAndCashInHaler,
      savingsInHaler: nw.savingsInHaler,
      investmentsInHaler: nw.investmentsInHaler,
      pensionInHaler: nw.pensionInHaler,
      totalNetWorthInHaler: nw.totalNetWorthInHaler,
      isCurrentMonth: m.isCurrentMonth,
    };
  });
}

/**
 * Spočítá meziměsíční změnu výdajů (trend).
 * U probíhajícího neúplného měsíce provede srovnání na shodný počet dní v předchozím měsíci.
 */
export function calculateExpenseMoMTrend(
  months: CalendarMonthInfo[],
  allExecutedTxs: Transaction[],
  filters: AnalyticsFilters = {},
  categories: Category[] = [],
  todayStr: string = getTodayInPrague()
): ExpenseTrendItem[] {
  const result: ExpenseTrendItem[] = [];

  // Pomocná funkce pro výpočet výdajů v daném intervalu
  const getExpensesInInterval = (startDate: string, endDate: string): number => {
    let sum = 0;
    for (const t of allExecutedTxs) {
      if (t.status !== 'executed' || t.type !== 'expense') continue;
      if (t.date > todayStr) continue;
      if (t.date >= startDate && t.date <= endDate) {
        // Filtr účtu
        if (filters.accountId && t.sourceAccountId !== filters.accountId && t.targetAccountId !== filters.accountId) {
          continue;
        }
        // Filtr kategorie
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

  for (let i = 0; i < months.length; i++) {
    const curMonth = months[i];
    const curExpenses = getExpensesInInterval(curMonth.startDate, curMonth.endDate);

    let prevMonthExpenses: number | null = null;
    let isSameDayComparison = false;

    // Najdeme předchozí měsíc v čase (i když není v months, odvodíme jej)
    let prevY = curMonth.year;
    let prevM = curMonth.month - 1;
    if (prevM < 1) {
      prevM = 12;
      prevY -= 1;
    }
    const prevKey = getPeriodKey(prevY, prevM);
    const prevTotalDays = getDaysInMonth(prevY, prevM);

    if (curMonth.isCurrentMonth) {
      // Pro neúplný aktuální měsíc porovnáváme shodný počet dní
      const todayDay = Number(todayStr.split('-')[2]);
      const compareDay = Math.min(todayDay, prevTotalDays);
      const prevStartDate = `${prevKey}-01`;
      const prevEndDate = `${prevKey}-${String(compareDay).padStart(2, '0')}`;
      prevMonthExpenses = getExpensesInInterval(prevStartDate, prevEndDate);
      isSameDayComparison = true;
    } else {
      // Celý předchozí měsíc
      const prevStartDate = `${prevKey}-01`;
      const prevEndDate = `${prevKey}-${String(prevTotalDays).padStart(2, '0')}`;
      prevMonthExpenses = getExpensesInInterval(prevStartDate, prevEndDate);
    }

    let changePercent: number | null = null;
    if (prevMonthExpenses !== null && prevMonthExpenses > 0) {
      changePercent = ((curExpenses - prevMonthExpenses) / prevMonthExpenses) * 100;
    }

    result.push({
      monthKey: curMonth.key,
      label: curMonth.label,
      expenseInHaler: curExpenses,
      prevMonthExpenseInHaler: prevMonthExpenses,
      changePercent,
      isCurrentMonth: curMonth.isCurrentMonth,
      isSameDayComparison,
    });
  }

  return result;
}

/**
 * Vrátí 10 nejvyšších uskutečněných výdajových položek ve vybraném období.
 * Nezahrnuje převody ani korekce.
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
 * Spočítá finanční extrémy a průměry (nejlepší/nejhorší měsíc, nejvyšší příjem/výdaj atd.).
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
