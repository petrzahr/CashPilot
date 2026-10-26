import {
  Account,
  BalanceCorrection,
  BudgetPeriod,
  Category,
  ForecastResult,
  MarketValueSnapshot,
  Transaction,
} from '../types/finance';
import { addHaler, subHaler } from './currencyService';
import {
  CZECH_MONTHS,
  CZECH_MONTHS_SHORT,
  createBudgetPeriod,
  getPreviousPeriod,
  getNextPeriod,
  formatCzechDate,
  getTodayInPrague,
  isDateInPeriod,
} from './periodService';
import { sortAccountsByOrder } from './accountService';
import { getDefaultAccount, getEffectiveAmountInHaler } from './accountScope';
import { getAccountBalanceAtDate } from './accountBalance';
import { isRemainingPlanned } from './financialEngine';
import { getAccountPlannedFlows } from './overviewRows';

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
  startDate: string;      // YYYY-MM-DD
  endDate: string;        // YYYY-MM-DD (až do todayStr u probíhajícího)
  fromPeriodKey: string;  // YYYY-MM
  toPeriodKey: string;    // YYYY-MM
  periods: BudgetPeriodInfo[];
}

export interface CashFlowAmounts {
  incomeInHaler: number;
  expenseInHaler: number;
  /** Příjmy − výdaje + korekce */
  actuallySavedInHaler: number;
}

/** Příjmy, výdaje a Skutečně uspořeno výchozího účtu za období (shodné s KPI Měsíčního rozpočtu). */
export interface MonthlyCashFlowPoint extends CashFlowAmounts {
  monthKey: string;
  label: string;
  shortLabel: string;
  dateRangeStr: string;
  /** Korekce výchozího účtu; jsou součástí Skutečně uspořeno a vždy uskutečněné */
  correctionsInHaler: number;
  /** Část hodnot z položek, které se ještě neuskutečnily */
  planned: CashFlowAmounts;
  hasPlanned: boolean;
  isCurrentMonth: boolean;
  /** Období skončilo před dneškem */
  isClosed: boolean;
}

export interface PortfolioCompositionSegment {
  key: string;            // accountId
  label: string;          // název konkrétního účtu
  color: string;
  balanceInHaler: number;
  pct: number | null;     // % podíl na celkovém majetku daného období (null, pokud total === 0)
  /** Část pct z plánovaných položek (jen přírůstek proti dnešku), kreslí se šrafovaně */
  plannedPct?: number;
  /** Dnešní stav a plánovaná změna ke konci období (probíhající a budoucí období) */
  split?: { executedLabel: string; executedInHaler: number; plannedInHaler: number; correctionsInHaler: number };
}

export interface PortfolioCompositionPoint {
  periodKey: string;
  periodLabel: string;
  periodShortLabel: string;
  dateRangeStr: string;
  totalNetWorthInHaler: number;
  isCurrentMonth: boolean;
  /** Konečné stavy zahrnují plánované položky některého z účtů */
  hasPlanned: boolean;
  segments: PortfolioCompositionSegment[];
}

export interface CashFlowCompositionSegment {
  key: 'income' | 'expense' | 'actuallySaved';
  label: string;
  color: string;
  amountInHaler: number;
  pct: number | null;     // % podíl na součtu absolutních hodnot všech tří ukazatelů (null, pokud je součet 0)
  /** Šrafovaná (plánovaná) část pct se stejným znaménkem; 0 = celý segment plný */
  plannedPct: number;
  /** Rozpad částky pro tooltip */
  split: { executedLabel: string; executedInHaler: number; plannedInHaler: number; correctionsInHaler: number };
}

export interface CashFlowCompositionPoint {
  periodKey: string;
  periodLabel: string;
  periodShortLabel: string;
  dateRangeStr: string;
  isCurrentMonth: boolean;
  hasPlanned: boolean;
  segments: CashFlowCompositionSegment[];
}

export interface ExpenseTrendItem {
  monthKey: string;
  label: string;
  dateRangeStr: string;
  expenseInHaler: number;
  /** Plánovaná část výdajů období */
  plannedExpenseInHaler: number;
  /** Výdaje celého předchozího období; null mimo rozsah předpovědi */
  prevMonthExpenseInHaler: number | null;
  changePercent: number | null;
  isCurrentMonth: boolean;
}

