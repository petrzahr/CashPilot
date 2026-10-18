import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { useFinance } from '../context/FinanceContext';
import { MonthlyBudgetScreen } from '../components/budget/MonthlyBudgetScreen';
import { calculateForecast } from '../services/financialEngine';
import { calculateDefaultAccountKpis } from '../services/budgetKpiService';
import { formatCurrency } from '../services/currencyService';
import { DEFAULT_SETTINGS } from '../services/demoData';
import { Account, AccountType, BudgetPeriod, Transaction } from '../types/finance';

vi.mock('../context/FinanceContext', () => ({ useFinance: vi.fn() }));

const period: BudgetPeriod = {
  key: '2026-09', name: 'Září 2026', year: 2026, month: 9,
  startDate: '2026-09-15', endDate: '2026-10-14',
};

const makeAccount = (id: string, type: AccountType, overrides: Partial<Account> = {}): Account => ({
  id, name: id, type, currency: 'CZK',
  initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01',
  isUsableCash: type === 'checking' || type === 'cash', isNetWorth: true,
  color: '', sortOrder: 1, status: 'active',
  createdAt: '', updatedAt: '',
  ...overrides,
});

let txSeq = 0;
const makeTx = (overrides: Partial<Transaction> & Pick<Transaction, 'type' | 'sourceAccountId' | 'amountInHaler'>): Transaction => ({
  id: `tx${txSeq++}`, title: 'Test', date: '2026-09-16', sequence: 1,
  status: 'planned', createdAt: '', updatedAt: '',
  ...overrides,
});

describe('KPI dlaždice z výchozího účtu (calculateDefaultAccountKpis)', () => {
  const checking = makeAccount('checking', 'checking', { isDefault: true });
  const checking2 = makeAccount('checking2', 'checking');
  const cash = makeAccount('cash', 'cash');
  const savings = makeAccount('savings', 'savings');
  const investment = makeAccount('investment', 'investment');
  const pension = makeAccount('pension', 'pension');
  const other = makeAccount('other', 'other');
  const accounts = [checking, checking2, cash, savings, investment, pension, other];

  const kpis = (txs: Transaction[], defaultAccount: Account | null = checking) => {
    const forecast = calculateForecast([period], accounts, txs, [], [], [], DEFAULT_SETTINGS);
    const balance = defaultAccount ? forecast.periods[0].accountBalances[defaultAccount.id] : undefined;
    return calculateDefaultAccountKpis(defaultAccount ?? undefined, accounts, balance, txs);
  };

  it('Skutečně uspořeno = příjmy − výdaje + korekce výchozího účtu', () => {
    const result = kpis([
      makeTx({ type: 'income', sourceAccountId: checking.id, amountInHaler: 500000 }),
      makeTx({ type: 'expense', sourceAccountId: checking.id, amountInHaler: 200000 }),
      makeTx({ type: 'balance_adjustment', sourceAccountId: checking.id, amountInHaler: 30000, diffInHaler: 30000 }),
    ]);
    expect(result.actuallySavedInHaler).toBe(330000);
    expect(result.actuallySavedPct).toBeCloseTo(66, 6);
  });

  it('příjmy a výdaje ostatních účtů (i běžných a hotovostních) se nepočítají ani do základu %', () => {
    const result = kpis([
      makeTx({ type: 'income', sourceAccountId: checking.id, amountInHaler: 100000 }),
      makeTx({ type: 'income', sourceAccountId: checking2.id, amountInHaler: 900000 }),
      makeTx({ type: 'expense', sourceAccountId: cash.id, amountInHaler: 50000 }),
      makeTx({ type: 'income', sourceAccountId: pension.id, amountInHaler: 22000 }),
      makeTx({ type: 'income', sourceAccountId: other.id, amountInHaler: 10000 }),
    ]);
    expect(result.actuallySavedInHaler).toBe(100000);
    expect(result.actuallySavedPct).toBe(100);
  });

  it('Uspořeno a Investováno jsou čisté převody mezi výchozím účtem a spořicími / investičními a penzijními účty', () => {
    const result = kpis([
      makeTx({ type: 'income', sourceAccountId: checking.id, amountInHaler: 1000000 }),
      makeTx({ type: 'transfer', sourceAccountId: checking.id, targetAccountId: savings.id, amountInHaler: 200000 }),
      makeTx({ type: 'transfer', sourceAccountId: savings.id, targetAccountId: checking.id, amountInHaler: 50000 }),
      makeTx({ type: 'transfer', sourceAccountId: checking.id, targetAccountId: investment.id, amountInHaler: 100000 }),
      makeTx({ type: 'transfer', sourceAccountId: checking.id, targetAccountId: pension.id, amountInHaler: 17000 }),
      makeTx({ type: 'transfer', sourceAccountId: checking.id, targetAccountId: savings.id, amountInHaler: 99000, status: 'cancelled' }),
    ]);
    expect(result.savedInHaler).toBe(150000);
    expect(result.savedPct).toBe(15);
    expect(result.investedInHaler).toBe(117000);
    expect(result.investedPct).toBeCloseTo(11.7, 6);
    // Převody Skutečně uspořeno neovlivní
    expect(result.actuallySavedInHaler).toBe(1000000);
  });

  it('převody mezi jinými účty než výchozím se nepočítají', () => {
    const result = kpis([
      makeTx({ type: 'income', sourceAccountId: checking.id, amountInHaler: 100000 }),
      makeTx({ type: 'transfer', sourceAccountId: checking2.id, targetAccountId: savings.id, amountInHaler: 30000 }),
      makeTx({ type: 'transfer', sourceAccountId: savings.id, targetAccountId: investment.id, amountInHaler: 20000 }),
    ]);
    expect(result.savedInHaler).toBe(0);
    expect(result.investedInHaler).toBe(0);
  });

  it('procenta jsou null (zobrazí se "—"), když výchozí účet nemá v období příjmy', () => {
    const result = kpis([makeTx({ type: 'expense', sourceAccountId: checking.id, amountInHaler: 20000 })]);
    expect(result.actuallySavedInHaler).toBe(-20000);
    expect(result.actuallySavedPct).toBeNull();
    expect(result.savedPct).toBeNull();
    expect(result.investedPct).toBeNull();
  });

  it('bez výchozího účtu jsou částky 0 a procenta null', () => {
    const result = kpis([
      makeTx({ type: 'income', sourceAccountId: checking.id, amountInHaler: 100000 }),
      makeTx({ type: 'transfer', sourceAccountId: checking.id, targetAccountId: savings.id, amountInHaler: 30000 }),
    ], null);
    expect(result).toEqual({
      actuallySavedInHaler: 0, actuallySavedPct: null,
      savedInHaler: 0, savedPct: null,
      investedInHaler: 0, investedPct: null,
    });
  });
});

