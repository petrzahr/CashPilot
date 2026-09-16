import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { useFinance } from '../context/FinanceContext';
import { MonthlyBudgetScreen } from '../components/budget/MonthlyBudgetScreen';
import { calculateForecast } from '../services/financialEngine';
import { formatCurrency } from '../services/currencyService';
import { DEFAULT_SETTINGS } from '../services/demoData';
import { Account, BudgetPeriod, RecurringRule } from '../types/finance';

vi.mock('../context/FinanceContext', () => ({ useFinance: vi.fn() }));

describe('MonthlyBudgetScreen respects account activation date for recurring rules', () => {
  it('excludes a recurring occurrence dated before the source account existed, matching the KPI totals', () => {
    const period: BudgetPeriod = {
      key: '2026-09', name: 'Září 2026', year: 2026, month: 9,
      startDate: '2026-09-15', endDate: '2026-10-14',
    };
    const checking: Account = {
      id: 'chk', name: 'Běžný účet', type: 'checking', currency: 'CZK',
      // Účet vznikl uprostřed období - výskyt pravidla z 20. 9. je tedy před jeho vznikem
      initialBalanceInHaler: 5000000, initialBalanceDate: '2026-09-25',
      isUsableCash: true, isNetWorth: true, isDefault: true, color: '', sortOrder: 1, status: 'active',
      createdAt: '', updatedAt: '',
    };
    const rule: RecurringRule = {
      id: 'rule1', title: 'Výplata', type: 'income', amountInHaler: 3000000,
      sourceAccountId: checking.id, dayOfMonth: 20, frequency: 'monthly',
      startDate: '2026-01-01', isActive: true, createdAt: '', updatedAt: '',
    };
    const settings = { ...DEFAULT_SETTINGS, budgetStartDay: 15 };
    const forecast = calculateForecast([period], [checking], [], [rule], [], [], settings, [], period.key, '2026-10-01');

    // Forecast (KPI panel) correctly has zero income for this period.
    expect(forecast.periods[0].incomeInHaler).toBe(0);

    vi.mocked(useFinance).mockReturnValue({
      selectedPeriod: period, forecast, settings, accounts: [checking], categories: [],
      transactions: [], recurringRules: [rule], recurringExceptions: [], marketValueSnapshots: [],
      duplicateTransaction: vi.fn(), setTransactionStatus: vi.fn(), markTransactionExecuted: vi.fn(),
      cancelTransaction: vi.fn(), deleteTransaction: vi.fn(), reorderDayTransactions: vi.fn(), showToast: vi.fn(),
    } as unknown as ReturnType<typeof useFinance>);

    const html = renderToStaticMarkup(
      <MonthlyBudgetScreen onOpenTransactionModal={vi.fn()} onEditTransaction={vi.fn()} />
    );

    // The "Položky období" list must not show the phantom pre-activation occurrence,
    // so its sum must stay in sync with the forecast's income figure (0 Kč), not 30 000 Kč.
    const badges = [...html.matchAll(/rounded-md">([^<]+)<\/span>/g)].map(m => m[1]);
    expect(badges).toContain('0'); // položky období count
    expect(badges).toContain(formatCurrency(0, { showPlus: true })); // suma položek
    expect(html).not.toContain(formatCurrency(3000000));
  });
});
