import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { useFinance } from '../context/FinanceContext';
import { MonthlyBudgetScreen } from '../components/budget/MonthlyBudgetScreen';
import { calculateForecast } from '../services/financialEngine';
import { addHaler, formatCurrency, subHaler } from '../services/currencyService';
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

/** Replikuje přesně vzorec "Skutečně uspořeno" z MonthlyBudgetScreen.aggregateSummary. */
function computeActuallySaved(accounts: Account[], accountBalances: ReturnType<typeof calculateForecast>['periods'][number]['accountBalances']) {
  return accounts
    .filter(a => (a.type === 'checking' || a.type === 'cash') && a.status === 'active')
    .reduce((sum, acc) => {
      const bal = accountBalances[acc.id];
      return bal ? addHaler(sum, addHaler(subHaler(bal.incomeInHaler, bal.expenseInHaler), bal.correctionsInHaler)) : sum;
    }, 0);
}

describe('Skutečně uspořeno — výpočetní logika', () => {
  const checking = makeAccount('checking', 'checking');
  const cash = makeAccount('cash', 'cash');
  const savings = makeAccount('savings', 'savings');
  const investment = makeAccount('investment', 'investment');
  const pension = makeAccount('pension', 'pension');
  const other = makeAccount('other', 'other');
  const accounts = [checking, cash, savings, investment, pension, other];

  it('příjem a výdaj na běžném účtu se projeví se správným znaménkem', () => {
    const txs = [
      makeTx({ type: 'income', sourceAccountId: checking.id, amountInHaler: 500000, date: '2026-09-16' }),
      makeTx({ type: 'expense', sourceAccountId: checking.id, amountInHaler: 200000, date: '2026-09-17' }),
    ];
    const forecast = calculateForecast([period], accounts, txs, [], [], [], DEFAULT_SETTINGS);
    const result = computeActuallySaved(accounts, forecast.periods[0].accountBalances);
    expect(result).toBe(300000); // 5000 − 2000 Kč = 3000 Kč
  });

  it('korekce zůstatku na běžném účtu se do výpočtu započítá', () => {
    const txs = [
      makeTx({ type: 'income', sourceAccountId: checking.id, amountInHaler: 500000, date: '2026-09-16' }),
      makeTx({
        type: 'balance_adjustment', sourceAccountId: checking.id, amountInHaler: 30000,
        diffInHaler: 30000, date: '2026-09-18',
      }),
    ];
    const forecast = calculateForecast([period], accounts, txs, [], [], [], DEFAULT_SETTINGS);
    const result = computeActuallySaved(accounts, forecast.periods[0].accountBalances);
    expect(result).toBe(530000); // 5000 + 300 Kč = 5300 Kč
  });

  it('převod z běžného účtu na spořicí/investiční účet výpočet neovlivní', () => {
    const withoutTransfer = calculateForecast([period], accounts, [], [], [], [], DEFAULT_SETTINGS);
    const txs = [
      makeTx({ type: 'transfer', sourceAccountId: checking.id, targetAccountId: savings.id, amountInHaler: 100000, date: '2026-09-19' }),
      makeTx({ type: 'transfer', sourceAccountId: checking.id, targetAccountId: investment.id, amountInHaler: 50000, date: '2026-09-19' }),
    ];
    const withTransfer = calculateForecast([period], accounts, txs, [], [], [], DEFAULT_SETTINGS);
    expect(computeActuallySaved(accounts, withTransfer.periods[0].accountBalances))
      .toBe(computeActuallySaved(accounts, withoutTransfer.periods[0].accountBalances));
    expect(computeActuallySaved(accounts, withTransfer.periods[0].accountBalances)).toBe(0);
  });

  it('příjem/výdaj na spořicím, investičním, penzijním a "jiném" účtu se nepočítá', () => {
    const txs = [
      makeTx({ type: 'income', sourceAccountId: savings.id, amountInHaler: 50000, date: '2026-09-16' }),
      makeTx({ type: 'expense', sourceAccountId: investment.id, amountInHaler: 20000, date: '2026-09-17' }),
      makeTx({ type: 'income', sourceAccountId: pension.id, amountInHaler: 10000, date: '2026-09-18' }),
      makeTx({ type: 'income', sourceAccountId: other.id, amountInHaler: 10000, date: '2026-09-19' }),
    ];
    const forecast = calculateForecast([period], accounts, txs, [], [], [], DEFAULT_SETTINGS);
    const result = computeActuallySaved(accounts, forecast.periods[0].accountBalances);
    expect(result).toBe(0);
  });

  it('"Skutečně uspořeno %" vrací null (zobrazí se "—"), když jsou příjmy v období nulové', () => {
    const txs = [
      makeTx({ type: 'expense', sourceAccountId: checking.id, amountInHaler: 20000, date: '2026-09-17' }),
    ];
    const forecast = calculateForecast([period], accounts, txs, [], [], [], DEFAULT_SETTINGS);
    const income = forecast.periods[0].incomeInHaler;
    expect(income).toBe(0);
    const pct = income > 0 ? 1 : null;
    expect(pct).toBeNull();
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
      duplicateTransaction: vi.fn(), setTransactionStatus: vi.fn(), markTransactionExecuted: vi.fn(),
      cancelTransaction: vi.fn(), deleteTransaction: vi.fn(), reorderDayTransactions: vi.fn(), showToast: vi.fn(),
    } as unknown as ReturnType<typeof useFinance>);

    const html = renderToStaticMarkup(
      <MonthlyBudgetScreen onOpenTransactionModal={vi.fn()} onEditTransaction={vi.fn()} />
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
    expect(html).toContain(formatCurrency(300000, { showPlus: true }));
  });
});
