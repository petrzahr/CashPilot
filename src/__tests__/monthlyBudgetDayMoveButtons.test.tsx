import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { useFinance } from '../context/FinanceContext';
import { MonthlyBudgetScreen } from '../components/budget/MonthlyBudgetScreen';
import { calculateForecast } from '../services/financialEngine';
import { DEFAULT_SETTINGS } from '../services/demoData';
import { Account, BudgetPeriod, Transaction } from '../types/finance';

vi.mock('../context/FinanceContext', () => ({ useFinance: vi.fn() }));

it('denní pohled nabízí posun položek tlačítky s názvem položky, na okrajích dne neaktivní', () => {
  const period: BudgetPeriod = {
    key: '2026-09', name: 'Září 2026', year: 2026, month: 9,
    startDate: '2026-09-15', endDate: '2026-10-14', startDay: 15,
  };
  const checking: Account = {
    id: 'chk', name: 'Běžný účet', type: 'checking', currency: 'CZK',
    initialBalanceInHaler: 5000000, initialBalanceDate: '2026-01-01',
    isUsableCash: true, isNetWorth: true, isDefault: true, color: '', sortOrder: 1, status: 'active',
    createdAt: '', updatedAt: '',
  };
  const mk = (id: string, title: string, sequence: number): Transaction => ({
    id, title, amountInHaler: 10000, date: '2026-09-20', sequence, type: 'expense',
    sourceAccountId: checking.id, status: 'planned', createdAt: '', updatedAt: '',
  });
  const transactions = [mk('t2', 'Nájem', 2), mk('t1', 'Nákup', 1)];
  const settings = { ...DEFAULT_SETTINGS, budgetStartDay: 15 };
  const forecast = calculateForecast([period], [checking], transactions, [], [], [], settings, [], period.key, '2026-09-16');

  vi.mocked(useFinance).mockReturnValue({
    selectedPeriod: period, forecast, settings, accounts: [checking], categories: [],
    transactions, recurringRules: [], recurringExceptions: [], marketValueSnapshots: [],
    setTransactionStatus: vi.fn(), markTransactionExecuted: vi.fn(),
    cancelTransaction: vi.fn(), deleteTransaction: vi.fn(), reorderDayTransactions: vi.fn(),
    reorderRecurringItem: vi.fn(), showToast: vi.fn(),
  } as unknown as ReturnType<typeof useFinance>);

  const html = renderToStaticMarkup(
    <MonthlyBudgetScreen onOpenTransactionModal={vi.fn()} onEditTransaction={vi.fn()} onDuplicateTransaction={vi.fn()} />
  );

  // Pořadí v rámci dne podle sequence: Nákup (#1), Nájem (#2)
  expect(html.indexOf('Posunout dolů: Nákup')).toBeLessThan(html.indexOf('Posunout nahoru: Nájem'));
  expect(html).toMatch(/aria-label="Posunout nahoru: Nákup" aria-disabled="true"/);
  expect(html).toMatch(/aria-label="Posunout dolů: Nákup" aria-disabled="false"/);
  expect(html).toMatch(/aria-label="Posunout nahoru: Nájem" aria-disabled="false"/);
  expect(html).toMatch(/aria-label="Posunout dolů: Nájem" aria-disabled="true"/);
});
