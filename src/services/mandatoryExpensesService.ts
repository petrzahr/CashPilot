import { Account, Category, RecurrenceFrequency, RecurringRule } from '../types/finance';
import { czechStringCompare } from './categoryService';
import { addHaler } from './currencyService';
import { doesRuleApplyInPeriod, generateOccurrenceForPeriod } from './financialEngine';
import { generatePeriodsSequence, getPeriodForDate } from './periodService';

export type MandatoryGroup = 'income' | 'expense' | 'transfer';

export interface MandatoryItem {
  ruleId: string;
  title: string;
  group: MandatoryGroup;
  mainCategoryId: string | null;
  categoryLabel: string;        // "Kategorie / Podkategorie"
  accountLabel: string;         // "Účet" nebo "Z účtu → Na účet"
  scheduleLabel: string;        // např. "ročně, 15. 3." nebo "čtvrtletně, 10. (led, dub, čvc, říj)"
  nextDate: string | null;      // nejbližší splatnost od dneška
  startsInFuture: boolean;
  amountInHaler: number;        // částka jedné platby
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

export interface MandatoryOverview {
  income: MandatorySection;
  expense: MandatorySection;
  transfer: MandatorySection;
  /** Příjmy − výdaje − spoření & převody (průměr na měsíc) */
  remainingMonthlyInHaler: number;
}

const MONTHS_PER_YEAR = 12;
const AVG_DAYS_PER_MONTH = 365.25 / 12;

const SHORT_MONTHS = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro'];

const FREQUENCY_LABELS: Record<RecurrenceFrequency, string> = {
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
 * Výskyty pravidla za 12 rozpočtových období od pozdějšího z (aktuální období, začátek pravidla).
 * Výjimky jednotlivých období se ignorují - přehled popisuje pravidlo samotné.
 */
function getUpcomingOccurrenceDates(rule: RecurringRule, todayStr: string, startDay: number, accounts: Account[]): string[] {
  const fromDate = rule.startDate > todayStr ? rule.startDate : todayStr;
  const fromPeriod = getPeriodForDate(fromDate, startDay);
  const periods = generatePeriodsSequence(fromPeriod.year, fromPeriod.month, MONTHS_PER_YEAR, startDay);

  const dates: string[] = [];
  for (const period of periods) {
    if (!doesRuleApplyInPeriod(rule, period, startDay)) continue;
    const occ = generateOccurrenceForPeriod(rule, period, [], startDay, 1, todayStr, accounts);
    if (occ) dates.push(occ.date);
  }
  return dates.sort();
}

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
 * Přehled pravidelných (mandatorních) plateb sestavený z aktivních opakovaných plateb.
 * Každá platba se přepočte na měsíční a roční průměr podle své frekvence (roční ÷ 12,
 * čtvrtletní ÷ 3, ...), takže nepravidelné platby jsou rozpočítané do každého měsíce.
 */
export function calculateMandatoryOverview(
  rules: RecurringRule[],
  categories: Category[],
  accounts: Account[],
  todayStr: string,
  startDay: number
): MandatoryOverview {
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const accMap = new Map(accounts.map((a) => [a.id, a]));
  const accName = (id?: string) => (id ? accMap.get(id)?.name ?? 'Neznámý účet' : '—');

  const activeRules = rules.filter(
    (r) =>
      r.isActive &&
      (!r.endDate || r.endDate >= todayStr) &&
      (r.type === 'income' || r.type === 'expense' || r.type === 'transfer')
  );

  const items: MandatoryItem[] = activeRules.map((rule) => {
    const cat = rule.categoryId ? catMap.get(rule.categoryId) : undefined;
    const sub = rule.subcategoryId ? catMap.get(rule.subcategoryId) : cat?.parentId ? cat : undefined;
    const main = sub?.parentId ? catMap.get(sub.parentId) : cat && !cat.parentId ? cat : undefined;

    const occurrenceDates = getUpcomingOccurrenceDates(rule, todayStr, startDay, accounts);
    const factor = getMonthlyFactor(rule);

    return {
      ruleId: rule.id,
      title: rule.title,
      group: rule.type as MandatoryGroup,
      mainCategoryId: main?.id ?? null,
      categoryLabel: main ? (sub ? `${main.name} / ${sub.name}` : main.name) : 'Bez kategorie',
      accountLabel:
        rule.type === 'transfer'
          ? `${accName(rule.sourceAccountId)} → ${accName(rule.targetAccountId)}`
          : accName(rule.sourceAccountId),
      scheduleLabel: buildScheduleLabel(rule, occurrenceDates),
      nextDate: occurrenceDates.find((d) => d >= todayStr) ?? null,
      startsInFuture: rule.startDate > todayStr,
      amountInHaler: rule.amountInHaler,
      monthlyInHaler: Math.round(rule.amountInHaler * factor),
      yearlyInHaler: Math.round(rule.amountInHaler * factor * MONTHS_PER_YEAR),
    };
  });

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
        monthlyInHaler: sorted.reduce((s, i) => addHaler(s, i.monthlyInHaler), 0),
        yearlyInHaler: sorted.reduce((s, i) => addHaler(s, i.yearlyInHaler), 0),
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

  const income = buildSection('income');
  const expense = buildSection('expense');
  const transfer = buildSection('transfer');

  return {
    income,
    expense,
    transfer,
    remainingMonthlyInHaler: income.monthlyInHaler - expense.monthlyInHaler - transfer.monthlyInHaler,
  };
}
