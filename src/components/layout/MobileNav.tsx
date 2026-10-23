import React from 'react';
import { Menu, type LucideIcon } from 'lucide-react';
import { NAV_ITEMS, NavScreen } from './Sidebar';

interface MobileNavProps {
  currentScreen: NavScreen;
  onSelectScreen: (screen: NavScreen) => void;
  drawerOpen: boolean;
  onOpenDrawer: () => void;
}

const PRIMARY_ITEMS = NAV_ITEMS.filter((item) => item.shortLabel);

const NavCell: React.FC<{ icon: LucideIcon; label: string; active: boolean }> = ({ icon: Icon, label, active }) => (
  <>
    <span
      className={`flex items-center justify-center w-12 h-7 rounded-md transition-colors ${
        active ? 'bg-sky-50 text-sky-700' : 'text-slate-500'
      }`}
    >
      <Icon className="w-5 h-5" aria-hidden="true" />
    </span>
    <span className={`text-xs font-semibold leading-4 truncate max-w-full ${active ? 'text-sky-700' : 'text-slate-500'}`}>
      {label}
    </span>
  </>
);

/** Spodní lišta jen na telefonu: hlavní sekce v dosahu palce, ostatní pod „Více“ (zásuvka). */
export const MobileNav: React.FC<MobileNavProps> = ({ currentScreen, onSelectScreen, drawerOpen, onOpenDrawer }) => {
  const moreActive = !PRIMARY_ITEMS.some((item) => item.id === currentScreen);

  // flex-auto: šířka podle popisku, aby se vše vešlo i na 320px bez zkracování
  const cellClass = 'flex-auto min-w-0 flex flex-col items-center justify-center gap-1 h-14 px-0.5 select-none focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500/40';

  return (
    <nav
      aria-label="Hlavní navigace"
      className="md:hidden fixed inset-x-0 bottom-0 z-30 bg-white border-t border-slate-200 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
    >
      <div className="flex items-stretch">
        {PRIMARY_ITEMS.map((item) => {
          const active = item.id === currentScreen;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectScreen(item.id)}
              aria-current={active ? 'page' : undefined}
              className={cellClass}
            >
              <NavCell icon={item.icon} label={item.shortLabel!} active={active} />
            </button>
          );
        })}
        <button
          type="button"
          onClick={onOpenDrawer}
          aria-expanded={drawerOpen}
          aria-controls="app-drawer"
          className={cellClass}
        >
          <NavCell icon={Menu} label="Více" active={moreActive} />
        </button>
      </div>
    </nav>
  );
};
