// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FinanceProvider, useFinance } from '../context/FinanceContext';
import { OverviewScreen } from '../components/overview/OverviewScreen';
import { SettingsScreen } from '../components/settings/SettingsScreen';
import { createBudgetPeriod, getOverviewPeriods, OverviewRange } from '../services/periodService';
import { getInitialData, validateAndParseBackup } from '../services/storageService';
import { SyncController } from '../services/syncController';
import { PeriodRangePresetId } from '../types/finance';

const selection = { direction: 'future', months: 12 } as OverviewRange;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-16T12:00:00Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function overviewTree(startDay: number) {
  const data = getInitialData();
  data.settings.budgetStartDay = startDay;
  // Rozsah se vybírá přes výchozí volbu z Nastavení; předpověď ho musí pokrýt sama
  data.settings.defaultPeriodRanges = { overview: `${selection.direction}:${selection.months}` as PeriodRangePresetId };
  const capture: { finance?: ReturnType<typeof useFinance> } = {};
  function Capture() { capture.finance = useFinance(); return <OverviewScreen onNavigateToBudget={vi.fn()} />; }
  // Připojení (jsdom) spouští efekty relace: automatické provedení zapisuje, odpojení zastaví sync
  const session = { data, isReady: true, change: () => {}, stop: () => {}, sync: async () => {} } as unknown as SyncController;
  return { tree: <FinanceProvider syncSession={session}><Capture /></FinanceProvider>, capture };
}

function renderOverview(startDay: number) {
  const { tree, capture } = overviewTree(startDay);
  const html = renderToStaticMarkup(tree);
  return { html, finance: capture.finance! };
}

describe.each(['future', 'past'] as const)('shared %s overview range', direction => {
  it.each([3, 6, 12] as const)('renders %i periods in both overview tables', months => {
    Object.assign(selection, { direction, months });
    const { html, finance } = renderOverview(15);
    const periods = getOverviewPeriods(finance.currentPeriod, { direction, months }, 15);
    expect(periods).toHaveLength(months);
    const tables = [html.slice(0, html.indexOf('</table>')), html.slice(html.indexOf('</table>') + 8)];
    for (const table of tables) {
      for (const period of periods) {
        expect(table).toContain(period.name);
        expect(finance.forecast.periods.some(p => p.period.key === period.key)).toBe(true);
      }
    }
    const outside = direction === 'future' ? createBudgetPeriod(2026, 8, 15) : createBudgetPeriod(2026, 10, 15);
    expect(html).not.toContain(outside.name);
    expect(html).not.toContain('Finanční forecast');
    expect(html).not.toContain('Rozpad zůstatků');
  });

  it('uses the same range in the account matrix', () => {
    Object.assign(selection, { direction, months: 3 });
    const { tree, capture } = overviewTree(31);
    const { container } = render(tree);
    fireEvent.click(screen.getByRole('button', { name: 'Matice účtů' }));
    const html = container.innerHTML;
    const finance = capture.finance!;
    const periods = getOverviewPeriods(finance.currentPeriod, selection, 31);
    expect(html).toContain('title="K – konečný stav"');
    // Graf Rozložení majetku má vlastní tabulku se zkrácenými názvy období, kontrolují se jen tabulky zůstatků
    const balanceTables = html.replace(/Rozložení celkového majetku[\s\S]*?(?=>Účty<\/h2>)/, '');
    for (const table of balanceTables.split('<table').slice(1)) {
      for (const period of periods) expect(table).toContain(period.name);
    }
    expect(finance.currentPeriod.key).toBe('2026-08');
    expect(finance.currentPeriod.startDate).toBe('2026-08-31');
    expect(finance.currentPeriod.endDate).toBe('2026-09-29');
  });
});

it('removes the legacy horizon while preserving imported settings', () => {
  const data = getInitialData();
  const restored = validateAndParseBackup(JSON.stringify({ ...data,
    settings: { ...data.settings, forecastMonths: 6, budgetStartDay: 31, roundAmounts: true },
  }));
  expect(restored.settings).not.toHaveProperty('forecastMonths');
  expect(restored.settings).toMatchObject({ budgetStartDay: 31, roundAmounts: true });
  const session = { data: restored, isReady: true } as SyncController;
  const html = renderToStaticMarkup(<FinanceProvider syncSession={session}><SettingsScreen /></FinanceProvider>);
  expect(html).not.toContain('Horizont forecastu');
});
