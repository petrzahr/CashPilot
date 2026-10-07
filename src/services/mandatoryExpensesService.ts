import { Account, BudgetPeriod, Category, RecurrenceFrequency, RecurringRule } from '../types/finance';
import { czechStringCompare } from './categoryService';
import { addHaler, subHaler } from './currencyService';
import { doesRuleApplyInPeriod, generateOccurrenceForPeriod } from './financialEngine';
import { generatePeriodsSequence, getPeriodForDate } from './periodService';

export type MandatoryGroup = 'income' | 'expense' | 'transfer';

/**
 * Simulace nad přehledem: úpravy, smazání a přidání plateb jen pro účely přehledu.
 * Skutečné opakované platby se nemění.
 */
export interface MandatorySimulatedPayment {
  id: string;
  title: string;
  group: MandatoryGroup;
  categoryId: string | null;      // hlavní kategorie (u převodů null)
  sourceAccountId: string;
  targetAccountId?: string;       // jen u převodů
  amountInHaler: number;
  frequency: RecurrenceFrequency;
}

export interface MandatorySimulationEdit {
  title?: string;
  amountInHaler?: number;
  frequency?: RecurrenceFrequency;
}

export interface MandatorySimulation {
  edits: Record<string, MandatorySimulationEdit>;   // podle ruleId
  deleted: string[];                                 // ruleId
  added: MandatorySimulatedPayment[];
}

export const EMPTY_SIMULATION: MandatorySimulation = { edits: {}, deleted: [], added: [] };

export const isSimulationEmpty = (s: MandatorySimulation) =>
  Object.keys(s.edits).length === 0 && s.deleted.length === 0 && s.added.length === 0;

export type MandatorySimState = 'edited' | 'added' | 'deleted';

export interface MandatoryItem {
  ruleId: string;               // ID opakované platby, u přidaných ID simulované platby
  title: string;
  frequency: RecurrenceFrequency;
  simState?: MandatorySimState;
  /** Původní hodnoty skutečné opakované platby (jen u upravených) */
  original?: { title: string; amountInHaler: number; frequency: RecurrenceFrequency };
  group: MandatoryGroup;
  mainCategoryId: string | null;
  categoryLabel: string;        // "Kategorie / Podkategorie"
  accountLabel: string;         // "Účet" nebo "Z účtu → Na účet"
  scheduleLabel: string;        // např. "ročně, 15. 3." nebo "čtvrtletně, 10. (led, dub, čvc, říj)"
  nextDate: string | null;      // nejbližší splatnost od dneška
  fromCashAccount: boolean;     // zdrojový účet je běžný nebo hotovostní
  amountInHaler: number;      // částka jedné platby
  monthlyInHaler: number;       // průměr na měsíc
  yearlyInHaler: number;        // průměr na rok
}

export interface MandatoryCategoryGroup {
  key: string;
  label: string;
  color: string;
  items: MandatoryItem[];
  monthlyInHaler: number;
  yearlyInHaler: number;
}

export interface MandatorySection {
  group: MandatoryGroup;
  categories: MandatoryCategoryGroup[];
  monthlyInHaler: number;
  yearlyInHaler: number;
}

export interface MandatoryUpcomingChange {
  ruleId: string;
  title: string;
  group: MandatoryGroup;
  kind: 'start' | 'end';
  /** První (start) nebo poslední (end) platba */
  occurrenceDate: string;
  /** Rozpočtové období, kdy platba začíná / naposledy proběhne (podle dne začátku období z Nastavení) */
  periodName: string;
  scheduleLabel: string;
  amountInHaler: number;
  monthlyInHaler: number;
}

export interface MandatoryOverview {
  /** Rozpočtové období, ke kterému je přehled sestaven */
  periodName: string;
  /** Platby, které začnou nebo skončí v dalších obdobích (nejsou/budou zahrnuty v součtech) */
  upcomingChanges: MandatoryUpcomingChange[];
  income: MandatorySection;
  expense: MandatorySection;
  transfer: MandatorySection;
  /**
   * Příjmy − výdaje na běžných a hotovostních účtech, bez převodů (průměr na měsíc) -
   * stejná definice jako "Skutečně uspořeno" v Měsíčním rozpočtu.
   */
  actuallySavedMonthlyInHaler: number;
  /** Příjmy − výdaje − spoření & převody (průměr na měsíc) */
  remainingMonthlyInHaler: number;
}

const MONTHS_PER_YEAR = 12;
const AVG_DAYS_PER_MONTH = 365.25 / 12;

const SHORT_MONTHS = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro'];

