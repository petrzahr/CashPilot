import React from 'react';
import { useFinance } from '../../context/FinanceContext';
import { formatPeriodRange } from '../../services/periodService';
import { ChevronLeft, ChevronRight, Menu, Calendar } from 'lucide-react';

interface HeaderProps {
  onToggleMobileMenu: () => void;
  activeScreenTitle: string;
}

export const Header: React.FC<HeaderProps> = ({
  onToggleMobileMenu,
  activeScreenTitle,
}) => {
  const {
    selectedPeriod,
    goToNextPeriod,
    goToPreviousPeriod,
    goToCurrentPeriod,
    isCurrentPeriodSelected,
  } = useFinance();

  return (
    <header className="h-16 min-h-16 shrink-0 bg-white/80 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-30 px-4 sm:px-6 flex items-center justify-between gap-2 select-none">
      {/* Levá strana: mobilní menu + název sekce */}
      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
        <button
          onClick={onToggleMobileMenu}
          className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 md:hidden shrink-0"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="min-w-0">
          <h1 className="text-base font-bold text-slate-900 leading-tight truncate">
            {activeScreenTitle}
          </h1>
          <p className="text-[11px] text-slate-400 font-medium hidden sm:block truncate">
            CashPilot – Osobní finanční forecast
          </p>
        </div>
      </div>

      {/* Střed / Pravá strana: Tlačítko Aktuální období a navigace rozpočtovým obdobím */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <button
          type="button"
          onClick={goToCurrentPeriod}
          disabled={isCurrentPeriodSelected}
          title={isCurrentPeriodSelected ? 'Aktuální rozpočtové období je již vybrané.' : 'Přejít na aktuální rozpočtové období'}
          aria-label={isCurrentPeriodSelected ? 'Aktuální rozpočtové období je již vybrané.' : 'Přejít na aktuální rozpočtové období'}
          className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-xl border transition-all select-none shrink-0 ${
            isCurrentPeriodSelected
              ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed opacity-60'
              : 'bg-white text-slate-700 hover:text-sky-700 hover:bg-sky-50/70 border-slate-200 shadow-sm hover:border-sky-300 active:scale-[0.98] cursor-pointer'
          }`}
        >
          <Calendar className="w-3.5 h-3.5 text-sky-600 shrink-0" />
          <span className="whitespace-nowrap">Aktuální období</span>
        </button>

        <div className="flex items-center bg-slate-100/80 rounded-xl p-1 text-xs shrink-0">
          <button
            onClick={goToPreviousPeriod}
            title="Předchozí období"
            className="p-1 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-white transition-all shrink-0"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="px-2.5 text-center min-w-[70px] md:min-w-[140px]">
            <span className="font-bold text-slate-900 block leading-tight whitespace-nowrap">
              {selectedPeriod.name}
            </span>
            <span className="text-[10px] text-slate-500 hidden md:block whitespace-nowrap">
              {formatPeriodRange(selectedPeriod)}
            </span>
          </div>

          <button
            onClick={goToNextPeriod}
            title="Následující období"
            className="p-1 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-white transition-all shrink-0"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
