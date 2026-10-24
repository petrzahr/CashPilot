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
  orderRank?: number;          // Pořadí této platby mezi opakovanými platbami téhož dne (bez hintu = výchozí řazení)
  orderRankUpdatedAt?: string; // Čas poslední změny orderRank - tie-break při kolizi dvou pravidel
  orderPosition?: number;      // Požadovaná pozice ve dni (1 = první) i vůči ručním položkám, platí napříč obdobími
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
  note?: string;
  createdAt: string;
  updatedAt?: string;
}

/** Měsíční poplatek obchodníka investičního/penzijního účtu; nejvýše jeden za rozpočtové období. */
export interface InvestmentFee {
  id: string;
  accountId: string;
  periodKey: string; // YYYY-MM rozpočtového období
  amountInHaler: number;
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
  startDay: number;  // normalised budget start day (1-31) the period was built with; runtime only, never stored
}

export interface AppSettings {
  currency: string;
  budgetStartDay: number; // Výchozí: 15
  overdraftLimitInHaler?: number; // Výše kontokorentu v haléřích (např. 20 000 Kč = 2 000 000)
  minReserveInHaler?: number; // @deprecated Pro zpětnou kompatibilitu původních dat
  roundAmounts: boolean;
  accountUsableOverrides?: Record<string, boolean>;
  // Výchozí rozsah filtru období; chybějící nebo neznámá hodnota = vestavěná výchozí (od verze dat 2, nepovinné)
  defaultPeriodRanges?: Partial<Record<PeriodRangeScreen, PeriodRangePresetId>>;
}

export type PeriodRangeScreen = 'overview' | 'analytics';
export type PeriodRangePresetId =
  | 'past:all' | 'past:ytd' | 'past:12' | 'past:6' | 'past:3'
  | 'future:3' | 'future:6' | 'future:12' | 'future:18' | 'future:24';

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
  investedPrincipalInHaler?: number; // Základ pro výnos: vloženo − poplatky
  contributedPrincipalInHaler?: number; // Vloženo (čisté vklady)
  feesInHaler?: number; // Součet poplatků do konce období
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
  minUsableBalanceInHaler: number;
}

export interface ForecastResult {
  periods: PeriodSummary[];
  forecastPeriods?: PeriodSummary[];
  currentPeriod: BudgetPeriod;
  /** Period view for one period key of the forecast; undefined outside its period sequence. */
  getPeriod: (key: string) => PeriodView | undefined;
}

/** Default account totals for one period (Budget tiles and KPIs); all zero without a default account. */
export interface DefaultAccountPeriod {
  openingInHaler: number;
  incomeInHaler: number;
  expenseInHaler: number;
  netTransfersInHaler: number;
  netChangeInHaler: number;
  closingInHaler: number;
  /** Konečný stav včetně kontokorentu */
  withOverdraftInHaler: number;
  isOverdraftExceeded: boolean;
  /** Příjmy − výdaje + korekce výchozího účtu (bez převodů) */
  actuallySavedInHaler: number;
  actuallySavedPct: number | null;
  /** Čisté převody na spořicí účty */
  savedInHaler: number;
  savedPct: number | null;
  /** Čisté převody na investiční a penzijní účty */
  investedInHaler: number;
  investedPct: number | null;
}

/** One period of the forecast: see "Period view" in GLOSSARY.md. */
export interface PeriodView {
  period: BudgetPeriod;
  /** Current and future periods: investment accounts anchored at today's value; past periods: the recorded summary. */
  projected: PeriodSummary;
  /** Built from stored values only, with no projection. */
  recorded: PeriodSummary;
  /** Computed on first access from the projected summary and the forecast's effective items. */
  readonly defaultAccount: DefaultAccountPeriod;
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
