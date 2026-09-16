import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OverviewScreen } from '../components/overview/OverviewScreen';
import { PeriodRangeSelector } from '../components/shared/PeriodRangeSelector';
import { calculateForecast } from '../services/financialEngine';
import { generatePeriodsSequence } from '../services/periodService';
import { getInitialData } from '../services/storageService';

// Exercise the event handlers and subsequent renders without adding a DOM dependency.
const hooks = vi.hoisted(() => ({ values: [] as any[], index: 0, effects: [] as any[], effectIndex: 0, finance: {} as any }));
vi.mock('../context/FinanceContext', () => ({ useFinance: () => hooks.finance }));
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>();
  return { ...actual,
    useMemo: (fn: () => unknown) => fn(),
    useEffect: (fn: () => unknown, deps: unknown[]) => {
      const index = hooks.effectIndex++;
      if (!hooks.effects[index] || deps.some((dep, i) => dep !== hooks.effects[index][i])) {
        hooks.effects[index] = deps;
        fn();
      }
    },
    useState: (initial: unknown) => {
      const index = hooks.index++;
      if (!(index in hooks.values)) hooks.values[index] = initial;
      return [hooks.values[index], (value: any) => {
        hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value;
      }];
    },
  };
});

function render() {
  hooks.index = 0;
  hooks.effectIndex = 0;
  return OverviewScreen({ onNavigateToBudget: vi.fn() }) as React.ReactElement;
}
function nodes(element: any): any[] {
  if (!element || typeof element !== 'object') return [];
  return [element, ...React.Children.toArray(element.props?.children).flatMap(nodes)];
}
function click(text: string) {
  const button = nodes(render()).find(node => node.type === 'button' && node.props.children === text);
  expect(button, text).toBeDefined();
  button.props.onClick();
}
function selector(direction: 'future' | 'past') {
  return nodes(render()).filter(node => node.type === PeriodRangeSelector)[direction === 'future' ? 0 : 1].props;
}
function expectRange(first: string, last: string, count: number) {
  const tree = render();
  const periods = generatePeriodsSequence(Number(first.slice(0, 4)), Number(first.slice(5)), count, 31);
  expect(periods[periods.length - 1]?.key).toBe(last);
  expect(hooks.finance.setOverviewPeriodBounds).toHaveBeenLastCalledWith([periods[0], periods[periods.length - 1]]);
  const html = renderToStaticMarkup(tree);
  for (const section of [html.slice(0, html.indexOf('</table>')), html.slice(html.indexOf('</table>') + 8)]) {
    for (const period of periods) expect(section).toContain(period.name);
  }
  expect(html.match(/Zůstatek celkem:/g)).toHaveLength(count);
  expect(html.match(/cursor-pointer transition-colors group/g)).toHaveLength(count);
}

beforeEach(() => {
  hooks.values = [];
  hooks.effects = [];
  const data = getInitialData();
  data.settings.budgetStartDay = 31;
  data.accounts = [{ id: 'cash', name: 'Cash', type: 'checking', currency: 'CZK', initialBalanceInHaler: 10000,
    initialBalanceDate: '2024-02-15', isUsableCash: true, isNetWorth: true, status: 'active',
    color: '', sortOrder: 0, createdAt: '', updatedAt: '' }];
  const forecast = calculateForecast(generatePeriodsSequence(2023, 1, 96, 31), data.accounts, [], [], [], [], data.settings, [], '2026-08', '2026-09-16');
  hooks.finance = { ...data, forecast, setSelectedPeriod: vi.fn(), setOverviewPeriodBounds: vi.fn() };
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-16T12:00:00Z'));
});

it.each([3, 18, 24])('applies the %i-month future preset to both sections', count => {
  click(`Příští ${count} ${count === 3 ? 'měsíce' : 'měsíců'}`);
  const last = generatePeriodsSequence(2026, 8, count, 31)[count - 1];
  expectRange('2026-08', last.key, count);
  expect(selector('future')).toMatchObject({ from: '2026-08', to: last.key, active: false });
});
it('applies history, YTD and complete activity history using budget boundaries', () => {
  click('Posledních 6 měsíců');
  expectRange('2026-03', '2026-08', 6);
  click('Tento rok (YTD)');
  expectRange('2026-01', '2026-08', 8);
  click('Celá historie');
  expectRange('2024-01', '2026-08', 32);
});
it.each(['future', 'past'] as const)('keeps %s drafts unapplied until OK and permits switching back to presets', direction => {
  render();
  const from = direction === 'future' ? '2028-01' : '2023-02';
  const to = direction === 'future' ? '2028-03' : '2023-04';
  selector(direction).onFromChange(from);
  selector(direction).onToChange(to);
  expectRange('2026-08', '2027-07', 12);
  selector(direction).onSubmit({ preventDefault: vi.fn() });
  expectRange(from, to, 3);
  expect(selector(direction).active).toBe(true);
  click('Příští 3 měsíce');
  expectRange('2026-08', '2026-10', 3);
});
it('rejects incomplete, reversed and future history ranges without changing the selection', () => {
  selector('past').onSubmit({ preventDefault: vi.fn() });
  expect(renderToStaticMarkup(render())).toContain('Vyberte prosím');
  selector('past').onFromChange('2026-08');
  selector('past').onToChange('2026-01');
  selector('past').onSubmit({ preventDefault: vi.fn() });
  expect(renderToStaticMarkup(render())).toContain('Počáteční měsíc nesmí');
  selector('past').onToChange('2026-09');
  selector('past').onSubmit({ preventDefault: vi.fn() });
  expect(renderToStaticMarkup(render())).toContain('nesmí být v budoucnosti');
  expectRange('2026-08', '2027-07', 12);
});
it('rejects a future range whose end lies before the current period', () => {
  selector('future').onFromChange('2026-01');
  selector('future').onToChange('2026-03');
  selector('future').onSubmit({ preventDefault: vi.fn() });
  expect(renderToStaticMarkup(render())).toContain('nesmí být v minulosti');
  expectRange('2026-08', '2027-07', 12);
});
it('removes only the matrix legend and retains balances, P/K labels and shared columns', () => {
  click('Příští 3 měsíce');
  click('Matice účtů');
  const before = JSON.stringify(hooks.finance.forecast);
  const html = renderToStaticMarkup(render());
  expect(html).not.toContain('počáteční</span>');
  expect(html).not.toContain('konečný</span>');
  expect(html).toContain('title="P – počáteční stav"');
  expect(html).toContain('title="K – konečný stav"');
  for (const table of html.split('<table').slice(1)) {
    for (const month of ['Srpen 2026', 'Září 2026', 'Říjen 2026']) expect(table).toContain(month);
  }
  expect(JSON.stringify(hooks.finance.forecast)).toBe(before);
});

afterEach(() => vi.useRealTimers());
