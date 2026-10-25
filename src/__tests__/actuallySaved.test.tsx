import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { useFinance } from '../context/FinanceContext';
import { MonthlyBudgetScreen } from '../components/budget/MonthlyBudgetScreen';
import { summarizePeriods } from '../services/financialEngine';
import { formatCurrency } from '../services/currencyService';
import { DEFAULT_SETTINGS } from '../services/demoData';
import { Account, AccountType, BudgetPeriod, Transaction } from '../types/finance';

vi.mock('../context/FinanceContext', () => ({ useFinance: vi.fn() }));

const period: BudgetPeriod = {
  key: '2026-09', name: 'Září 2026', year: 2026, month: 9,
  startDate: '2026-09-15', endDate: '2026-10-14', startDay: 15,
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

describe('MonthlyBudgetScreen — nové rozvržení karet', () => {
  const checking = makeAccount('checking', 'checking', { isDefault: true, isUsableCash: true });
  const savings = makeAccount('savings', 'savings');
  const accounts = [checking, savings];

  const renderScreen = (txs: Transaction[]) => {
    const forecast = summarizePeriods([period], { accounts, transactions: txs }, { currentPeriodKey: period.key, today: '2026-10-01' });
    vi.mocked(useFinance).mockReturnValue({
      selectedPeriod: period, forecast, settings: DEFAULT_SETTINGS, accounts, categories: [],
      transactions: txs, recurringRules: [], recurringExceptions: [], marketValueSnapshots: [],
      setTransactionStatus: vi.fn(),
      deleteTransaction: vi.fn(), reorderDayTransactions: vi.fn(), showToast: vi.fn(),
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