export interface FinancialExtremePeriod {
  monthKey: string;
  label: string;
  amountInHaler: number;
}

/** Extrémy a průměry jen z uzavřených období (konec před dneškem). */
export interface FinancialExtremes {
  highestIncomeMonth: FinancialExtremePeriod | null;
  highestExpenseMonth: FinancialExtremePeriod | null;
  mostSavedMonth: FinancialExtremePeriod | null;
  leastSavedMonth: FinancialExtremePeriod | null;
  avgMonthlyIncomeInHaler: number;
  avgMonthlyActuallySavedInHaler: number;
  closedPeriodCount: number;
}

export interface TopExpenseItem {
  transaction: Transaction;
  amountInHaler: number;
  /** Položka se ještě neuskutečnila (plánovaná nebo s budoucím datem) */
  isPlanned: boolean;
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
  const shortLabel = `${CZECH_MONTHS_SHORT[period.month - 1]} ${period.year}`;

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
  todayStr: string = getTodayInPrague()
): BudgetPeriodInfo[] {
  const result: BudgetPeriodInfo[] = [];
  let cur: BudgetPeriod = startPeriod;

  while (cur.key <= endPeriod.key) {
    result.push(createBudgetPeriodInfo(cur, todayStr));
    if (cur.key === endPeriod.key) break;
    cur = getNextPeriod(cur);
  }

  return result;
}

/**
 * Rozsah dat pro analytické výpočty z vybraných období: od začátku prvního období po konec
 * analýzy posledního (u probíhajícího období dnešek).
 */
export function toAnalyticsDateRange(periods: BudgetPeriodInfo[], todayStr: string = getTodayInPrague()): AnalyticsDateRange {
  const first = periods[0];
  const last = periods[periods.length - 1];
  return {
    startDate: first ? first.startDate : todayStr,
    endDate: last ? last.analysisEndDate : todayStr,
    fromPeriodKey: first ? first.key : '',
    toPeriodKey: last ? last.key : '',
    periods,
  };
}

/**
 * Příjmy, výdaje a Skutečně uspořeno výchozího účtu po rozpočtových obdobích - jediný zdroj čísel
 * celé Analýzy. Bere souhrn období z předpovědi (PeriodView.defaultAccount, tedy uskutečněné
 * i plánované položky včetně opakovaných výskytů, shodně s KPI Měsíčního rozpočtu) a jeho
 * rozdělení na uskutečněnou a plánovanou část (PeriodView.defaultAccountSplit).
 * Období mimo předpověď a bez výchozího účtu jsou nulová.
 */
export function calculateMonthlyCashFlow(
  periods: BudgetPeriodInfo[],
  forecast: ForecastResult,
  todayStr: string = getTodayInPrague()
): MonthlyCashFlowPoint[] {
  return periods.map((p) => {
    const view = forecast.getPeriod(p.key);
    const totals = view?.defaultAccount;
    const planned = view?.defaultAccountSplit.planned;

    return {
      monthKey: p.key,
      label: p.label,
      shortLabel: p.shortLabel,
      dateRangeStr: p.dateRangeStr,
      incomeInHaler: totals?.incomeInHaler ?? 0,
      expenseInHaler: totals?.expenseInHaler ?? 0,
      actuallySavedInHaler: totals?.actuallySavedInHaler ?? 0,
      correctionsInHaler: view?.defaultAccountSplit.executed.correctionsInHaler ?? 0,
      planned: {
        incomeInHaler: planned?.incomeInHaler ?? 0,
        expenseInHaler: planned?.expenseInHaler ?? 0,
        actuallySavedInHaler: planned?.actuallySavedInHaler ?? 0,
      },
      hasPlanned: !!planned && (planned.incomeInHaler !== 0 || planned.expenseInHaler !== 0),
      isCurrentMonth: p.isCurrentPeriod,
      isClosed: p.endDate < todayStr,
    };
  });
}

/** Součet absolutních hodnot částek - základna (= 100 %) pro skládané % grafy. */
function sumAbsoluteHaler(amounts: number[]): number {
  return amounts.reduce((sum, a) => addHaler(sum, Math.abs(a)), 0);
}

