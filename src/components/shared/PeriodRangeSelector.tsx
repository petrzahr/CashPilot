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

export const PeriodRangeSelector: React.FC<PeriodRangeSelectorProps> = ({ from, to, max, active, onFromChange, onToChange, onSubmit }) => (
  <form
    onSubmit={onSubmit}
    className="flex flex-wrap items-center gap-2 pt-2 lg:pt-0"
  >
    <label className="flex items-center gap-1.5 text-xs">
      <span className="text-slate-500 font-medium">Od:</span>
      <input
        type="month"
        max={max}
        value={from}
        onChange={(e) => {
          onFromChange(e.target.value);
        }}
        className="w-32 shrink-0 px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 cursor-pointer"
      />
    </label>

    <label className="flex items-center gap-1.5 text-xs">
      <span className="text-slate-500 font-medium">Do:</span>
      <input
        type="month"
        max={max}
        value={to}
        onChange={(e) => {
          onToChange(e.target.value);
        }}
        className="w-32 shrink-0 px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 cursor-pointer"
      />
    </label>

    <button
      type="submit"
      className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all border ${
        active
          ? 'bg-sky-600 text-white border-sky-600 shadow-sm'
          : 'bg-slate-800 hover:bg-slate-900 text-white border-slate-800'
      }`}
    >
      OK
    </button>
  </form>
);
