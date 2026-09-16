import React, { useState, useEffect } from 'react';
import { formatMonthsCount, formatCzechDate } from '../../services/periodService';
import { BudgetPeriodInfo, DualPeriodRange } from '../../services/analyticsEngine';
import { PeriodRangeSelector } from './PeriodRangeSelector';
import { Calendar } from 'lucide-react';

interface DualPeriodFilterPanelProps {
  range: DualPeriodRange;
  onRangeChange: (range: DualPeriodRange) => void;
  periods: BudgetPeriodInfo[];
  currentPeriodKey: string;
  ariaLabel: string;
}

export const DualPeriodFilterPanel: React.FC<DualPeriodFilterPanelProps> = ({
  range,
  onRangeChange,
  periods,
  currentPeriodKey,
  ariaLabel,
}) => {
  const [drafts, setDrafts] = useState({ future: { from: '', to: '' }, past: { from: '', to: '' } });
  const [validationError, setValidationError] = useState<string | null>(null);

  const firstPeriod = periods[0];
  const lastPeriod = periods[periods.length - 1];

  useEffect(() => {
    if (!firstPeriod || !lastPeriod) return;
    setDrafts(previous => ({ ...previous, [range.direction]: { from: firstPeriod.key, to: lastPeriod.key } }));
  }, [range.direction, firstPeriod?.key, lastPeriod?.key]);

  if (!firstPeriod || !lastPeriod) return null;

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-4" aria-label={ariaLabel}>
      {(['future', 'past'] as const).map(direction => (
        <div key={direction} className="flex flex-wrap items-center justify-between gap-3" role="group" aria-label={direction === 'future' ? 'Budoucí období' : 'Minulá období'}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-slate-900 w-20">{direction === 'future' ? 'Budoucnost' : 'Historie'}</span>
            {(direction === 'future' ? [3, 6, 12, 18, 24] as const : [3, 6, 12, 'ytd', 'all'] as const).map(preset => {
              const active = range.direction === direction && (typeof preset === 'number' ? range.months === preset : range.preset === preset);
              return <button
                key={preset}
                type="button"
                aria-pressed={active}
                onClick={() => { onRangeChange(typeof preset === 'number' ? { direction, months: preset } : { direction, preset }); setValidationError(null); }}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${active
                  ? 'bg-sky-600 text-white border-sky-600 shadow-sm shadow-sky-500/20'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-500 border-slate-200/80'}`}
              >
                {preset === 'ytd' ? 'Tento rok (YTD)' : preset === 'all' ? 'Celá historie' : `${direction === 'future' ? (preset === 3 ? 'Příští' : 'Příštích') : preset === 3 ? 'Poslední' : 'Posledních'} ${formatMonthsCount(preset)}`}
              </button>;
            })}
          </div>
          <div className="ml-auto max-w-full">
            <PeriodRangeSelector
              from={drafts[direction].from}
              to={drafts[direction].to}
              max={direction === 'past' ? currentPeriodKey : undefined}
              active={range.direction === direction && range.preset === 'custom'}
              onFromChange={from => { setDrafts(previous => ({ ...previous, [direction]: { ...previous[direction], from } })); setValidationError(null); }}
              onToChange={to => { setDrafts(previous => ({ ...previous, [direction]: { ...previous[direction], to } })); setValidationError(null); }}
              onSubmit={event => {
                event.preventDefault();
                const { from, to } = drafts[direction];
                if (!from || !to) { setValidationError('Vyberte prosím počáteční i koncový měsíc.'); return; }
                if (from > to) { setValidationError('Počáteční měsíc nesmí být pozdější než koncový měsíc.'); return; }
                if (direction === 'past' && to > currentPeriodKey) { setValidationError('Koncové rozpočtové období nesmí být v budoucnosti.'); return; }
                if (direction === 'future' && to < currentPeriodKey) { setValidationError('Koncové rozpočtové období nesmí být v minulosti.'); return; }
                setValidationError(null);
                onRangeChange({ direction, preset: 'custom', from, to });
              }}
            />
          </div>
        </div>
      ))}
      {validationError && <p role="alert" className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium">{validationError}</p>}
      <p className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
        <Calendar className="w-3.5 h-3.5" />
        {formatCzechDate(firstPeriod.startDate)} – {formatCzechDate(lastPeriod.endDate)}
        {periods.some(p => p.isCurrentPeriod) && <span>· Včetně aktuálního rozpočtového období</span>}
      </p>
    </div>
  );
};