describe('MonthlyBudgetScreen — nové rozvržení karet', () => {
  const checking = makeAccount('checking', 'checking', { isDefault: true, isUsableCash: true });
  const savings = makeAccount('savings', 'savings');
  const accounts = [checking, savings];

  const renderScreen = (txs: Transaction[]) => {
    const forecast = calculateForecast([period], accounts, txs, [], [], [], DEFAULT_SETTINGS, [], period.key, '2026-10-01');
    vi.mocked(useFinance).mockReturnValue({
      selectedPeriod: period, forecast, settings: DEFAULT_SETTINGS, accounts, categories: [],
      transactions: txs, recurringRules: [], recurringExceptions: [], marketValueSnapshots: [],
      setTransactionStatus: vi.fn(), markTransactionExecuted: vi.fn(),
      cancelTransaction: vi.fn(), deleteTransaction: vi.fn(), reorderDayTransactions: vi.fn(), showToast: vi.fn(),
    } as unknown as ReturnType<typeof useFinance>);

    const html = renderToStaticMarkup(
      <MonthlyBudgetScreen onOpenTransactionModal={vi.fn()} onEditTransaction={vi.fn()} onDuplicateTransaction={vi.fn()} />
    );
    return { html, forecast };
  };

  it('karty "Použitelný zůstatek" a "Celkový majetek" se vykreslují úplně nahoře, nad výchozím účtem i kartou "Skutečně uspořeno", se správnými hodnotami', () => {
    const txs = [
      makeTx({ type: 'income', sourceAccountId: checking.id, amountInHaler: 500000, date: '2026-09-16' }),
    ];
    const { html, forecast } = renderScreen(txs);
    const p0 = forecast.periods[0];

    const usableIdx = html.indexOf('Použitelný zůstatek');
    const netWorthIdx = html.indexOf('Celkový majetek');
    const defaultAccountBadgeIdx = html.indexOf('Výchozí účet:');
    const actuallySavedIdx = html.indexOf('Skutečně uspořeno');

    expect(usableIdx).toBeGreaterThan(-1);
    expect(netWorthIdx).toBeGreaterThan(-1);
    expect(defaultAccountBadgeIdx).toBeGreaterThan(-1);
    // Zvýrazněné karty jsou úplně nahoře - nad panelem výchozího účtu i nad
    // souhrnnými kartami za všechny účty.
    expect(usableIdx).toBeLessThan(defaultAccountBadgeIdx);
    expect(netWorthIdx).toBeLessThan(defaultAccountBadgeIdx);
    expect(defaultAccountBadgeIdx).toBeLessThan(actuallySavedIdx);

    // Štítek "Souhrnně: všechny účty" byl odstraněn.
    expect(html).not.toContain('Souhrnně:');

    expect(html).toContain(formatCurrency(p0.usableClosingInHaler));
    expect(html).toContain(formatCurrency(p0.netWorthClosingInHaler));
  });

  it('karta "Skutečně uspořeno" stojí první v 7karetním gridu, před "Uspořeno"', () => {
    const { html } = renderScreen([]);
    const actuallySavedIdx = html.indexOf('Skutečně uspořeno');
    const actuallySavedPctIdx = html.indexOf('Skutečně uspořeno %');
    const savedIdx = html.indexOf('>Uspořeno<');
    expect(actuallySavedIdx).toBeGreaterThan(-1);
    expect(actuallySavedIdx).toBeLessThan(actuallySavedPctIdx);
    expect(actuallySavedPctIdx).toBeLessThan(savedIdx);
  });

  it('zobrazuje správnou hodnotu "Skutečně uspořeno" pro aktuální rozpočet', () => {
    const txs = [
      makeTx({ type: 'income', sourceAccountId: checking.id, amountInHaler: 500000, date: '2026-09-16' }),
      makeTx({ type: 'expense', sourceAccountId: checking.id, amountInHaler: 200000, date: '2026-09-17' }),
      makeTx({ type: 'transfer', sourceAccountId: checking.id, targetAccountId: savings.id, amountInHaler: 50000, date: '2026-09-18' }),
    ];
    const { html } = renderScreen(txs);
    // 5000 − 2000 Kč = 3000 Kč (převod na spoření se nezapočítává)
    const visibleText = html.replace(/<[^>]+>/g, '');
    expect(visibleText).toContain(formatCurrency(300000, { showPlus: true }));
    // Na dlaždici toku nese barvu jen znaménko, částka je inkoustem
    expect(html).toContain('<span class="text-emerald-600">+</span> 3');
  });
});
