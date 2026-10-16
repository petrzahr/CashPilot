import React, { useId, useRef, useState } from 'react';
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
  /** Název filtru pro čtečky, např. „Účet“ – z „Vybráno: 2“ samotného není poznat, o co jde */
  label?: string;
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
  label: filterLabel,
  disabled = false,
  disabledPlaceholder,
  emptyOptionsLabel = 'Žádné možnosti',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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

  const getPanelItems = () =>
    Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);

  const focusItem = (index: number) => {
    const items = getPanelItems();
    if (items.length === 0) return;
    items[(index + items.length) % items.length].focus();
  };

  const close = (returnFocus: boolean) => {
    setIsOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  // Šipka dolů na tlačítku otevře seznam a přesune fokus na první volbu
  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' && !disabled) {
      e.preventDefault();
      setIsOpen(true);
      requestAnimationFrame(() => focusItem(0));
    } else if (e.key === 'Escape' && isOpen) {
      // Escape zavře jen tento seznam, ne dialog pod ním
      e.preventDefault();
      e.stopPropagation();
      close(true);
    }
  };

  const handlePanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = getPanelItems();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItem(current + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusItem(current - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusItem(items.length - 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    }
  };

  // Odchod fokusu mimo filtr (Tab) seznam zavře
  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (isOpen && !containerRef.current?.contains(e.relatedTarget as Node | null)) {
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`} onBlur={handleBlur}>
      {isOpen && (
        <div
          className="fixed inset-0 z-20 cursor-default"
          onClick={() => setIsOpen(false)}
        />
      )}

      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-expanded={isOpen && !disabled}
        aria-label={filterLabel ? `${filterLabel}: ${label}` : undefined}
        aria-controls={isOpen ? panelId : undefined}
        onClick={() => setIsOpen(prev => !prev)}
        onKeyDown={handleTriggerKeyDown}
        className={`max-md:min-h-11 w-full flex items-center justify-between gap-1.5 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 text-left truncate transition-colors ${
          disabled ? 'opacity-50 cursor-not-allowed text-slate-500' : 'text-slate-500 hover:bg-slate-100'
        } ${selected.length > 0 ? 'font-semibold text-slate-900' : ''}`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown aria-hidden="true" className={`w-3.5 h-3.5 shrink-0 opacity-60 transition-transform motion-reduce:transition-none ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && !disabled && (
        <div
          ref={panelRef}
          id={panelId}
          role="group"
          aria-label={filterLabel ?? placeholder}
          onKeyDown={handlePanelKeyDown}
          className="absolute left-0 top-full mt-1 z-30 bg-white rounded-xl shadow-lg border border-slate-200 py-1 min-w-full w-max max-w-[280px] max-h-64 max-md:max-h-80 overflow-y-auto text-xs"
          onClick={(e) => e.stopPropagation()}
        >
          {options.length === 0 ? (
            <div className="px-3 py-1.5 text-slate-500 italic">{emptyOptionsLabel}</div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onChange(allSelected ? [] : options.map(o => o.value))}
                className="w-full text-left px-3 py-1.5 max-md:min-h-11 flex items-center gap-2 hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 transition-colors font-semibold text-sky-700 border-b border-slate-100"
              >
                {allSelected ? 'Zrušit výběr' : 'Vybrat vše'}
              </button>
              {options.map(opt => {
                const checked = selected.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => toggleValue(opt.value)}
                    className={`w-full text-left px-3 py-1.5 max-md:min-h-11 flex items-center gap-2 hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 transition-colors ${
                      checked ? 'text-slate-900 font-medium' : 'text-slate-500'
                    }`}
                  >
                    <span aria-hidden="true" className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
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
