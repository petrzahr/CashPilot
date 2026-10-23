import React, { useState, useEffect } from 'react';
import { formatMonthsCount, formatCzechDate } from '../../services/periodService';
import { DualPeriodRange } from '../../services/periodRange';
import { PeriodRangeSelector } from './PeriodRangeSelector';
import { Calendar, CircleDot } from 'lucide-react';

interface DualPeriodFilterPanelProps {
  range: DualPeriodRange;
  onRangeChange: (range: DualPeriodRange) => void;
  // Stačí klíč a hranice období – vyhovuje BudgetPeriod i BudgetPeriodInfo
  periods: { key: string; startDate: string; endDate: string }[];
  currentPeriodKey: string;
  ariaLabel: string;
}

type Option = { range: DualPeriodRange; text: string; label: string };

// Časová osa: vlevo minulost od nejvzdálenější, vpravo budoucnost od nejbližší
const PAST: Option[] = [
  { range: { direction: 'past', preset: 'all' }, text: 'Vše', label: 'Celá historie' },
  { range: { direction: 'past', preset: 'ytd' }, text: 'Letos', label: 'Tento rok' },
  ...([12, 6, 3] as const).map(months => ({ range: { direction: 'past' as const, months }, text: String(months), label: `${months === 3 ? 'Poslední' : 'Posledních'} ${formatMonthsCount(months)}` })),
];
const FUTURE: Option[] = ([3, 6, 12, 18, 24] as const).map(months => ({ range: { direction: 'future' as const, months }, text: String(months), label: `${months === 3 ? 'Příští' : 'Příštích'} ${formatMonthsCount(months)}` }));

const isSelected = (option: DualPeriodRange, range: DualPeriodRange) =>
  range.preset !== 'custom' && option.direction === range.direction && option.months === range.months && option.preset === range.preset;

function describeRange(range: DualPeriodRange): string {
  if (range.preset === 'custom') return 'Vlastní rozsah';
  if (range.preset === 'ytd') return 'Od začátku roku';
  if (range.preset === 'all') return 'Celá historie';
  return `${formatMonthsCount(range.months || 12)} ${range.direction === 'future' ? 'dopředu' : 'zpět'}`;
}

export const DualPeriodFilterPanel: React.FC<DualPeriodFilterPanelProps> = ({
  range,
  onRangeChange,
  periods,
  currentPeriodKey,
  ariaLabel,
}) => {
  const [draft, setDraft] = useState({ from: '', to: '' });
  const [customOpen, setCustomOpen] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const firstPeriod = periods[0];
  const lastPeriod = periods[periods.length - 1];

  // Koncept vlastního rozsahu začíná na hranicích právě zobrazeného rozsahu
  useEffect(() => {
    if (!firstPeriod || !lastPeriod) return;
    setDraft({ from: firstPeriod.key, to: lastPeriod.key });
  }, [firstPeriod?.key, lastPeriod?.key]);

  if (!firstPeriod || !lastPeriod) return null;

  const isCustom = range.preset === 'custom';
  const showCustom = customOpen || isCustom;

  const renderOption = (option: Option) => (
    <button
      key={option.label}
      type="button"
      aria-pressed={isSelected(option.range, range)}
      aria-label={option.label}
      title={option.label}
      onClick={() => { onRangeChange(option.range); setCustomOpen(false); setValidationError(null); }}
      className="segment tabular-nums min-w-0 max-sm:px-1 sm:min-w-9"
    >
      {option.text}
    </button>
  );

  return (
    <div className="card p-5" aria-label={ariaLabel}>
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-6">
        {/* Na telefonu se osa láme do dvou řádků po šesti buňkách: minulost + Dnes, budoucnost + Vlastní */}
        <div role="group" aria-label="Rozsah období" className="segmented grid grid-cols-6 sm:flex sm:items-stretch sm:self-start lg:self-auto">
          {PAST.map(renderOption)}
          <span className="flex items-center justify-center gap-1 min-w-0 sm:px-2 text-xs font-semibold text-sky-700">
            <CircleDot className="w-3.5 h-3.5 max-sm:hidden" aria-hidden="true" />
            Dnes
          </span>
          {FUTURE.map(renderOption)}
          <span className="hidden sm:block w-px my-1.5 mx-0.5 bg-slate-300" aria-hidden="true" />
          <button
            type="button"
            aria-pressed={isCustom}
            aria-expanded={showCustom}
            onClick={() => { setCustomOpen(open => isCustom || !open); setValidationError(null); }}
            className="segment min-w-0 max-sm:px-1"
          >
            Vlastní
          </button>
        </div>
        <div className="flex items-start gap-2 text-xs lg:ml-auto lg:flex-row-reverse lg:text-right">
          <Calendar className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-500" aria-hidden="true" />
          <div>
            <p className="font-semibold text-slate-900 tabular-nums whitespace-nowrap">
              {formatCzechDate(firstPeriod.startDate)} – {formatCzechDate(lastPeriod.endDate)}
            </p>
            <p className="text-slate-500">
              {describeRange(range)}
              {periods.some(p => p.key === currentPeriodKey) && ' · vč. aktuálního období'}
            </p>
          </div>
        </div>
      </div>
      {showCustom && (
        <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
          <PeriodRangeSelector
            from={draft.from}
            to={draft.to}
            onFromChange={from => { setDraft(previous => ({ ...previous, from })); setValidationError(null); }}
            onToChange={to => { setDraft(previous => ({ ...previous, to })); setValidationError(null); }}
            onSubmit={event => {
              event.preventDefault();
              const { from, to } = draft;
              if (!from || !to) { setValidationError('Vyberte prosím počáteční i koncový měsíc.'); return; }
              if (from > to) { setValidationError('Počáteční měsíc nesmí být pozdější než koncový měsíc.'); return; }
              setValidationError(null);
              // Směr u vlastního rozsahu slouží jen rozhraní; rozsah může překročit i dnešek
              onRangeChange({ direction: to > currentPeriodKey ? 'future' : 'past', preset: 'custom', from, to });
            }}
          />
          {validationError && <p role="alert" className="panel panel-error font-medium">{validationError}</p>}
        </div>
      )}
    </div>
  );
};