function toSharePct(amountInHaler: number, baseInHaler: number): number | null {
  return baseInHaler !== 0 ? (amountInHaler / baseInHaler) * 100 : null;
}

export const CASH_FLOW_COMPOSITION_COLORS = {
  income: '#10b981',
  expense: '#ef4444',
  actuallySaved: '#0284c7',
} as const;

/**
 * Spočítá procentuální rozložení Příjmy / Výdaje / Skutečně uspořeno podle rozpočtových
 * period z calculateMonthlyCashFlow (shodné se souhrnnými ukazateli Měsíčního rozpočtu).
 * Základna pro % (= 100 %) je součet absolutních hodnot všech tří ukazatelů, záporné
 * "Skutečně uspořeno" tak jde pod nulu. Plánovaná část příjmů a výdajů je v plannedPct;
 * "Skutečně uspořeno" období s plánovanými položkami je celé plánované (odhad ke konci období),
 * protože uskutečněná a plánovaná část mohou mít opačné znaménko.
 */
export function calculateCashFlowComposition(
  periods: BudgetPeriodInfo[],
  forecast: ForecastResult,
  todayStr: string = getTodayInPrague()
): CashFlowCompositionPoint[] {
  return calculateMonthlyCashFlow(periods, forecast, todayStr).map((cf) => {
    const base = sumAbsoluteHaler([cf.incomeInHaler, cf.expenseInHaler, cf.actuallySavedInHaler]);

    const flowSegment = (
      key: 'income' | 'expense',
      label: string,
      amountInHaler: number,
      plannedInHaler: number
    ): CashFlowCompositionSegment => {
      const pct = toSharePct(amountInHaler, base);
      return {
        key, label, color: CASH_FLOW_COMPOSITION_COLORS[key], amountInHaler, pct,
        plannedPct: pct !== null && amountInHaler !== 0 ? pct * (plannedInHaler / amountInHaler) : 0,
        split: { executedLabel: 'uskutečněno', executedInHaler: subHaler(amountInHaler, plannedInHaler), plannedInHaler, correctionsInHaler: 0 },
      };
    };

    const savedPct = toSharePct(cf.actuallySavedInHaler, base);
    return {
      periodKey: cf.monthKey,
      periodLabel: cf.label,
      periodShortLabel: cf.shortLabel,
      dateRangeStr: cf.dateRangeStr,
      isCurrentMonth: cf.isCurrentMonth,
      hasPlanned: cf.hasPlanned,
      segments: [
        flowSegment('income', 'Příjmy', cf.incomeInHaler, cf.planned.incomeInHaler),
        flowSegment('expense', 'Výdaje', cf.expenseInHaler, cf.planned.expenseInHaler),
        {
          key: 'actuallySaved', label: 'Skutečně uspořeno', color: CASH_FLOW_COMPOSITION_COLORS.actuallySaved,
          amountInHaler: cf.actuallySavedInHaler, pct: savedPct,
          plannedPct: cf.hasPlanned ? savedPct ?? 0 : 0,
          split: {
            executedLabel: 'dosud',
            executedInHaler: subHaler(cf.actuallySavedInHaler, cf.planned.actuallySavedInHaler),
            plannedInHaler: cf.planned.actuallySavedInHaler,
            correctionsInHaler: cf.correctionsInHaler,
          },
        },
      ],
    };
  });
}

/**
 * Spočítá procentuální rozložení celkového majetku (podíl jednotlivých účtů na celkovém
 * majetku) podle rozpočtových period. Úplně všechny způsobilé účty (běžné, hotovostní,
 * "jiné", spořicí, penzijní i investiční) se zobrazují jako samostatné segmenty se svou
 * vlastní barvou. Pořadí i barvy segmentů odpovídají pořadí a barvám účtů v sekci Účty
 * (sortAccountsByOrder), konzistentně napříč obdobími. Základna pro % (= 100 %) je součet
 * ABSOLUTNÍCH hodnot všech zůstatků, takže kladná a záporná strana dohromady dávají vždy
 * přesně 100 % (např. účet na -15 % => kladné účty sahají jen do 85 %).
 * Minulá období ukazují skutečný stav ke konci období; probíhající a budoucí období berou
 * projektovaný konečný stav účtu z forecastu (shodný se sekcí Majetek a "Konečným stavem"
 * v Měsíčním rozpočtu), jinak by ukazovala jen dnešní stav. Jejich plánovaná část je změna
 * od dnešního stavu ke konci období; šrafuje se jen přírůstek ve směru zůstatku, úbytek je
 * vidět jen v tooltipu (segment je už menší a „chybějící“ část nemá kde ležet).
 */
