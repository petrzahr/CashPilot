import { SYNC_LABELS } from './services/syncController';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FinanceProvider, useFinance } from './context/FinanceContext';
import { Header } from './components/layout/Header';
import { Sidebar, NavScreen } from './components/layout/Sidebar';
import { OverviewScreen } from './components/overview/OverviewScreen';
import { AnalyticsScreen } from './components/analytics/AnalyticsScreen';
import { MandatoryExpensesScreen } from './components/mandatory/MandatoryExpensesScreen';
import { MonthlyBudgetScreen } from './components/budget/MonthlyBudgetScreen';
import { TransactionsScreen } from './components/transactions/TransactionsScreen';
import { AccountsScreen } from './components/accounts/AccountsScreen';
import { CategoriesScreen } from './components/categories/CategoriesScreen';
import { SettingsScreen } from './components/settings/SettingsScreen';
import { TransactionModal } from './components/transactions/TransactionModal';
import { LoginScreen } from './components/auth/LoginScreen';
import { DataLoadErrorScreen } from './components/common/DataLoadErrorScreen';
import { ToastContainer } from './components/common/ToastContainer';
import { MovementType, Transaction } from './types/finance';
import { AlertCircle, Loader2, Plus } from 'lucide-react';
import { describeSyncError } from './services/syncErrorText';

const VALID_SCREENS: NavScreen[] = ['budget', 'overview', 'analytics', 'mandatory', 'transactions', 'accounts', 'categories', 'settings'];