export const FREQUENCY_LABELS: Record<RecurrenceFrequency, string> = {
  monthly: 'měsíčně',
  bi_monthly: 'každé 2 měsíce',
  quarterly: 'čtvrtletně',
  semi_annually: 'pololetně',
  annually: 'ročně',
  custom: 'vlastní interval',
};

/** Kolikrát za měsíc (v průměru) se platba opakuje. */
export function getMonthlyFactor(rule: Pick<RecurringRule, 'frequency' | 'intervalDays'>): number {
  switch (rule.frequency) {
    case 'monthly': return 1;
    case 'bi_monthly': return 1 / 2;
    case 'quarterly': return 1 / 3;
    case 'semi_annually': return 1 / 6;
    case 'annually': return 1 / 12;
    case 'custom': return AVG_DAYS_PER_MONTH / Math.max(1, rule.intervalDays || 30);
    default: return 0;
  }
}

/**
 * Výskyty pravidla v `count` rozpočtových obdobích od `fromPeriod` (období začínají dnem
 * z Nastavení). Výjimky jednotlivých období se ignorují - přehled popisuje pravidlo samotné.
 */
function getOccurrenceDates(
  rule: RecurringRule,
  fromPeriod: BudgetPeriod,
  count: number,
  todayStr: string,
  startDay: number,
  accounts: Account[]
): string[] {
  const periods = generatePeriodsSequence(fromPeriod.year, fromPeriod.month, count, startDay);
  const dates: string[] = [];
  for (const period of periods) {
    if (!doesRuleApplyInPeriod(rule, period, startDay)) continue;
    const occ = generateOccurrenceForPeriod(rule, period, [], startDay, 1, todayStr, accounts);
    if (occ) dates.push(occ.date);
  }
  return dates.sort();
}

const periodsBetween = (from: BudgetPeriod, to: BudgetPeriod) =>
  (to.year - from.year) * 12 + (to.month - from.month) + 1;

function buildScheduleLabel(rule: RecurringRule, occurrenceDates: string[]): string {
  if (rule.frequency === 'custom') {
    return `každých ${Math.max(1, rule.intervalDays || 30)} dní`;
  }
  const day = `${rule.dayOfMonth}.`;
  if (rule.frequency === 'monthly') {
    return `${FREQUENCY_LABELS.monthly}, ${day}`;
  }

  const months = [...new Set(occurrenceDates.map((d) => parseInt(d.split('-')[1], 10)))].sort((a, b) => a - b);
  if (months.length === 1) {
    return `${FREQUENCY_LABELS[rule.frequency]}, ${day} ${months[0]}.`;
  }
  if (months.length > 1) {
    return `${FREQUENCY_LABELS[rule.frequency]}, ${day} (${months.map((m) => SHORT_MONTHS[m - 1]).join(', ')})`;
  }
  return `${FREQUENCY_LABELS[rule.frequency]}, ${day}`;
}

/**
 * Přehled pravidelných (mandatorních) plateb sestavený z opakovaných plateb platných
 * ve vybraném rozpočtovém období (výchozí je aktuální; období začíná dnem z Nastavení,
 * ne 1. dnem v měsíci). Dále v popisu "aktuální období" = vybrané období.
 * Každá platba se přepočte na měsíční a roční průměr podle své frekvence (roční ÷ 12,
 * čtvrtletní ÷ 3, ...), takže nepravidelné platby jsou rozpočítané do každého měsíce.
 *
 * Platba se počítá, pokud začala nejpozději v aktuálním období a platí až do jeho konce.
 * Trvalá změna platby (rozdělení na starou větev končící den před změnou a novou od změny)
 * se tak započítá vždy právě jednou: do konce období platí stará větev, jinak nová.
 * Platby, které začnou nebo skončí v dalších obdobích, jsou v upcomingChanges.
 */
