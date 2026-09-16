import { BudgetPeriod } from '../types/finance';

export const CZECH_MONTHS = [
  'Leden',
  'Únor',
  'Březen',
  'Duben',
  'Květen',
  'Červen',
  'Červenec',
  'Srpen',
  'Září',
  'Říjen',
  'Listopad',
  'Prosinec'
];

/**
 * Převede datum YYYY-MM-DD nebo Date na formát "15. 9. 2026"
 */
export function formatCzechDate(dateInput: string | Date): string {
  if (!dateInput) return '';
  if (typeof dateInput === 'string') {
    const parts = dateInput.split('-');
    if (parts.length === 3) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const d = parseInt(parts[2], 10);
      if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
        return `${d}. ${m}. ${y}`;
      }
    }
    const date = new Date(dateInput);
    return `${date.getDate()}. ${date.getMonth() + 1}. ${date.getFullYear()}`;
  }
  return `${dateInput.getDate()}. ${dateInput.getMonth() + 1}. ${dateInput.getFullYear()}`;
}

/**
 * Zformátuje rozsah periody, např. "15. 9. 2026 – 14. 10. 2026"
 */
export function formatPeriodRange(period: BudgetPeriod): string {
  return `${formatCzechDate(period.startDate)} – ${formatCzechDate(period.endDate)}`;
}

/**
 * Vrátí počet dní v daném měsíci (1-12) a roce
 */
export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Pomocná funkce pro převod roku a měsíce na klíč YYYY-MM
 */
export function getPeriodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Vrátí datum o jeden den předcházející zadanému datu YYYY-MM-DD.
 * Využívá UTC pro eliminaci vlivu časových posunů a DST.
 */
export function getPreviousDayString(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - 1);
  const prevY = date.getUTCFullYear();
  const prevM = String(date.getUTCMonth() + 1).padStart(2, '0');
  const prevD = String(date.getUTCDate()).padStart(2, '0');
  return `${prevY}-${prevM}-${prevD}`;
}

/**
 * Vrátí přesné počáteční datum periody pro zadaný rok, měsíc a počáteční den (1–31).
 * Pokud vybraný den v daném měsíci neexistuje (např. 31. únor),
 * použije se poslední kalendářní den tohoto měsíce.
 */
export function getPeriodStartDate(year: number, month: number, startDay: number = 15): string {
  const safeStartDay = Math.max(1, Math.min(31, Math.round(startDay || 15)));
  const daysInMonth = getDaysInMonth(year, month);
  const actualDay = Math.min(safeStartDay, daysInMonth);
  return `${year}-${String(month).padStart(2, '0')}-${String(actualDay).padStart(2, '0')}`;
}

/**
 * Vypočítá počáteční a koncové datum rozpočtové periody pro zadaný rok, měsíc a startovní den (1–31).
 * Konec období je vždy přesně kalendářní den před začátkem následujícího období,
 * čímž je zaručena souvislá časová osa bez mezer a bez překryvů.
 */
export function createBudgetPeriod(year: number, month: number, startDay: number = 15): BudgetPeriod {
  const safeStartDay = Math.max(1, Math.min(31, Math.round(startDay || 15)));
  const startDate = getPeriodStartDate(year, month, safeStartDay);

  let nextMonth = month + 1;
  let nextYear = year;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear = year + 1;
  }

  const nextStartDate = getPeriodStartDate(nextYear, nextMonth, safeStartDay);
  const endDate = getPreviousDayString(nextStartDate);

  return {
    key: getPeriodKey(year, month),
    name: `${CZECH_MONTHS[month - 1]} ${year}`,
    year,
    month,
    startDate,
    endDate
  };
}

/**
 * Určí, do které rozpočtové periody spadá dané datum (YYYY-MM-DD) při zadaném startovním dni (1–31).
 * Porovná datum se začátkem periody v daném kalendářním měsíci:
 * - Pokud je datum >= startDate(rok, měsíc), spadá do periody tohoto měsíce.
 * - Pokud je datum < startDate(rok, měsíc), spadá do předchozí periody.
 */
export function getPeriodForDate(dateStr: string, startDay: number = 15): BudgetPeriod {
  const safeStartDay = Math.max(1, Math.min(31, Math.round(startDay || 15)));
  const parts = dateStr.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);

  const monthStartDate = getPeriodStartDate(y, m, safeStartDay);

  let periodYear = y;
  let periodMonth = m;

  if (dateStr < monthStartDate) {
    periodMonth = m - 1;
    if (periodMonth < 1) {
      periodMonth = 12;
      periodYear = y - 1;
    }
  }

  return createBudgetPeriod(periodYear, periodMonth, safeStartDay);
}

/**
 * Zkontroluje, zda datum spadá do dané periody
 */
export function isDateInPeriod(dateStr: string, period: BudgetPeriod): boolean {
  return dateStr >= period.startDate && dateStr <= period.endDate;
}

