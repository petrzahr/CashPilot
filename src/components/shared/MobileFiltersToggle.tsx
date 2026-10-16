import React from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';

interface MobileFiltersToggleProps {
  isOpen: boolean;
  onToggle: () => void;
  /** Počet aktivních filtrů schovaných za tlačítkem */
  activeCount: number;
  controlsId: string;
}

/**
 * Na mobilu schová filtry (kromě hledání) za jedno tlačítko, aby seznam začínal výš.
 * Od md jsou filtry vždy rozbalené a tlačítko se nezobrazuje.
 */
export const MobileFiltersToggle: React.FC<MobileFiltersToggleProps> = ({ isOpen, onToggle, activeCount, controlsId }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-expanded={isOpen}
    aria-controls={controlsId}
    className="md:hidden sm:col-span-2 min-h-11 w-full flex items-center justify-between gap-2 px-3 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-500 hover:text-slate-900 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
  >
    <span className="flex items-center gap-1.5">
      <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
      Filtry
      {activeCount > 0 && (
        <span className="chip bg-sky-50 text-sky-700">{activeCount}</span>
      )}
    </span>
    <ChevronDown
      className={`w-4 h-4 transition-transform motion-reduce:transition-none ${isOpen ? 'rotate-180' : ''}`}
      aria-hidden="true"
    />
  </button>
);