export function calculateMandatoryOverview(
  rules: RecurringRule[],
  categories: Category[],
  accounts: Account[],
  todayStr: string,
  startDay: number,
  simulation: MandatorySimulation = EMPTY_SIMULATION,
  period?: BudgetPeriod
): MandatoryOverview {
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const accMap = new Map(accounts.map((a) => [a.id, a]));
  const accName = (id?: string) => (id ? accMap.get(id)?.name ?? 'Neznámý účet' : '—');

  const currentPeriod = period ?? getPeriodForDate(todayStr, startDay);
  const periodEnd = currentPeriod.endDate;
  // Od kdy hledat nejbližší splatnost: u budoucího období od jeho začátku, jinak od dneška
  const refDate = currentPeriod.startDate > todayStr ? currentPeriod.startDate : todayStr;

  const relevantRules = rules.filter(
    (r) =>
      r.isActive &&
      (r.type === 'income' || r.type === 'expense' || r.type === 'transfer') &&
      (!r.endDate || r.endDate >= currentPeriod.startDate)
  );
  const isCurrent = (r: RecurringRule) => r.startDate <= periodEnd && (!r.endDate || r.endDate >= periodEnd);

  // Rozpis splatností popisuje pravidlo jako takové, proto ignoruje datum konce
  const scheduleFor = (rule: RecurringRule) => {
    const fromDate = rule.startDate > refDate ? rule.startDate : refDate;
    return buildScheduleLabel(
      rule,
      getOccurrenceDates({ ...rule, endDate: null }, getPeriodForDate(fromDate, startDay), MONTHS_PER_YEAR, todayStr, startDay, accounts)
    );
  };

  const isCashAccount = (id?: string) => ['checking', 'cash'].includes((id && accMap.get(id)?.type) || '');
  const withAmounts = (item: Omit<MandatoryItem, 'monthlyInHaler' | 'yearlyInHaler'>, intervalDays?: number): MandatoryItem => {
    const factor = getMonthlyFactor({ frequency: item.frequency, intervalDays });
    return {
      ...item,
      monthlyInHaler: Math.round(item.amountInHaler * factor),
      yearlyInHaler: Math.round(item.amountInHaler * factor * MONTHS_PER_YEAR),
    };
  };

  const baselineItems: MandatoryItem[] = relevantRules.filter(isCurrent).map((rule) => {
    const cat = rule.categoryId ? catMap.get(rule.categoryId) : undefined;
    const sub = rule.subcategoryId ? catMap.get(rule.subcategoryId) : cat?.parentId ? cat : undefined;
    const main = sub?.parentId ? catMap.get(sub.parentId) : cat && !cat.parentId ? cat : undefined;

    const occurrenceDates = getOccurrenceDates(rule, currentPeriod, MONTHS_PER_YEAR, todayStr, startDay, accounts);
    const edit = simulation.edits[rule.id];
    const isDeleted = simulation.deleted.includes(rule.id);
    const frequency = edit?.frequency ?? rule.frequency;
    const isEdited = !!edit && (
      (edit.title !== undefined && edit.title !== rule.title) ||
      (edit.amountInHaler !== undefined && edit.amountInHaler !== rule.amountInHaler) ||
      frequency !== rule.frequency
    );

    return withAmounts({
      ruleId: rule.id,
      title: edit?.title ?? rule.title,
      frequency,
      simState: isDeleted ? 'deleted' : isEdited ? 'edited' : undefined,
      original: isEdited ? { title: rule.title, amountInHaler: rule.amountInHaler, frequency: rule.frequency } : undefined,
      group: rule.type as MandatoryGroup,
      mainCategoryId: main?.id ?? null,
      categoryLabel: main ? (sub ? `${main.name} / ${sub.name}` : main.name) : 'Bez kategorie',
      accountLabel:
        rule.type === 'transfer'
          ? `${accName(rule.sourceAccountId)} → ${accName(rule.targetAccountId)}`
          : accName(rule.sourceAccountId),
      // Při změně frekvence v simulaci už neznáme konkrétní měsíce splatnosti
      scheduleLabel: frequency === rule.frequency ? scheduleFor(rule) : buildScheduleLabel({ ...rule, frequency }, []),
      nextDate: frequency === rule.frequency ? occurrenceDates.find((d) => d >= refDate) ?? null : null,
      fromCashAccount: isCashAccount(rule.sourceAccountId),
      amountInHaler: edit?.amountInHaler ?? rule.amountInHaler,
    }, rule.intervalDays);
  });

  const addedItems: MandatoryItem[] = simulation.added.map((p) => {
    const main = p.categoryId ? catMap.get(p.categoryId) : undefined;
    return withAmounts({
      ruleId: p.id,
      title: p.title,
      frequency: p.frequency,
      simState: 'added',
      group: p.group,
      mainCategoryId: p.group === 'transfer' ? null : main?.id ?? null,
      categoryLabel: main?.name ?? 'Bez kategorie',
      accountLabel:
        p.group === 'transfer' ? `${accName(p.sourceAccountId)} → ${accName(p.targetAccountId)}` : accName(p.sourceAccountId),
      scheduleLabel: FREQUENCY_LABELS[p.frequency],
      nextDate: null,
      fromCashAccount: isCashAccount(p.sourceAccountId),
      amountInHaler: p.amountInHaler,
    });
  });

  const items = [...baselineItems, ...addedItems];
  // Smazané platby zůstávají v tabulce (přeškrtnuté), ale nezapočítávají se
  const counted = (i: MandatoryItem) => i.simState !== 'deleted';

  const buildSection = (group: MandatoryGroup): MandatorySection => {
    const groupItems = items.filter((i) => i.group === group);
    const byKey = new Map<string, MandatoryItem[]>();
    for (const item of groupItems) {
      // Převody seskupujeme do jedné skupiny, příjmy/výdaje podle hlavní kategorie
      const key = group === 'transfer' ? 'transfers' : item.mainCategoryId ?? '__none';
      byKey.set(key, [...(byKey.get(key) ?? []), item]);
    }

    const categoriesOut: MandatoryCategoryGroup[] = [...byKey.entries()].map(([key, groupItemsForKey]) => {
      const main = catMap.get(key);
      const sorted = [...groupItemsForKey].sort((a, b) => czechStringCompare(a.title, b.title));
      return {
        key,
        label: group === 'transfer' ? 'Spoření & Převody' : main?.name ?? 'Bez kategorie',
        color: group === 'transfer' ? '#0284c7' : main?.color ?? '#94a3b8',
        items: sorted,
        monthlyInHaler: sorted.filter(counted).reduce((s, i) => addHaler(s, i.monthlyInHaler), 0),
        yearlyInHaler: sorted.filter(counted).reduce((s, i) => addHaler(s, i.yearlyInHaler), 0),
      };
    });

    // Kategorie abecedně, "Bez kategorie" na konec
    categoriesOut.sort((a, b) =>
      a.key === '__none' ? 1 : b.key === '__none' ? -1 : czechStringCompare(a.label, b.label)
    );

    return {
      group,
      categories: categoriesOut,
      monthlyInHaler: categoriesOut.reduce((s, c) => addHaler(s, c.monthlyInHaler), 0),
      yearlyInHaler: categoriesOut.reduce((s, c) => addHaler(s, c.yearlyInHaler), 0),
    };
  };

  const upcomingChanges: MandatoryUpcomingChange[] = [];
  for (const rule of relevantRules) {
    const base = {
      ruleId: rule.id,
      title: rule.title,
      group: rule.type as MandatoryGroup,
      scheduleLabel: scheduleFor(rule),
      amountInHaler: rule.amountInHaler,
      monthlyInHaler: Math.round(rule.amountInHaler * getMonthlyFactor(rule)),
    };

    if (rule.startDate > periodEnd) {
      const firstDate = getOccurrenceDates(rule, getPeriodForDate(rule.startDate, startDay), MONTHS_PER_YEAR, todayStr, startDay, accounts)[0];
      if (firstDate) {
        upcomingChanges.push({ ...base, kind: 'start', occurrenceDate: firstDate, periodName: getPeriodForDate(firstDate, startDay).name });
      }
    }

    if (rule.endDate) {
      const fromPeriod = rule.startDate > currentPeriod.startDate ? getPeriodForDate(rule.startDate, startDay) : currentPeriod;
      const endPeriod = getPeriodForDate(rule.endDate, startDay);
      const count = periodsBetween(fromPeriod, endPeriod);
      const dates = count > 0 ? getOccurrenceDates(rule, fromPeriod, count, todayStr, startDay, accounts) : [];
      const lastDate = dates[dates.length - 1];
      // Včetně platby končící už v aktuálním období - je vidět, proč není v součtech
      if (lastDate) {
        upcomingChanges.push({ ...base, kind: 'end', occurrenceDate: lastDate, periodName: getPeriodForDate(lastDate, startDay).name });
      }
    }
  }
  upcomingChanges.sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate) || (a.kind === 'end' ? -1 : 1));

  const income = buildSection('income');
  const expense = buildSection('expense');
  const transfer = buildSection('transfer');

  const actuallySavedMonthlyInHaler = items
    .filter((i) => counted(i) && i.fromCashAccount && i.group !== 'transfer')
    .reduce((s, i) => (i.group === 'income' ? addHaler(s, i.monthlyInHaler) : subHaler(s, i.monthlyInHaler)), 0);

  return {
    periodName: currentPeriod.name,
    upcomingChanges,
    income,
    expense,
    transfer,
    actuallySavedMonthlyInHaler,
    remainingMonthlyInHaler: income.monthlyInHaler - expense.monthlyInHaler - transfer.monthlyInHaler,
  };
}
