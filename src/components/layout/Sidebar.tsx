import React from 'react';
import { useFinance } from '../../context/FinanceContext';
import { formatCurrency } from '../../services/currencyService';
import { 
  LayoutDashboard, 
  CalendarDays, 
  Receipt, 
  Landmark, 
  FolderTree, 
  Settings, 
  Plus, 
  X, 
  TrendingUp 
} from 'lucide-react';

export type NavScreen = 'budget' | 'overview' | 'analytics' | 'transactions' | 'accounts' | 'categories' | 'settings';

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

  const navItems: { id: NavScreen; label: string; icon: React.ReactNode }[] = [
    { id: 'budget', label: 'Měsíční rozpočet', icon: <CalendarDays className="w-4 h-4" /> },
    { id: 'overview', label: 'Přehled', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'analytics', label: 'Analýza & trendy', icon: <TrendingUp className="w-4 h-4" /> },
    { id: 'transactions', label: 'Položky', icon: <Receipt className="w-4 h-4" /> },
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
          className="fixed inset-0 bg-slate-900/30 backdrop-blur-xs z-40 md:hidden"
          onClick={onCloseMobile}
        />
      )}

      <aside
        className={`fixed md:static inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200/80 flex flex-col justify-between transition-transform duration-200 ease-in-out ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="p-5 space-y-6">
          {/* Logo a záhlaví */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-600 to-sky-500 text-white flex items-center justify-center shadow-md shadow-sky-500/20">
                <img src="./favicon.svg?v=3" alt="" className="w-full h-full rounded-xl" />
              </div>
              <div>
                <span className="text-base font-extrabold tracking-tight text-slate-900 block leading-none">
                  CashPilot
                </span>
                <span className="text-[10px] text-slate-400 font-medium tracking-wide block mt-0.5">
                  Vaše osobní finance pod kontrolou
                </span>
              </div>
            </div>

            <button
              onClick={onCloseMobile}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 md:hidden"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Rychlé tlačítko přidání */}
          <button
            onClick={() => {
              onOpenTransactionModal();
              onCloseMobile();
            }}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-xl shadow-sm shadow-sky-300 transition-all hover:shadow-md hover:shadow-sky-400/20"
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
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-sky-50 text-sky-700 shadow-xs'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <span className={isActive ? 'text-sky-600' : 'text-slate-400'}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Spodní rychlý finanční přehled k dnešnímu dni */}
        <div className="p-3.5 m-3 bg-slate-50 border border-slate-200/70 rounded-2xl space-y-2 text-xs">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-slate-600">
              <span className="truncate pr-2" title="Běžné účty + hotovost">Běžné účty + hotovost</span>
              <span className={`shrink-0 font-medium tabular-nums ${quickOverview.checkingAndCashInHaler < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                {formatCurrency(quickOverview.checkingAndCashInHaler)}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-600">
              <span className="truncate pr-2" title="Spořicí účty">Spořicí účty</span>
              <span className={`shrink-0 font-medium tabular-nums ${quickOverview.savingsInHaler < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                {formatCurrency(quickOverview.savingsInHaler)}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-600">
              <span className="truncate pr-2" title="Investice">Investice</span>
              <span className={`shrink-0 font-medium tabular-nums ${quickOverview.investmentsInHaler < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                {formatCurrency(quickOverview.investmentsInHaler)}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-600">
              <span className="truncate pr-2" title="Penzijní účty">Penzijní účty</span>
              <span className={`shrink-0 font-medium tabular-nums ${quickOverview.pensionInHaler < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                {formatCurrency(quickOverview.pensionInHaler)}
              </span>
            </div>
          </div>

          <div className="border-t border-slate-200/80 pt-2 flex items-center justify-between">
            <span className="font-bold text-slate-700 truncate pr-2" title="Celkové jmění">Celkové jmění</span>
            <span className={`shrink-0 font-extrabold text-sm tabular-nums ${quickOverview.totalNetWorthInHaler < 0 ? 'text-red-600' : 'text-slate-900'}`}>
              {formatCurrency(quickOverview.totalNetWorthInHaler)}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
};
