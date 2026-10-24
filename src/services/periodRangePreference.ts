import { AppSettings, PeriodRangePresetId, PeriodRangeScreen } from '../types/finance';
import type { DualPeriodRange } from './periodRange';
import { formatMonthsCount } from './periodService';

export interface PeriodRangePreset {
  id: PeriodRangePresetId;
  label: string;
  range: DualPeriodRange;
}

const months = (direction: 'past' | 'future', count: 3 | 6 | 12 | 18 | 24): PeriodRangePreset => ({
  id: `${direction}:${count}` as PeriodRangePresetId,
  label: direction === 'past'
    ? `${count === 3 ? 'Poslední' : 'Posledních'} ${formatMonthsCount(count)}`
    : `${count === 3 ? 'Příští' : 'Příštích'} ${formatMonthsCount(count)}`,
  range: { direction, months: count },
});

/** Předvolby ve stejném pořadí jako na časové ose filtru. Vlastní rozsah se jako výchozí neukládá, časem by zastaral. */
export const PERIOD_RANGE_PRESETS: PeriodRangePreset[] = [
  { id: 'past:all', label: 'Celá historie', range: { direction: 'past', preset: 'all' } },
  { id: 'past:ytd', label: 'Tento rok', range: { direction: 'past', preset: 'ytd' } },
  months('past', 12),
  months('past', 6),
  months('past', 3),
  months('future', 3),
  months('future', 6),
  months('future', 12),
  months('future', 18),
  months('future', 24),
];

export const BUILT_IN_DEFAULT_RANGE: Record<PeriodRangeScreen, PeriodRangePresetId> = {
  overview: 'future:12',
  analytics: 'past:12',
};

const byId = new Map(PERIOD_RANGE_PRESETS.map((p) => [p.id, p]));

/** Uložená volba z nastavení (může pocházet z Disku), neplatná nebo chybějící hodnota padá na vestavěnou výchozí. */
export function getDefaultRangeId(settings: AppSettings | undefined, screen: PeriodRangeScreen): PeriodRangePresetId {
  const stored = settings?.defaultPeriodRanges?.[screen];
  return typeof stored === 'string' && byId.has(stored as PeriodRangePresetId)
    ? (stored as PeriodRangePresetId)
    : BUILT_IN_DEFAULT_RANGE[screen];
}

export function getPresetRange(id: PeriodRangePresetId): DualPeriodRange {
  return { ...byId.get(id)!.range };
}

/** Poslední výběr obrazovky v rámci relace, svázaný s výchozí volbou, ze které vznikl. */
export interface SessionRange {
  defaultId: PeriodRangePresetId;
  range: DualPeriodRange;
}

export function rememberSessionRange(settings: AppSettings | undefined, screen: PeriodRangeScreen, range: DualPeriodRange): SessionRange {
  return { defaultId: getDefaultRangeId(settings, screen), range };
}

/** Zapamatovaný výběr, nebo výchozí rozsah z Nastavení. Po změně výchozí volby se obrazovka vrátí k nové výchozí. */
export function resolveSessionRange(saved: SessionRange | undefined, settings: AppSettings | undefined, screen: PeriodRangeScreen): DualPeriodRange {
  const defaultId = getDefaultRangeId(settings, screen);
  return saved && saved.defaultId === defaultId ? saved.range : getPresetRange(defaultId);
}
