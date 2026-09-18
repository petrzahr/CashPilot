export type AccountType = 
  | 'checking'    // běžný účet
  | 'cash'        // hotovost
  | 'savings'     // spořicí účet
  | 'investment'  // investiční účet
  | 'pension'     // penzijní účet
  | 'other';      // jiný účet

export type AccountStatus = 'active' | 'archived';

export interface Account {
  // Once history is edited, current valuation fields are reconstructed from surviving snapshots.
  marketValueHistoryManaged?: boolean;
  // Retains the known baseline even when the first/last snapshot is deleted.
  investmentCorrectionInitiallyZero?: boolean;
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  initialBalanceInHaler: number;
  initialBalanceDate: string; // YYYY-MM-DD
  isUsableCash: boolean;
  isNetWorth: boolean;
  isDefault?: boolean;
  institution?: string;
  color: string;
  sortOrder: number;
  status: AccountStatus;
  currentMarketValueInHaler?: number; // Pro investiční účty
  investedAmountAdjustmentInHaler?: number; // Korekce vloženého kapitálu, nikoli peněžní pohyb
  marketValueUpdatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type CategoryType = 'income' | 'expense';
export type CategoryStatus = 'active' | 'archived';

export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  parentId?: string | null; // null pro hlavní kategorii
  color: string;
  icon: string;
  sortOrder: number;
  status: CategoryStatus;
  createdAt: string;
  updatedAt: string;
}

export type MovementType = 'income' | 'expense' | 'transfer' | 'balance_adjustment';
export type TransactionStatus = 'planned' | 'executed' | 'cancelled';

