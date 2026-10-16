import { SYNC_LABELS } from '../../services/syncController';
import React, { useState, useRef, useEffect } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { formatPeriodRange } from '../../services/periodService';
import { ChevronLeft, ChevronRight, Menu, Calendar, RefreshCw, LogOut } from 'lucide-react';

import { GoogleIcon } from '../common/GoogleIcon';
import { SyncStatusIcon, SyncStatusLabel, formatLastSync } from '../common/SyncStatusIndicator';
import { DisconnectDriveDialog } from '../common/DisconnectDriveDialog';
import { describeSyncError } from '../../services/syncErrorText';

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
  const isSyncProblem = driveSyncStatus === 'error' || driveSyncStatus === 'conflict';
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Escape zavře nabídku synchronizace a vrátí fokus na její tlačítko
  useEffect(() => {
    if (!menuOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [menuOpen]);

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
    <>
    <header className="h-16 min-h-16 shrink-0 bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-30 px-4 max-[359px]:px-2 sm:px-6 flex items-center justify-between gap-2 max-[359px]:gap-1 select-none">
      {/* Levá strana: mobilní menu + název sekce */}
      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
        <button
          type="button"
          onClick={onToggleMobileMenu}
          aria-label="Otevřít menu"
          className="p-3 -m-1 rounded-xl text-slate-500 hover:bg-slate-100 md:hidden shrink-0"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Na úzkém mobilu se název nevejde vedle navigace obdobím; aktivní sekci ukazuje menu */}
        <div className="min-w-0 hidden sm:block">
          <h1 className="text-base font-bold text-slate-900 leading-tight truncate">
            {activeScreenTitle}
          </h1>
        </div>
      </div>

      {/* Střed / Pravá strana: Google Disk + Tlačítko Aktuální období a navigace rozpočtovým obdobím */}
      <div className="flex items-center gap-2 max-[359px]:gap-1 sm:gap-3 shrink-0">
        {/* Google Drive tlačítko / stavový indikátor */}
        {!isDriveConnected ? (
          <button
            type="button"
            onClick={connectGoogleDrive}
            disabled={driveSyncStatus === 'syncing'}
            title="Připojit Google Disk pro automatické zálohování a synchronizaci"
            className="max-md:min-h-11 flex items-center gap-1.5 px-2.5 max-[359px]:px-2 sm:px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 shadow-sm transition-all hover:border-sky-300 active:scale-[0.98] cursor-pointer"
          >
            <GoogleIcon className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">
              {driveSyncStatus === 'syncing' ? 'Připojuji…' : 'Připojit Google Disk'}
            </span>
            <span className="sm:hidden">
              {driveSyncStatus === 'syncing' ? '…' : 'Disk'}
            </span>
          </button>
        ) : (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen(prev => !prev)}
              title="Stav synchronizace s Google Diskem"
              aria-label={`Google Disk: ${SYNC_LABELS[driveSyncStatus]}`}
              aria-expanded={menuOpen}
              className={`max-md:min-h-11 flex items-center gap-1.5 px-2.5 max-[359px]:px-2 sm:px-3 py-1.5 text-xs font-semibold rounded-xl border shadow-sm transition-all active:scale-[0.98] cursor-pointer ${
                isSyncProblem
                  ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                  : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-500 hover:border-sky-300'
              }`}
            >
              <GoogleIcon className="w-3.5 h-3.5 shrink-0" />
              {/* Každý stav má vlastní ikonu, takže se nečte jen z barvy; chyba a konflikt mají i text na každé šířce */}
              <SyncStatusIcon status={driveSyncStatus} />
              {isSyncProblem && (
                <span className="xl:hidden">{driveSyncStatus === 'conflict' ? 'Konflikt' : 'Chyba'}</span>
              )}
              {/* Text stavu ustupuje názvu obrazovky; do 1280px stačí ikona stavu */}
              <span className="hidden xl:inline">
                {SYNC_LABELS[driveSyncStatus]}
              </span>
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 w-72 rounded-2xl bg-white border border-slate-200 shadow-xl p-4 z-50 space-y-3 text-xs">
                {/* Uživatelský profil / Stav */}
                <div className="flex items-center gap-2.5 pb-2.5 border-b border-slate-100">
                  {driveUser?.photoLink ? (
                    <img
                      src={driveUser.photoLink}
                      alt={driveUser.displayName || 'Účet Google'}
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
                    <p className="text-xs text-slate-500 truncate">
                      {driveUser?.emailAddress || 'Připojeno ke Google Disku'}
                    </p>
                  </div>
                </div>

                {/* Informace o synchronizaci */}
                <div className="p-2.5 bg-slate-50 rounded-xl space-y-1 text-xs">
                  <div className="flex items-center justify-between text-slate-500">
                    <span>Stav:</span>
                    <SyncStatusLabel status={driveSyncStatus} iconClassName="w-3 h-3" />
                  </div>

                  <div className="flex items-center justify-between gap-2 text-slate-500">
                    <span>Poslední synchronizace:</span>
                    <span className="font-medium text-slate-500 text-right">
                      {formatLastSync(lastDriveSyncTime)}
                    </span>
                  </div>

                  {driveError && (
                    <p className="text-xs text-red-600 pt-1 border-t border-slate-200 mt-1">
                      {describeSyncError(driveError)}
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
                    className="max-md:min-h-11 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 font-semibold transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait disabled:hover:bg-sky-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${driveSyncStatus === 'syncing' ? 'animate-spin' : ''}`} />
                    <span>Synchronizovat nyní</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmDisconnectOpen(true);
                    }}
                    className="btn-secondary btn-secondary-danger w-full"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Odpojit Google Disk</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Navigace obdobím je stejná ve všech sekcích, záhlaví se mezi obrazovkami nemění */}
        <button
          type="button"
          onClick={goToCurrentPeriod}
          disabled={isCurrentPeriodSelected}
          title={isCurrentPeriodSelected ? 'Aktuální rozpočtové období je již vybrané.' : 'Přejít na aktuální rozpočtové období'}
          aria-label={isCurrentPeriodSelected ? 'Aktuální rozpočtové období je již vybrané.' : 'Přejít na aktuální rozpočtové období'}
          className={`flex items-center justify-center gap-1.5 max-md:min-w-11 max-md:min-h-11 md:px-2.5 md:py-1.5 lg:px-3 text-xs font-semibold rounded-xl border transition-all select-none shrink-0 ${
            isCurrentPeriodSelected
              ? 'bg-slate-50 text-slate-500 border-slate-200 cursor-not-allowed opacity-60'
              : 'bg-white text-slate-500 hover:text-sky-700 hover:bg-sky-50/70 border-slate-200 shadow-sm hover:border-sky-300 active:scale-[0.98] cursor-pointer'
          }`}
        >
          <Calendar className="w-3.5 h-3.5 text-sky-600 shrink-0" />
          <span className="hidden lg:inline whitespace-nowrap">Aktuální období</span>
        </button>

        <div className="flex items-center bg-slate-100 rounded-xl p-1 max-[359px]:p-0 text-xs shrink-0">
          <button
            onClick={goToPreviousPeriod}
            title="Předchozí období (←)"
            aria-label="Předchozí období"
            aria-keyshortcuts="ArrowLeft"
            className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-white transition-all shrink-0"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="px-2.5 max-[359px]:px-1 text-center min-w-[70px] md:min-w-[140px]">
            <span className="font-bold text-slate-900 block leading-tight whitespace-nowrap">
              {selectedPeriod.name}
            </span>
            <span className="text-xs text-slate-500 hidden md:block whitespace-nowrap">
              {formatPeriodRange(selectedPeriod)}
            </span>
          </div>

          <button
            onClick={goToNextPeriod}
            title="Následující období (→)"
            aria-label="Následující období"
            aria-keyshortcuts="ArrowRight"
            className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-white transition-all shrink-0"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>

    {/* Dialog stojí mimo hlavičku: její backdrop-blur by jinak uvěznil fixní vrstvu uvnitř hlavičky */}
    <DisconnectDriveDialog isOpen={confirmDisconnectOpen} onClose={() => setConfirmDisconnectOpen(false)} />
    </>
  );
};
