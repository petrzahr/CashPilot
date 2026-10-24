import { Account, BalanceCorrection, BudgetPeriod, MarketValueSnapshot, Transaction } from '../types/finance';
import {
  createBudgetPeriod,
  generatePeriodsBetween,
  getOverviewPeriods,
  getPeriodForDate,
  getTodayInPrague,
  normalizeStartDay,
} from './periodService';

/**
 * Výběr rozsahu období ve filtru Budoucnost/Historie (Majetek, Analýza a trendy):
 * počet měsíců dopředu či dozadu včetně aktuálního období, nebo předvolba
 * "Tento rok" (ytd), "Celá historie" (all) či vlastní rozsah od–do (klíče YYYY-MM).
 */
export type DualPeriodRange = {
  direction: 'future' | 'past';
  months?: 3 | 6 | 12 | 18 | 24;
  preset?: 'ytd' | 'all' | 'custom';
  from?: string;
  to?: string;
};

export interface PeriodRangeData {
  accounts: Account[];
  transactions: Transaction[];
  corrections: BalanceCorrection[];
  snapshots: MarketValueSnapshot[];
}

/**
 * Datum nejstaršího relevantního záznamu: počáteční zůstatek účtu, provedená položka,
 * korekce nebo ocenění. Bez záznamů vrací dnešek.
 */
export function getEarliestActivityDate(data: Partial<PeriodRangeData>, todayStr: string = getTodayInPrague()): string {
  let earliest = todayStr;
  for (const a of data.accounts || []) {
    if (a.initialBalanceDate && a.initialBalanceDate < earliest) earliest = a.initialBalanceDate;
  }
  for (const t of data.transactions || []) {
    if (t.status === 'executed' && t.date && t.date < earliest) earliest = t.date;
  }
  for (const c of data.corrections || []) {
    if (c.checkDate && c.checkDate < earliest) earliest = c.checkDate;
  }
  for (const s of data.snapshots || []) {
    if (s.date && s.date < earliest) earliest = s.date;
  }
  return earliest;
}

/**
 * Rozpočtová období vybraného rozsahu, vzestupně, vztažená k zadanému aktuálnímu období.
 * - měsíce: N období dopředu nebo dozadu, vždy včetně aktuálního,
 * - ytd: od lednového období aktuálního roku po aktuální období,
 * - all: od období nejstaršího záznamu po aktuální období,
 * - custom: od–do včetně (obrácené pořadí se prohodí); bez obou hranic jako 12 měsíců dozadu.
 */
export function resolvePeriodRange(
  range: DualPeriodRange,
  options: { current: BudgetPeriod; startDay?: number; data?: Partial<PeriodRangeData> }
): BudgetPeriod[] {
  const { current } = options;
  const startDay = normalizeStartDay(options.startDay);
  const fromKey = (key: string) => {
    const [y, m] = key.split('-').map(Number);
    return createBudgetPeriod(y, m, startDay);
  };

  if (range.preset === 'custom') {
    if (range.from && range.to) return generatePeriodsBetween(fromKey(range.from), fromKey(range.to));
    return getOverviewPeriods(current, { direction: 'past', months: 12 }, startDay);
  }
  if (range.preset === 'ytd') {
    return generatePeriodsBetween(createBudgetPeriod(current.year, 1, startDay), current);
  }
  if (range.preset === 'all') {
    // Bez starších záznamů začíná historie aktuálním obdobím
    const earliest = getPeriodForDate(getEarliestActivityDate(options.data ?? {}, current.startDate), startDay);
    return generatePeriodsBetween(earliest, current);
  }
  return getOverviewPeriods(current, { direction: range.direction, months: range.months || 12 }, startDay);
}