export interface Transaction {
  id: string;
  title: string;
  amountInHaler: number;
  date: string; // YYYY-MM-DD
  sequence: number; // Pořadí v rámci dne (souvislá inkrementální řada 1, 2, 3...)
  type: MovementType;
  sourceAccountId: string;
  targetAccountId?: string; // Povinné u transfer
  categoryId?: string | null;
  subcategoryId?: string | null;
  status: TransactionStatus;
  plannedAmountInHaler?: number; // Původní plánovaná částka
  actualAmountInHaler?: number;  // Skutečná částka po uskutečnění
  calculatedBalanceInHaler?: number; // Vypočítaný stav před korekcí
  actualBalanceInHaler?: number;     // Skutečný stav po korekci
  diffInHaler?: number;              // Kladná nebo záporná částka korekce
  recurringRuleId?: string;     // Vazba na pravidlo
  isException?: boolean;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export type RecurrenceFrequency = 
  | 'monthly'       // každý měsíc
  | 'bi_monthly'    // každé 2 měsíce
  | 'quarterly'     // čtvrtletně
  | 'semi_annually' // pololetně
  | 'annually'      // ročně
  | 'custom';       // vlastní interval ve dnech

export interface RecurringRule {
  id: string;
  title: string;
  amountInHaler: number;
  type: MovementType;
  frequency: RecurrenceFrequency;
  intervalDays?: number; // Pouze u custom
  dayOfMonth: number;    // Den v měsíci 1-31
  startDate: string;     // YYYY-MM-DD
  endDate?: string | null;// YYYY-MM-DD
  sourceAccountId: string;
  targetAccountId?: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  note?: string;
  isActive: boolean;
  orderHint?: number;          // Požadovaná pozice v rámci dne při generování výskytu (bez hintu = dnešní chování)
  orderHintUpdatedAt?: string; // Čas poslední změny orderHint - tie-break při kolizi dvou pravidel
  createdAt: string;
  updatedAt: string;
}

export interface RecurringException {
  updatedAt?: string; // Synchronizační metadata, ve starších datech chybí.
  id: string;
  ruleId: string;
  periodKey: string; // např. 2026-10
  overrideDate?: string;
  overrideAmountInHaler?: number;
  overrideSourceAccountId?: string;
  overrideTargetAccountId?: string;
  overrideCategoryId?: string | null;
  overrideSubcategoryId?: string | null;
  overrideSequence?: number; // Požadovaná pozice v rámci dne jen pro tuto periodu
  isCancelled?: boolean;
  createdAt: string;
}

export interface BalanceCorrection {
  id: string;
  accountId: string;
  checkDate: string; // YYYY-MM-DD
  actualBalanceInHaler: number;
  calculatedBalanceInHaler: number;
  diffInHaler: number;
  sequence?: number;
  type?: 'balance_adjustment';
  note?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface MarketValueSnapshot {
  id: string;
  accountId: string;
  date: string; // YYYY-MM-DD
  marketValueInHaler: number;
  effectiveInvestedAmountInHaler?: number; // Kapitál včetně korekce zachycený při ocenění; ve staré historii chybí.
  baseInvestedAmountInHaler?: number;
  investedAmountAdjustmentInHaler?: number;
  // False means this valuation inherits the preceding correction transition.
  correctionChanged?: boolean;
  // First recorded correction on an account that had no previous correction/history.
  correctionPreviouslyZero?: boolean;
  note?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface BudgetPeriod {
  key: string;       // YYYY-MM identifikátor počátku periody
  name: string;      // např. "Září 2026"
  year: number;
  month: number;     // 1-12
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

export interface AppSettings {
  currency: string;
  budgetStartDay: number; // Výchozí: 15
  overdraftLimitInHaler?: number; // Výše kontokorentu v haléřích (např. 20 000 Kč = 2 000 000)
  minReserveInHaler?: number; // @deprecated Pro zpětnou kompatibilitu původních dat
  roundAmounts: boolean;
  accountUsableOverrides?: Record<string, boolean>;
}

// Výpočtové struktury
export interface AccountPeriodBalance {
  accountId: string;
  openingBalanceInHaler: number;
  incomeInHaler: number;
  expenseInHaler: number;
  transfersInInHaler: number;
  transfersOutInHaler: number;
  correctionsInHaler: number;
  closingBalanceInHaler: number;
  investedPrincipalInHaler?: number;
  marketValueInHaler?: number;
  unrealizedGainLossInHaler?: number;
}

export interface PeriodSummary {
  period: BudgetPeriod;
  openingBalanceInHaler: number;
  incomeInHaler: number;
  expenseInHaler: number;
  transfersInHaler: number;
  correctionsInHaler: number;
  netChangeInHaler: number;
  closingBalanceInHaler: number;
  accountBalances: Record<string, AccountPeriodBalance>;
  usableOpeningInHaler: number;
  usableClosingInHaler: number;
  usableNetChangeInHaler: number;
  netWorthOpeningInHaler: number;
  netWorthClosingInHaler: number;
  isNegativeBalance: boolean;
  isBelowReserve: boolean;
  minUsableBalanceInHaler: number;
}

export interface ForecastResult {
  periods: PeriodSummary[];
  forecastPeriods?: PeriodSummary[];
  allPeriods?: PeriodSummary[];
  currentPeriod: BudgetPeriod;
  earliestShortagePeriod?: BudgetPeriod | null;
  overallMinBalanceInHaler: number;
  usableCashNowInHaler: number;
  expectedClosingCurrentPeriodInHaler: number;
  netWorthNowInHaler: number;
  plannedIncomeCurrentPeriodInHaler: number;
  plannedExpenseCurrentPeriodInHaler: number;
}

// Struktura pro denní průběžný zůstatek (intra-day)
export interface IntraDayStep {
  transaction: Transaction;
  runningBalanceInHaler: number;
  isTemporaryNegative: boolean;
}

export interface IntraDaySummary {
  date: string;
  startOfDayBalanceInHaler: number;
  endOfDayBalanceInHaler: number;
  hasTemporaryNegative: boolean;
  minBalanceDuringDayInHaler: number;
  steps: IntraDayStep[];
}
