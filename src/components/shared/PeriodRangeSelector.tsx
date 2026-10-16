import React from 'react';

interface PeriodRangeSelectorProps {
  from: string;
  to: string;
  max?: string;
  active: boolean;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
}

export const PeriodRangeSelector: React.FC<PeriodRangeSelectorProps> = ({ from, to, max, active, onFromChange, onToChange, onSubmit }) => {
  // Použitý vlastní rozsah poznáte podle polí: bílý podklad a modrý okraj (žádná předvolba není vybraná)
  const inputState = active ? 'bg-white border-sky-500 text-slate-900' : 'bg-slate-50 border-slate-200 text-slate-500';
  return (
  <form
    onSubmit={onSubmit}
    className="flex flex-wrap items-center max-sm:items-end gap-2 pt-2 lg:pt-0 max-sm:w-full"
  >
    <label className="flex items-center gap-1.5 text-xs max-sm:flex-1 max-sm:min-w-0 max-sm:flex-col max-sm:items-stretch max-sm:gap-1">
      <span className="text-slate-500 font-medium">Od:</span>
      <input
        type="month"
        max={max}
        value={from}
        onChange={(e) => {
          onFromChange(e.target.value);
        }}
        className={`max-md:min-h-11 w-32 max-sm:w-full max-sm:min-w-0 shrink-0 max-sm:shrink px-2.5 max-sm:px-2 py-1.5 rounded-xl border text-xs font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 cursor-pointer ${inputState}`}
      />
    </label>

    <label className="flex items-center gap-1.5 text-xs max-sm:flex-1 max-sm:min-w-0 max-sm:flex-col max-sm:items-stretch max-sm:gap-1">
      <span className="text-slate-500 font-medium">Do:</span>
      <input
        type="month"
        max={max}
        value={to}
        onChange={(e) => {
          onToChange(e.target.value);
        }}
        className={`max-md:min-h-11 w-32 max-sm:w-full max-sm:min-w-0 shrink-0 max-sm:shrink px-2.5 max-sm:px-2 py-1.5 rounded-xl border text-xs font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 cursor-pointer ${inputState}`}
      />
    </label>

    <button
      type="submit"
      className="btn-secondary"
    >
      OK
    </button>
  </form>
  );
};
