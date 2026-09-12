import React, { useState, useRef, useEffect } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { formatPeriodRange } from '../../services/periodService';
import { ChevronLeft, ChevronRight, Menu, Calendar, RefreshCw, LogOut, Cloud, AlertCircle, CheckCircle2 } from 'lucide-react';

const GoogleIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24">
    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/>
    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"/>
    <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.97 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
  </svg>
);

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
    driveSyncStatus,
    isDriveConnected,
    driveUser,
    lastDriveSyncTime,
    driveError,
    connectGoogleDrive,
    disconnectGoogleDrive,
    syncWithGoogleDrive,
  } = useFinance();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

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

      {/* Střed / Pravá strana: Google Disk + Tlačítko Aktuální období a navigace rozpočtovým obdobím */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* Google Drive tlačítko / stavový indikátor */}
        {!isDriveConnected ? (
          <button
            type="button"
            onClick={connectGoogleDrive}
            disabled={driveSyncStatus === 'syncing'}
            title="Připojit Google Disk pro automatické zálohování a synchronizaci"
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 shadow-sm transition-all hover:border-sky-300 active:scale-[0.98] cursor-pointer"
          >
            <GoogleIcon className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">
              {driveSyncStatus === 'syncing' ? 'Připojuji...' : 'Připojit Google Disk'}
            </span>
            <span className="sm:hidden">
              {driveSyncStatus === 'syncing' ? '...' : 'Disk'}
            </span>
          </button>
        ) : (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen(prev => !prev)}
              title="Google Disk připojen – klikněte pro podrobnosti a synchronizaci"
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 shadow-sm transition-all hover:border-sky-300 active:scale-[0.98] cursor-pointer"
            >
              <GoogleIcon className="w-3.5 h-3.5 shrink-0" />
              <span className="relative flex h-2 w-2">
                {driveSyncStatus === 'syncing' && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                )}
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${
                    driveSyncStatus === 'syncing'
                      ? 'bg-sky-500'
                      : driveSyncStatus === 'error'
                      ? 'bg-amber-500'
                      : 'bg-emerald-500'
                  }`}
                ></span>
              </span>
              <span className="hidden sm:inline">
                {driveSyncStatus === 'syncing'
                  ? 'Ukládám...'
                  : driveSyncStatus === 'error'
                  ? 'Chyba'
                  : 'Synchronizováno'}
              </span>
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 w-72 rounded-2xl bg-white border border-slate-200/90 shadow-xl p-3.5 z-50 space-y-3 text-xs animate-in fade-in zoom-in-95 duration-100">
                {/* Uživatelský profil / Stav */}
                <div className="flex items-center gap-2.5 pb-2.5 border-b border-slate-100">
                  {driveUser?.photoLink ? (
                    <img
                      src={driveUser.photoLink}
                      alt={driveUser.displayName || 'Google Uživatel'}
                      className="w-8 h-8 rounded-full border border-slate-200 shrink-0"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center font-bold text-xs shrink-0">
                      {driveUser?.displayName ? driveUser.displayName[0].toUpperCase() : 'G'}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-900 truncate">
                      {driveUser?.displayName || 'Google Disk'}
                    </p>
                    <p className="text-[11px] text-slate-500 truncate">
                      {driveUser?.emailAddress || 'Prostor appDataFolder'}
                    </p>
                  </div>
                </div>

                {/* Informace o synchronizaci */}
                <div className="p-2.5 bg-slate-50 rounded-xl space-y-1 text-[11px]">
                  <div className="flex items-center justify-between text-slate-600">
                    <span>Stav:</span>
                    <span className="font-semibold flex items-center gap-1">
                      {driveSyncStatus === 'syncing' ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin text-sky-600" />
                          <span className="text-sky-600">Probíhá zápis</span>
                        </>
                      ) : driveSyncStatus === 'error' ? (
                        <>
                          <AlertCircle className="w-3 h-3 text-amber-600" />
                          <span className="text-amber-600">Chyba</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span className="text-emerald-700">Synchronizováno</span>
                        </>
                      )}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-500">
                    <span>Poslední uložení:</span>
                    <span className="font-medium text-slate-700">
                      {lastDriveSyncTime
                        ? lastDriveSyncTime.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                        : 'Při této relaci'}
                    </span>
                  </div>

                  {driveError && (
                    <p className="text-[10px] text-red-600 pt-1 border-t border-slate-200 mt-1">
                      {driveError}
                    </p>
                  )}
                </div>

                {/* Tlačítka */}
                <div className="space-y-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      syncWithGoogleDrive('upload');
                      setMenuOpen(false);
                    }}
                    disabled={driveSyncStatus === 'syncing'}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 font-semibold transition-colors cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${driveSyncStatus === 'syncing' ? 'animate-spin' : ''}`} />
                    <span>Synchronizovat nyní</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      disconnectGoogleDrive();
                      setMenuOpen(false);
                    }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-xl text-slate-500 hover:text-red-600 hover:bg-red-50 font-medium transition-colors cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Odpojit Google Disk</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

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
