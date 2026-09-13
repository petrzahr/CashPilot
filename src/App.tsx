import React, { useState, useEffect, useCallback } from 'react';
import { FinanceProvider, useFinance } from './context/FinanceContext';
import { Header } from './components/layout/Header';
import { Sidebar, NavScreen } from './components/layout/Sidebar';
import { AlertBanner } from './components/layout/AlertBanner';
import { OverviewScreen } from './components/overview/OverviewScreen';
import { AnalyticsScreen } from './components/analytics/AnalyticsScreen';
import { MonthlyBudgetScreen } from './components/budget/MonthlyBudgetScreen';
import { TransactionsScreen } from './components/transactions/TransactionsScreen';
import { AccountsScreen } from './components/accounts/AccountsScreen';
import { CategoriesScreen } from './components/categories/CategoriesScreen';
import { SettingsScreen } from './components/settings/SettingsScreen';
import { TransactionModal } from './components/transactions/TransactionModal';
import { LoginScreen } from './components/auth/LoginScreen';
import { ToastContainer } from './components/common/ToastContainer';
import { MovementType, Transaction } from './types/finance';
import { formatMonthsCount } from './services/periodService';

const VALID_SCREENS: NavScreen[] = ['budget', 'overview', 'analytics', 'transactions', 'accounts', 'categories', 'settings'];

function parseScreenFromUrl(): NavScreen {
  if (typeof window === 'undefined') return 'budget';
  const hash = window.location.hash.replace(/^#\/?/, '').trim().toLowerCase();
  if (VALID_SCREENS.includes(hash as NavScreen)) {
    return hash as NavScreen;
  }
  return 'budget';
}

const MainLayout: React.FC = () => {
  const {
    settings,
    data,
  } = useFinance();
  const forecastMonths = settings.forecastMonths || 12;

  const [currentScreen, setCurrentScreen] = useState<NavScreen>(() => parseScreenFromUrl());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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

  const getScreenTitle = () => {
    switch (currentScreen) {
      case 'budget': return 'Měsíční rozpočet';
      case 'overview': return `Přehled & výhled na ${formatMonthsCount(forecastMonths)}`;
      case 'analytics': return 'Analýza & trendy';
      case 'transactions': return 'Všechny položky';
      case 'accounts': return 'Správa účtů';
      case 'categories': return 'Kategorie';
      case 'settings': return 'Nastavení aplikace';
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
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
          activeScreenTitle={getScreenTitle()}
          onToggleMobileMenu={() => setMobileMenuOpen(prev => !prev)}
        />

        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          {/* Upozorňovací banner na rizika a pokles rezervy */}
          <AlertBanner />

          <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
            {currentScreen === 'budget' && (
              <MonthlyBudgetScreen
                onOpenTransactionModal={handleOpenNewTx}
                onEditTransaction={handleEditTx}
              />
            )}

            {currentScreen === 'overview' && (
              <OverviewScreen
                onNavigateToBudget={(p) => handleSelectScreen('budget')}
              />
            )}

            {currentScreen === 'analytics' && (
              <AnalyticsScreen
                onEditTransaction={handleEditTx}
              />
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
  const { isDriveConnected } = useFinance();

  if (!isDriveConnected) {
    return (
      <>
        <LoginScreen />
        <ToastContainer />
      </>
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