/**
 * Vygeneruje sekvenci N period od zadané výchozí periody.
 * Zvládá automaticky přechod přes konec roku (např. Září 2026 -> Srpen 2027).
 */
export function generatePeriodsSequence(
  startYear: number, 
  startMonth: number, 
  count: number = 12, 
  startDay: number = 15
): BudgetPeriod[] {
  const periods: BudgetPeriod[] = [];
  let curYear = startYear;
  let curMonth = startMonth;

  for (let i = 0; i < count; i++) {
    periods.push(createBudgetPeriod(curYear, curMonth, startDay));
    curMonth++;
    if (curMonth > 12) {
      curMonth = 1;
      curYear++;
    }
  }

  return periods;
}

/**
 * Vygeneruje souvislou sekvenci rozpočtových period mezi dvěma periodami (včetně obou).
 * Zaručuje nepřetržitou časovou osu bez mezer a překryvů.
 */
export function generatePeriodsBetween(
  startPeriod: BudgetPeriod,
  endPeriod: BudgetPeriod,
  startDay: number = 15
): BudgetPeriod[] {
  let first = startPeriod;
  let last = endPeriod;
  if (first.startDate > last.startDate) {
    first = endPeriod;
    last = startPeriod;
  }

  const count = (last.year - first.year) * 12 + (last.month - first.month) + 1;
  return generatePeriodsSequence(first.year, first.month, count, startDay);
}

/**
 * Získá následující nebo předchozí periodu
 */
export function getNextPeriod(period: BudgetPeriod, startDay: number = 15): BudgetPeriod {
  let nextMonth = period.month + 1;
  let nextYear = period.year;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear++;
  }
  return createBudgetPeriod(nextYear, nextMonth, startDay);
}

export function getPreviousPeriod(period: BudgetPeriod, startDay: number = 15): BudgetPeriod {
  let prevMonth = period.month - 1;
  let prevYear = period.year;
  if (prevMonth < 1) {
    prevMonth = 12;
    prevYear--;
  }
  return createBudgetPeriod(prevYear, prevMonth, startDay);
}

export interface OverviewRange {
  direction: 'future' | 'past';
  months: 3 | 6 | 12 | 18 | 24;
}

/** Like Analytics presets, both directions include the current budget period. */
export function getOverviewPeriods(current: BudgetPeriod, range: OverviewRange, startDay: number): BudgetPeriod[] {
  let first = current;
  if (range.direction === 'past') {
    for (let i = 1; i < range.months; i++) first = getPreviousPeriod(first, startDay);
  }
  return generatePeriodsSequence(first.year, first.month, range.months, startDay);
}

/**
 * Vrátí správný tvar slova "měsíc" podle českých gramatických pravidel a specifikace:
 * - 1 měsíc
 * - 2, 3, 4 měsíce
 * - 5 a více (včetně 11–14, 21, 22, 24, 25...) měsíců
 */
export function getCzechMonthWord(count: number): string {
  const abs = Math.abs(count);
  if (abs === 1) return 'měsíc';
  if (abs >= 2 && abs <= 4) return 'měsíce';
  return 'měsíců';
}

/**
 * Zformátuje počet měsíců se správným českým skloňováním, např. "1 měsíc", "3 měsíce", "12 měsíců".
 */
export function formatMonthsCount(count: number): string {
  return `${count} ${getCzechMonthWord(count)}`;
}

/**
 * Vrátí datum předchozího dne ve formátu YYYY-MM-DD bez vlivu časových pásem.
 */
export function getPreviousDay(dateStr: string): string {
  const parts = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

/**
 * Vrátí dnešní datum v časovém pásmu Europe/Prague ve formátu YYYY-MM-DD.
 */
export function getTodayInPrague(referenceDate: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(referenceDate);
  const y = parts.find(p => p.type === 'year')?.value;
  const m = parts.find(p => p.type === 'month')?.value;
  const d = parts.find(p => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

/**
 * Určí výchozí datum pro novou položku podle aktuálně vybraného rozpočtového období a dnešního data:
 * 1. Aktuální období (dnešní datum spadá do vybraného období) -> dnešní datum.
 * 2. Minulé období (vybrané období skončilo před dnešním datem) -> poslední den vybraného období (endDate).
 * 3. Budoucí období (vybrané období začíná až po dnešním datu) -> první den vybraného období (startDate).
 * Respektuje časové pásmo Europe/Prague a podporuje volitelné předání referenčního dnešního data.
 */
export function getDefaultDateForPeriod(period: BudgetPeriod, todayDateStr?: string): string {
  const today = todayDateStr || getTodayInPrague();
  if (today >= period.startDate && today <= period.endDate) {
    return today;
  }
  if (period.endDate < today) {
    return period.endDate;
  }
  return period.startDate;
}