function parseScreenFromUrl(): NavScreen {
  if (typeof window === 'undefined') return 'budget';
  const hash = window.location.hash.replace(/^#\/?/, '').trim().toLowerCase();
  if (VALID_SCREENS.includes(hash as NavScreen)) {
    return hash as NavScreen;
  }
  return 'budget';
}

const MainLayout: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<NavScreen>(() => parseScreenFromUrl());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Při přepnutí obrazovky vždy začínáme odshora - scroll kontejner jinak
  // zůstává na pozici z předchozí obrazovky, protože se nepřekresluje.
  useEffect(() => {
    scrollContainerRef.current?.scrollTo(0, 0);
  }, [currentScreen]);

  // Globální správa modálu pro položky
  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [txToEdit, setTxToEdit] = useState<Transaction | null>(null);
  const [initialTxType, setInitialTxType] = useState<MovementType>('expense');
  const [initialTxDate, setInitialTxDate] = useState<string | undefined>(undefined);

  // Synchronizace s hash v URL (pro přímé odkazy, refresh stránky a historii Zpět/Vpřed)
  useEffect(() => {
    const handleHashChange = () => {
      const screen = parseScreenFromUrl();
      setCurrentScreen(screen);
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleSelectScreen = useCallback((screen: NavScreen) => {
    setCurrentScreen(screen);
    const currentHash = window.location.hash.replace(/^#\/?/, '').trim().toLowerCase();
    if (currentHash !== screen) {
      window.location.hash = screen;
    }
  }, []);

  const handleOpenNewTx = (initialDate?: string, initialType?: MovementType) => {
    setTxToEdit(null);
    setInitialTxDate(initialDate);
    if (initialType) setInitialTxType(initialType);
    setIsTxModalOpen(true);
  };

  const handleEditTx = (tx: Transaction) => {
    setTxToEdit(tx);
    setIsTxModalOpen(true);
  };

  // Klávesové zkratky: N = nová položka, ←/→ = předchozí/následující období, / = hledání.
  // Neplatí při psaní do pole, v otevřeném dialogu ani v ovladači, který šipky používá sám.
  const { goToPreviousPeriod, goToNextPeriod } = useFinance();
  const openNewTxRef = useRef(handleOpenNewTx);
  openNewTxRef.current = handleOpenNewTx;
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // „/“ se na české klávesnici píše se Shiftem, proto Shift u této zkratky nevadí
      const isSearchKey = e.key === '/';
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey || (e.shiftKey && !isSearchKey)) return;
      if (isTxModalOpen || mobileMenuOpen || document.querySelector('[role="dialog"]')) return;
      const target = e.target as HTMLElement | null;
      if (target && target !== document.body) {
        if (target.isContentEditable || target.closest('input, textarea, select, [role="tablist"], [role="radiogroup"], [role="listbox"], [role="menu"], [role="slider"]')) return;
        // Vodorovně posouvatelný kontejner (široká tabulka) šipky potřebuje k posunu
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && target.scrollWidth > target.clientWidth) return;
      }
      if (isSearchKey) {
        const search = document.querySelector<HTMLInputElement>('[data-search-input]');
        if (search && search.offsetParent !== null) {
          e.preventDefault();
          search.focus();
          search.select();
        }
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        openNewTxRef.current();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToPreviousPeriod();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goToNextPeriod();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isTxModalOpen, mobileMenuOpen, goToPreviousPeriod, goToNextPeriod]);

  const getScreenTitle = () => {
    switch (currentScreen) {
      case 'budget': return 'Měsíční rozpočet';
      case 'overview': return 'Přehledy';
      case 'analytics': return 'Analýza a trendy';
      case 'mandatory': return 'Mandatorní výdaje';
      case 'transactions': return 'Všechny položky';
      case 'accounts': return 'Účty';
      case 'categories': return 'Kategorie';
      case 'settings': return 'Nastavení';
    }
  };

  return (
    <div className="flex h-dvh bg-slate-50 overflow-hidden">
      {/* Postranní navigace */}
      <Sidebar
        currentScreen={currentScreen}
        onSelectScreen={handleSelectScreen}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        onOpenTransactionModal={() => handleOpenNewTx()}
      />

      {/* Hlavní obsahová oblast */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <Header
          activeScreenTitle={getScreenTitle()}          onToggleMobileMenu={() => setMobileMenuOpen(prev => !prev)}
        />

        <div ref={scrollContainerRef} className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          <main className="flex-1 p-4 pb-24 sm:p-6 sm:pb-24 md:pb-16 max-w-7xl w-full mx-auto">
            {/* Na telefonu se název sekce do hlavičky nevejde, proto stojí nad obsahem */}
            <h1 className="sm:hidden text-base font-bold text-slate-900 leading-tight mb-4">
              {getScreenTitle()}
            </h1>

            {currentScreen === 'budget' && (
              <MonthlyBudgetScreen
                onOpenTransactionModal={handleOpenNewTx}
                onEditTransaction={handleEditTx}
              />
            )}

            {currentScreen === 'overview' && (
              <OverviewScreen
                onNavigateToBudget={() => handleSelectScreen('budget')}
              />
            )}

            {currentScreen === 'analytics' && (
              <AnalyticsScreen />
            )}

            {currentScreen === 'mandatory' && (
              <MandatoryExpensesScreen />
            )}

            {currentScreen === 'transactions' && (
              <TransactionsScreen
                onOpenTransactionModal={handleOpenNewTx}
                onEditTransaction={handleEditTx}
              />
            )}

            {currentScreen === 'accounts' && (
              <AccountsScreen />
            )}

            {currentScreen === 'categories' && (
              <CategoriesScreen />
            )}

            {currentScreen === 'settings' && (
              <SettingsScreen />
            )}
          </main>
        </div>
      </div>

      {/* Rychlý zápis na telefonu: tlačítko v dosahu palce, na desktopu stačí akce v obsahu a postranním panelu */}
      {!isTxModalOpen && !mobileMenuOpen && (
        <button
          type="button"
          onClick={() => handleOpenNewTx()}
          className="md:hidden fixed bottom-4 right-4 z-40 flex items-center gap-2 h-14 pl-4 pr-5 rounded-2xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold shadow-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 focus-visible:ring-offset-2"
        >
          <Plus className="w-5 h-5" aria-hidden="true" />
          <span>Nová položka</span>
        </button>
      )}

      {/* Globální modál pro vytvoření a editaci transakcí */}
      <TransactionModal
        isOpen={isTxModalOpen}
        onClose={() => setIsTxModalOpen(false)}
        transactionToEdit={txToEdit}
        initialType={initialTxType}
        initialDate={initialTxDate}
      />

      {/* Toast notifikace */}
      <ToastContainer />
    </div>
  );
};

export function AppContent() {
  const {
    isDriveConnected,
    isCloudReady, driveSyncStatus, driveError, syncWithGoogleDrive, disconnectGoogleDrive,
    loadState,
    loadErrorDetails,
    restoreFromBackupFile,
    resetToFreshData,
    retryLoadData,
  } = useFinance();

  if (loadState === 'loadError') {
    return (
      <>
        <DataLoadErrorScreen
          errorMessage={loadErrorDetails?.message}
          recoveryKey={loadErrorDetails?.recoveryKey}
          corruptedRaw={loadErrorDetails?.corruptedRaw}
          onRestoreBackup={restoreFromBackupFile}
          onResetToFresh={resetToFreshData}
          onRetry={retryLoadData}
        />
        <ToastContainer />
      </>
    );
  }

  if (!isDriveConnected) {
    return (
      <>
        <LoginScreen />
        <ToastContainer />
      </>
    );
  }

  if (!isCloudReady) {
    // Při chybě přestane obrazovka předstírat načítání a nabídne cestu ven
    const hasError = !!driveError || driveSyncStatus === 'error' || driveSyncStatus === 'conflict';
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-4 p-6 max-w-sm" role="status">
          <div className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-sky-600 to-sky-500 text-white shadow-lg ${hasError ? '' : 'animate-pulse motion-reduce:animate-none'}`}>
            <img src="./favicon.svg?v=3" alt="" className="w-full h-full rounded-2xl" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">CashPilot</h1>
          <div className={`flex items-center justify-center gap-2 text-sm ${hasError ? 'text-red-700 font-semibold' : 'text-slate-500'}`}>
            {hasError
              ? <AlertCircle className="w-4 h-4 shrink-0 text-red-600" aria-hidden="true" />
              : <Loader2 className="w-4 h-4 animate-spin text-sky-600" aria-hidden="true" />}
            <p>{SYNC_LABELS[driveSyncStatus]}</p>
          </div>
          {hasError && <p className="text-sm text-slate-500">{describeSyncError(driveError)}</p>}
          {driveSyncStatus !== 'loading' && (
            <div className="flex flex-col items-center gap-2">
              <button type="button" onClick={() => void syncWithGoogleDrive()} className="btn-primary py-2.5">Zkusit znovu</button>
              {hasError && (
                <button type="button" onClick={() => void disconnectGoogleDrive()} className="btn-secondary">Odpojit Google Disk</button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
  return <MainLayout />;
}

export function App() {
  return (
    <FinanceProvider>
      <AppContent />
    </FinanceProvider>
  );
}

export default App;
