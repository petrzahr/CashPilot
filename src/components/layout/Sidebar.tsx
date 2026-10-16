import React, { useEffect, useRef, useState } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { formatCurrency } from '../../services/currencyService';
import { formatCzechDate, getTodayInPrague } from '../../services/periodService';
import { 
  LayoutDashboard, 
  CalendarDays, 
  Receipt, 
  Landmark, 
  FolderTree, 
  Settings, 
  Plus, 
  X, 
  TrendingUp,
  Repeat
} from 'lucide-react';

const MOBILE_QUERY = '(max-width: 767.98px)';

export type NavScreen = 'budget' | 'overview' | 'analytics' | 'mandatory' | 'transactions' | 'accounts' | 'categories' | 'settings';

interface SidebarProps {
  currentScreen: NavScreen;
  onSelectScreen: (screen: NavScreen) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onOpenTransactionModal: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentScreen,
  onSelectScreen,
  mobileOpen,
  onCloseMobile,
  onOpenTransactionModal,
}) => {
  const { quickOverview } = useFinance();
  const asideRef = useRef<HTMLElement>(null);

  // Na mobilu je menu vysouvací vrstva: zavřené je mimo pořadí Tab, otevřené drží fokus a zavře se Escapem
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(MOBILE_QUERY).matches
      : false
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  const isDrawerOpen = isMobile && mobileOpen;
  // Rodič předává novou funkci při každém vykreslení; ref zabrání opakovanému přesunu fokusu
  const onCloseMobileRef = useRef(onCloseMobile);
  onCloseMobileRef.current = onCloseMobile;

  useEffect(() => {
    if (!isDrawerOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    asideRef.current?.querySelector<HTMLElement>('button')?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseMobileRef.current();
        return;
      }
      if (e.key !== 'Tab' || !asideRef.current) return;
      const focusable = Array.from(asideRef.current.querySelectorAll<HTMLElement>('button, a[href]'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [isDrawerOpen]);

  // React 18 typy atribut inert neznají; prázdný řetězec ho v DOM zapne
  const drawerAttributes: Record<string, unknown> = isMobile
    ? mobileOpen
      ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Hlavní menu' }
      : { inert: '', 'aria-hidden': true }
    : {};

  const navItems: { id: NavScreen; label: string; icon: React.ReactNode }[] = [
    { id: 'budget', label: 'Měsíční rozpočet', icon: <CalendarDays className="w-4 h-4" /> },
    { id: 'overview', label: 'Přehledy', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'analytics', label: 'Analýza a trendy', icon: <TrendingUp className="w-4 h-4" /> },
    { id: 'mandatory', label: 'Mandatorní výdaje', icon: <Repeat className="w-4 h-4" /> },
    { id: 'transactions', label: 'Všechny položky', icon: <Receipt className="w-4 h-4" /> },
    { id: 'accounts', label: 'Účty', icon: <Landmark className="w-4 h-4" /> },
    { id: 'categories', label: 'Kategorie', icon: <FolderTree className="w-4 h-4" /> },
    { id: 'settings', label: 'Nastavení', icon: <Settings className="w-4 h-4" /> },
  ];

  const handleNavClick = (id: NavScreen) => {
    onSelectScreen(id);
    onCloseMobile();
  };

  return (
    <>
      {/* Mobilní backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-scrim/30 backdrop-blur-xs z-40 md:hidden"
          onClick={onCloseMobile}
        />
      )}

      <aside
        ref={asideRef}
        {...drawerAttributes}
        className={`fixed md:static inset-y-0 left-0 z-50 w-64 shrink-0 bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 ease-in-out motion-reduce:transition-none ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Logo a záhlaví: výška a spodní linka navazují na hlavičku obsahu */}
        <div className="h-16 shrink-0 px-5 border-b border-slate-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 shrink-0 rounded-xl bg-gradient-to-tr from-sky-600 to-sky-500 text-white flex items-center justify-center shadow-md">
              <img src="./favicon.svg?v=3" alt="" className="w-full h-full rounded-xl" />
            </div>
            <div className="min-w-0">
              <span className="text-base font-extrabold tracking-tight text-slate-900 block leading-none">
                CashPilot
              </span>
              <span className="text-xs leading-4 text-slate-500 font-medium block mt-1">
                Vaše osobní finance pod kontrolou
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Zavřít menu"
            className="p-3 -m-2 shrink-0 rounded-lg text-slate-500 hover:text-slate-600 md:hidden"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Akce a navigace: při nízkém okně se posouvá, přehled majetku zůstává dole */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pt-5 pb-3 space-y-6">
          {/* Rychlé tlačítko přidání */}
          <button
            onClick={() => {
              onOpenTransactionModal();
              onCloseMobile();
            }}
            className="max-md:min-h-11 w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-xl shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Nová položka</span>
          </button>

          {/* Navigační položky */}
          <nav className="space-y-1">
            {navItems.map((item) => {
              const isActive = currentScreen === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavClick(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`max-md:min-h-11 w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-sky-50 text-sky-700 shadow-xs'
                      : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <span className={isActive ? 'text-sky-600' : 'text-slate-500'}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Spodní rychlý finanční přehled k dnešnímu dni */}
        <div className="shrink-0 p-4 m-3 mt-0 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 text-xs">
          {/* Přehled platí k dnešku, ne k období vybranému v záhlaví.
              Nadpis a souhrn rámují kartu stejným popiskem jako KPI v rozpočtu; výraznost nese jen částka majetku. */}
          <p className="flex items-baseline justify-between gap-2 pb-1">
            <span className="font-semibold text-slate-500 uppercase tracking-wide">K dnešku</span>
            <span className="font-medium text-slate-500 tabular-nums">{formatCzechDate(getTodayInPrague())}</span>
          </p>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-slate-500">
              <span className="truncate pr-2" title="Běžné účty">Běžné účty</span>
              <span className={`shrink-0 font-medium tabular-nums ${quickOverview.checkingInHaler < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                {formatCurrency(quickOverview.checkingInHaler)}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-500">
              <span className="truncate pr-2" title="Hotovost">Hotovost</span>
              <span className={`shrink-0 font-medium tabular-nums ${quickOverview.cashInHaler < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                {formatCurrency(quickOverview.cashInHaler)}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-500">
              <span className="truncate pr-2" title="Spořicí účty">Spořicí účty</span>
              <span className={`shrink-0 font-medium tabular-nums ${quickOverview.savingsInHaler < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                {formatCurrency(quickOverview.savingsInHaler)}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-500">
              <span className="truncate pr-2" title="Investice">Investice</span>
              <span className={`shrink-0 font-medium tabular-nums ${quickOverview.investmentsInHaler < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                {formatCurrency(quickOverview.investmentsInHaler)}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-500">
              <span className="truncate pr-2" title="Penzijní účty">Penzijní účty</span>
              <span className={`shrink-0 font-medium tabular-nums ${quickOverview.pensionInHaler < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                {formatCurrency(quickOverview.pensionInHaler)}
              </span>
            </div>
          </div>

          {/* Souhrn jako dlaždice KPI: popisek nad částkou, protože vedle sebe se do šířky menu nevejdou */}
          <div className="border-t border-slate-200 pt-2">
            <span className="block font-semibold text-slate-500 uppercase tracking-wide truncate" title="Celkový majetek">Celkový majetek</span>
            <span className={`block mt-0.5 font-extrabold text-base tabular-nums truncate ${quickOverview.totalNetWorthInHaler < 0 ? 'text-red-600' : 'text-purple-600'}`}>
              {formatCurrency(quickOverview.totalNetWorthInHaler)}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
};
