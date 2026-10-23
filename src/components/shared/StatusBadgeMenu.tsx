import React, { useEffect, useId, useRef, useState } from 'react';
import { Ban, Check, ChevronDown, Clock, Loader2, type LucideIcon } from 'lucide-react';
import { Transaction, TransactionStatus } from '../../types/finance';

// Volby stavu položky: jantar čeká, zelená proběhla, šedá je zrušená
const STATUS_ITEMS: { value: TransactionStatus; label: string; Icon: LucideIcon; badgeClass: string; activeClass: string; iconClass: string }[] = [
  { value: 'planned', label: 'Plánovaná', Icon: Clock, badgeClass: 'bg-amber-50 text-amber-700 hover:bg-amber-100', activeClass: 'text-amber-700 bg-amber-50/60', iconClass: 'text-amber-600' },
  { value: 'executed', label: 'Uskutečněná', Icon: Check, badgeClass: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100', activeClass: 'text-emerald-700 bg-emerald-50/60', iconClass: 'text-emerald-600' },
  { value: 'cancelled', label: 'Zrušená', Icon: Ban, badgeClass: 'bg-slate-100 text-slate-500 hover:bg-slate-200', activeClass: 'text-slate-500 bg-slate-100', iconClass: 'text-slate-500' },
];

/** Text, proč nejde vrátit minulou položku do plánu (plánované položky s dnešním či starším datem se samy uskuteční). */
export const PAST_PLANNED_HINT = 'Položky s dnešním nebo starším datem se uskuteční automaticky.';

interface StatusBadgeMenuProps {
  tx: Pick<Transaction, 'id' | 'title' | 'status' | 'date'>;
  /** Dnešní datum (YYYY-MM-DD) pro pravidlo automatického uskutečnění */
  todayIso: string;
  isUpdating: boolean;
  onChange: (status: TransactionStatus) => void;
  /** Otevřít nabídku nad štítkem (spodní řádky tabulky) */
  openUp?: boolean;
}

/**
 * Štítek stavu, který je zároveň tlačítkem pro změnu stavu, stejný ve všech seznamech položek.
 * Ovládá se myší, dotykem i klávesnicí (šipky, Escape).
 */
export const StatusBadgeMenu: React.FC<StatusBadgeMenuProps> = ({ tx, todayIso, isUpdating, onChange, openUp = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = STATUS_ITEMS.find(s => s.value === tx.status) ?? STATUS_ITEMS[0];
  const canBePlanned = tx.date > todayIso;

  const getItems = () =>
    Array.from(containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not([disabled])') ?? []);

  useEffect(() => {
    if (isOpen) getItems()[0]?.focus();
  }, [isOpen]);

  const close = (returnFocus: boolean) => {
    setIsOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = getItems();
    if (items.length === 0) return;
    e.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  };

  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (isOpen && !containerRef.current?.contains(e.relatedTarget as Node | null)) setIsOpen(false);
  };

  return (
    <div
      ref={containerRef}
      className="relative inline-block text-left no-underline"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
    >
      {isOpen && <div className="fixed inset-0 z-20 cursor-default" onClick={() => close(false)} />}
      {/* Tichý štítek: bez rámečku a s menším okrajem, aby nepřebíjel název a částku; text zůstává 12px.
          Dotyková plocha na mobilu se zvětšuje neviditelným ::after. */}
      <button
        ref={triggerRef}
        type="button"
        disabled={isUpdating}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        aria-label={`Stav položky ${tx.title}: ${current.label}. Změnit stav`}
        title="Změnit stav položky (Plánovaná, Uskutečněná, Zrušená)"
        onClick={() => setIsOpen(prev => !prev)}
        className={`relative max-md:after:absolute max-md:after:-inset-x-3 max-md:after:-inset-y-3.5 max-md:after:content-[''] inline-flex items-center gap-0.5 pl-1 pr-1.5 py-px rounded-md text-xs font-medium leading-4 transition-colors cursor-pointer select-none focus:outline-hidden focus-visible:ring-2 focus-visible:ring-sky-500/40 ${current.badgeClass} ${
          isUpdating ? 'opacity-70 cursor-wait' : ''
        }`}
      >
        {isUpdating
          ? <Loader2 className="w-2.5 h-2.5 animate-spin text-sky-600" aria-hidden="true" />
          : <current.Icon className="w-2.5 h-2.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />}
        <span>{current.label}</span>
        <ChevronDown aria-hidden="true" className={`w-2.5 h-2.5 opacity-50 transition-transform motion-reduce:transition-none ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          id={menuId}
          role="menu"
          aria-label={`Stav položky ${tx.title}`}
          className={`absolute left-0 z-30 bg-white rounded-xl shadow-lg border border-slate-200 py-1 min-w-[160px] text-xs font-normal ${
            openUp ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {STATUS_ITEMS.map(({ value, label, Icon, activeClass, iconClass }) => {
            const isCurrent = tx.status === value;
            const disabled = isUpdating || (value === 'planned' && !isCurrent && !canBePlanned);
            return (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={isCurrent}
                disabled={disabled}
                title={value === 'planned' && !canBePlanned && !isCurrent ? PAST_PLANNED_HINT : undefined}
                onClick={() => {
                  close(true);
                  if (!isCurrent) onChange(value);
                }}
                className={`w-full text-left px-3 py-1.5 max-md:min-h-11 flex items-center gap-2 hover:bg-slate-50 focus:outline-hidden focus-visible:bg-slate-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 disabled:opacity-50 disabled:hover:bg-transparent transition-colors ${
                  isCurrent ? `font-bold ${activeClass}` : 'text-slate-500'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${iconClass}`} aria-hidden="true" />
                <span>{label}</span>
                {isCurrent && <Check className={`w-3 h-3 ml-auto ${iconClass}`} aria-hidden="true" />}
              </button>
            );
          })}
          {!canBePlanned && tx.status !== 'planned' && (
            <p className="px-3 pt-1 pb-1.5 text-xs text-slate-500 border-t border-slate-100 mt-1 max-w-[220px] whitespace-normal">
              {PAST_PLANNED_HINT}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
