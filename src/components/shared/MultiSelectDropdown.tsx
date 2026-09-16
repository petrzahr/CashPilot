import React, { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectDropdownProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  disabled?: boolean;
  disabledPlaceholder?: string;
  emptyOptionsLabel?: string;
  className?: string;
}

/** Rozbalovací filtr s výběrem více hodnot najednou (zaškrtávací seznam), prázdný výběr = bez omezení. */
export const MultiSelectDropdown: React.FC<MultiSelectDropdownProps> = ({
  options,
  selected,
  onChange,
  placeholder,
  disabled = false,
  disabledPlaceholder,
  emptyOptionsLabel = 'Žádné možnosti',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleValue = (value: string) => {
    onChange(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value]);
  };

  const allSelected = options.length > 0 && selected.length === options.length;

  const label = disabled
    ? (disabledPlaceholder ?? placeholder)
    : selected.length === 0
      ? placeholder
      : selected.length === 1
        ? (options.find(o => o.value === selected[0])?.label ?? placeholder)
        : `Vybráno: ${selected.length}`;

  return (
    <div className={`relative ${className}`}>
      {isOpen && (
        <div
          className="fixed inset-0 z-20 cursor-default"
          onClick={() => setIsOpen(false)}
        />
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(prev => !prev)}
        className={`w-full flex items-center justify-between gap-1.5 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 text-left truncate transition-colors ${
          disabled ? 'opacity-50 cursor-not-allowed text-slate-500' : 'text-slate-500 hover:bg-slate-100/80'
        } ${selected.length > 0 ? 'font-semibold text-slate-900' : ''}`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 opacity-60 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && !disabled && (
        <div
          className="absolute left-0 top-full mt-1 z-30 bg-white rounded-xl shadow-lg border border-slate-200 py-1 min-w-full w-max max-w-[280px] max-h-64 overflow-y-auto text-xs"
          onClick={(e) => e.stopPropagation()}
        >
          {options.length === 0 ? (
            <div className="px-3 py-1.5 text-slate-500 italic">{emptyOptionsLabel}</div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onChange(allSelected ? [] : options.map(o => o.value))}
                className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-slate-50 transition-colors font-semibold text-sky-700 border-b border-slate-100"
              >
                {allSelected ? 'Zrušit výběr' : 'Vybrat vše'}
              </button>
              {options.map(opt => {
                const checked = selected.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleValue(opt.value)}
                    className={`w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-slate-50 transition-colors ${
                      checked ? 'text-slate-900 font-medium' : 'text-slate-500'
                    }`}
                  >
                    <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                      checked ? 'bg-sky-600 border-sky-600' : 'border-slate-300'
                    }`}>
                      {checked && <Check className="w-2.5 h-2.5 text-white" />}
                    </span>
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
};
