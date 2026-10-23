import React from 'react';

interface PeriodRangeSelectorProps {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
}

const inputClass = 'max-md:min-h-11 w-36 max-sm:w-full max-sm:min-w-0 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-900 tabular-nums focus:outline-hidden focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 cursor-pointer';

export const PeriodRangeSelector: React.FC<PeriodRangeSelectorProps> = ({ from, to, onFromChange, onToChange, onSubmit }) => (
  <form onSubmit={onSubmit} className="flex flex-wrap items-center max-sm:items-end gap-2 max-sm:w-full">
    <label className="flex items-center gap-1.5 text-xs max-sm:flex-1 max-sm:min-w-0 max-sm:flex-col max-sm:items-stretch max-sm:gap-1">
      <span className="text-slate-500 font-medium">Od</span>
      <input type="month" value={from} onChange={(e) => onFromChange(e.target.value)} className={inputClass} />
    </label>
    <label className="flex items-center gap-1.5 text-xs max-sm:flex-1 max-sm:min-w-0 max-sm:flex-col max-sm:items-stretch max-sm:gap-1">
      <span className="text-slate-500 font-medium">Do</span>
      <input type="month" value={to} onChange={(e) => onToChange(e.target.value)} className={inputClass} />
    </label>
    <button type="submit" className="btn-secondary">Použít</button>
  </form>
);