export function calculatePortfolioComposition(
  periods: BudgetPeriodInfo[],
  accounts: Account[],
  transactions: Transaction[],
  corrections: BalanceCorrection[],
  snapshots: MarketValueSnapshot[],
  forecast?: ForecastResult,
  todayStr: string = getTodayInPrague()
): PortfolioCompositionPoint[] {
  const eligibleAccounts = sortAccountsByOrder(accounts).filter(
    (a) => a.isNetWorth && a.status === 'active'
  );
  // Dnešní stav účtů (jen provedené položky) z probíhajícího období forecastu
  const actual = forecast?.currentPeriod && forecast.getPeriod(forecast.currentPeriod.key)?.actual;

  return periods.map((p) => {
    const pointDate = p.analysisEndDate;
    const view = forecast && p.endDate >= todayStr ? forecast.getPeriod(p.key) : undefined;
    const projected = view?.projected;
    const hasPlanned = !!view && eligibleAccounts.some((acc) => {
      const planned = getAccountPlannedFlows(view.items, acc, todayStr);
      return planned.incomeInHaler !== 0 || planned.expenseInHaler !== 0 || planned.netTransfersInHaler !== 0;
    });

    const rawSegments = eligibleAccounts.map((acc) => {
      const balanceInHaler =
        projected?.accountBalances[acc.id]?.closingBalanceInHaler ??
        getAccountBalanceAtDate(acc, pointDate, { transactions, corrections, snapshots });

      return { key: acc.id, label: acc.name, color: acc.color, balanceInHaler };
    });

    const totalNetWorthInHaler = rawSegments.reduce(
      (sum, s) => addHaler(sum, s.balanceInHaler),
      0
    );

    const pctBaseInHaler = sumAbsoluteHaler(rawSegments.map((s) => s.balanceInHaler));
    const segments: PortfolioCompositionSegment[] = rawSegments.map((s) => {
      const pct = toSharePct(s.balanceInHaler, pctBaseInHaler);
      const nowInHaler = view && actual ? actual.accountBalances[s.key] ?? 0 : undefined;
      if (nowInHaler === undefined) return { ...s, pct };
      // Plánovaná část = změna od dnešního stavu ke konci období; šrafuje se jen ta, která segment zvětšuje
      const plannedInHaler = subHaler(s.balanceInHaler, nowInHaler);
      const grows = s.balanceInHaler !== 0 && Math.sign(plannedInHaler) === Math.sign(s.balanceInHaler);
      return {
        ...s,
        pct,
        plannedPct: pct !== null && grows ? pct * Math.min(plannedInHaler / s.balanceInHaler, 1) : 0,
        split: { executedLabel: 'teď', executedInHaler: nowInHaler, plannedInHaler, correctionsInHaler: 0 },
      };
    });

    return {
      periodKey: p.key,
      periodLabel: p.label,
      periodShortLabel: p.shortLabel,
      dateRangeStr: p.dateRangeStr,
      totalNetWorthInHaler,
      isCurrentMonth: p.isCurrentPeriod,
      hasPlanned,
      segments,
    };
  });
}

/**
 * Spočítá meziměsíční trend výdajů výchozího účtu mezi rozpočtovými obdobími z předpovědi.
 * Každé období (i probíhající a budoucí, včetně plánu) srovnává s celým předchozím obdobím.
 */
