import React, { useEffect, useId, useRef, useState } from 'react';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';

export interface RowAction {
  label: string;
  Icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

interface RowActionsMenuProps {
  /** Název položky do popisků pro čtečky, např. „Další akce: Nájem“ */
  itemLabel: string;
  actions: RowAction[];
}

/**
 * Méně častá akce řádku (duplikovat, zrušit, smazat) schovaná pod „…“, aby řádek
 * nesl jen stav, hlavní akci a úpravu. Ovládá se myší, dotykem i klávesnicí.
 */
export const RowActionsMenu: React.FC<RowActionsMenuProps> = ({ itemLabel, actions }) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const getItems = () =>
    Array.from(containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []);

  // Po otevření přejde fokus na první akci
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
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = (current + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };

  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (isOpen && !containerRef.current?.contains(e.relatedTarget as Node | null)) setIsOpen(false);
  };

  return (
    <div
      ref={containerRef}
      className="relative inline-block"
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onClick={(e) => e.stopPropagation()}
    >
      {isOpen && (
        <div className="fixed inset-0 z-20 cursor-default" onClick={() => close(false)} />
      )}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        aria-label={`Další akce: ${itemLabel}`}
        title="Další akce"
        onClick={() => setIsOpen(prev => !prev)}
        className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      >
        <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          id={menuId}
          role="menu"
          aria-label={`Další akce: ${itemLabel}`}
          className="absolute right-0 top-full mt-1 z-30 bg-white rounded-xl shadow-lg border border-slate-200 py-1 min-w-[180px] text-xs font-normal no-underline"
        >
          {actions.map(({ label, Icon, onSelect, disabled, destructive }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => {
                close(false);
                onSelect();
              }}
              className={`w-full text-left px-3 py-1.5 max-md:min-h-11 flex items-center gap-2 hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-100 disabled:opacity-50 transition-colors ${
                destructive ? 'text-red-600' : 'text-slate-700'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