export function calculateExpenseMoMTrend(
  periods: BudgetPeriodInfo[],
  forecast: ForecastResult
): ExpenseTrendItem[] {
  return periods.map((p) => {
    const view = forecast.getPeriod(p.key);
    const expenseInHaler = view?.defaultAccount.expenseInHaler ?? 0;
    const prevView = forecast.getPeriod(getPreviousPeriod(p.period).key);
    const prevMonthExpenseInHaler = prevView ? prevView.defaultAccount.expenseInHaler : null;

    return {
      monthKey: p.key,
      label: p.label,
      dateRangeStr: p.dateRangeStr,
      expenseInHaler,
      plannedExpenseInHaler: view?.defaultAccountSplit.planned.expenseInHaler ?? 0,
      prevMonthExpenseInHaler,
      changePercent:
        prevMonthExpenseInHaler !== null && prevMonthExpenseInHaler > 0
          ? ((expenseInHaler - prevMonthExpenseInHaler) / prevMonthExpenseInHaler) * 100
          : null,
      isCurrentMonth: p.isCurrentPeriod,
    };
  });
}

/**
 * Vrátí 10 nejvyšších výdajů výchozího účtu ve vybraných obdobích z efektivních položek předpovědi
 * (uskutečněné i plánované včetně opakovaných výskytů, bez zrušených a bez položek před aktivací účtu),
 * tedy z týchž položek jako výdaje v souhrnu období.
 */
export function getTopExpenses(
  periods: BudgetPeriodInfo[],
  forecast: ForecastResult,
  accounts: Account[],
  categories: Category[],
  todayStr: string = getTodayInPrague()
): TopExpenseItem[] {
  const defaultAccount = getDefaultAccount(accounts);
  if (!defaultAccount) return [];
  const activeFrom = defaultAccount.initialBalanceDate;

  const expenseTxs = periods.flatMap((p) =>
    (forecast.getPeriod(p.key)?.items ?? []).filter(
      (t) =>
        t.type === 'expense' &&
        t.status !== 'cancelled' &&
        t.sourceAccountId === defaultAccount.id &&
        !(activeFrom && t.date < activeFrom)
    )
  );

  const sorted = [...expenseTxs].sort((a, b) => getEffectiveAmountInHaler(b) - getEffectiveAmountInHaler(a));

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
      amountInHaler: getEffectiveAmountInHaler(tx),
      isPlanned: isRemainingPlanned(tx, todayStr),
      accountName: acc ? acc.name : 'Neznámý účet',
      categoryName,
      subcategoryName,
    };
  });
}

/**
 * Finanční extrémy a průměry jen z uzavřených období (konec před dneškem): probíhající a budoucí
 * období ještě obsahují plán, takže by extrém i průměr zkreslovala. Čistá bilance je Skutečně
 * uspořeno (příjmy − výdaje + korekce), shodně s Měsíčním rozpočtem.
 */
export function calculateFinancialExtremes(
  monthlyCashFlow: MonthlyCashFlowPoint[]
): FinancialExtremes {
  const closed = (monthlyCashFlow ?? []).filter((m) => m.isClosed);

  const pick = (
    value: (m: MonthlyCashFlowPoint) => number,
    better: (a: number, b: number) => boolean
  ): FinancialExtremePeriod | null => {
    let best: MonthlyCashFlowPoint | null = null;
    for (const m of closed) {
      if (!best || better(value(m), value(best))) best = m;
    }
    return best ? { monthKey: best.monthKey, label: best.label, amountInHaler: value(best) } : null;
  };
  const average = (value: (m: MonthlyCashFlowPoint) => number) =>
    closed.length > 0 ? Math.round(closed.reduce((sum, m) => addHaler(sum, value(m)), 0) / closed.length) : 0;

  const income = (m: MonthlyCashFlowPoint) => m.incomeInHaler;
  const expense = (m: MonthlyCashFlowPoint) => m.expenseInHaler;
  const saved = (m: MonthlyCashFlowPoint) => m.actuallySavedInHaler;
  const higher = (a: number, b: number) => a > b;
  const lower = (a: number, b: number) => a < b;

  return {
    highestIncomeMonth: pick(income, higher),
    highestExpenseMonth: pick(expense, higher),
    mostSavedMonth: pick(saved, higher),
    leastSavedMonth: pick(saved, lower),
    avgMonthlyIncomeInHaler: average(income),
    avgMonthlyActuallySavedInHaler: average(saved),
    closedPeriodCount: closed.length,
  };
}

