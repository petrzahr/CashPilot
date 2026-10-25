// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FinanceProvider, useFinance } from '../context/FinanceContext';
import { OverviewScreen } from '../components/overview/OverviewScreen';
import { generatePeriodsSequence } from '../services/periodService';
import { getInitialData } from '../services/storageService';
import { SyncController } from '../services/syncController';

let finance: ReturnType<typeof useFinance>;
let container: HTMLElement;

function Capture() {
  finance = useFinance();
  return <OverviewScreen onNavigateToBudget={vi.fn()} />;
}

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const monthInputs = () => [...container.querySelectorAll<HTMLInputElement>('input[type="month"]')];
// Jediný výběr vlastního rozsahu; při prvním použití ho otevře volba Vlastní
function selector() {
  if (monthInputs().length === 0) click('Vlastní');
  const [from, to] = monthInputs();
  return {
    from: from.value,
    to: to.value,
    setFrom: (value: string) => fireEvent.change(from, { target: { value } }),
    setTo: (value: string) => fireEvent.change(to, { target: { value } }),
    submit: () => click('Použít'),
  };
}
function expectRange(first: string, last: string, count: number) {
  const periods = generatePeriodsSequence(Number(first.slice(0, 4)), Number(first.slice(5)), count, 31);
  expect(periods[periods.length - 1]?.key).toBe(last);
  const html = container.innerHTML;
  for (const section of [html.slice(0, html.indexOf('</table>')), html.slice(html.indexOf('</table>') + 8)]) {
    for (const period of periods) expect(section).toContain(period.name);
  }
  expect(html.match(/Zůstatek celkem:/g)).toHaveLength(count);
  expect(html.match(/cursor-pointer transition-colors group/g)).toHaveLength(count);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-16T12:00:00Z'));
  const data = getInitialData();
  data.settings.budgetStartDay = 31;
  data.accounts = [{ id: 'cash', name: 'Cash', type: 'checking', currency: 'CZK', initialBalanceInHaler: 10000,
    initialBalanceDate: '2024-02-15', isUsableCash: true, isNetWorth: true, status: 'active',
    color: '', sortOrder: 0, createdAt: '', updatedAt: '' }];
  // Připojení (jsdom) spouští efekty relace: automatické provedení zapisuje, odpojení zastaví sync
  const session = { data, isReady: true, change: () => {}, stop: () => {}, sync: async () => {} } as unknown as SyncController;
  // Rozsah drží kontext (usePeriodForecast); každý test začíná od výchozího
  ({ container } = render(<FinanceProvider syncSession={session}><Capture /></FinanceProvider>));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it.each([3, 18, 24])('applies the %i-month future preset to both sections', count => {
  click(`${count === 3 ? 'Příští' : 'Příštích'} ${count} ${count === 3 ? 'měsíce' : 'měsíců'}`);
  const last = generatePeriodsSequence(2026, 8, count, 31)[count - 1];
  expectRange('2026-08', last.key, count);
  expect(selector()).toMatchObject({ from: '2026-08', to: last.key });
});
it('applies history, YTD and complete activity history using budget boundaries', () => {
  click('Posledních 6 měsíců');
  expectRange('2026-03', '2026-08', 6);
  click('Tento rok');
  expectRange('2026-01', '2026-08', 8);
  click('Celá historie');
  expectRange('2024-01', '2026-08', 32);
});
it.each([['future', '2028-01', '2028-03'], ['past', '2023-02', '2023-04'], ['spanning', '2026-06', '2026-08']] as const)('keeps a %s draft unapplied until submitted and permits switching back to presets', (_, from, to) => {
  selector().setFrom(from);
  selector().setTo(to);
  expectRange('2026-08', '2027-07', 12);
  selector().submit();
  expectRange(from, to, 3);
  expect(container.innerHTML).toContain('Vlastní rozsah');
  click('Příští 3 měsíce');
  expectRange('2026-08', '2026-10', 3);
  expect(monthInputs()).toHaveLength(0);
});
it('rejects incomplete and reversed custom ranges without changing the selection', () => {
  selector().setFrom('');
  selector().submit();
  expect(container.innerHTML).toContain('Vyberte prosím');
  selector().setFrom('2026-08');
  selector().setTo('2026-01');
  selector().submit();
  expect(container.innerHTML).toContain('Počáteční měsíc nesmí');
  expectRange('2026-08', '2027-07', 12);
});
it('removes only the matrix legend and retains balances, P/K labels and shared columns', () => {
  click('Příští 3 měsíce');
  click('Matice účtů');
  const before = JSON.stringify(finance.forecast);
  const html = container.innerHTML;
  expect(html).not.toContain('počáteční</span>');
  expect(html).not.toContain('konečný</span>');
  expect(html).toContain('title="P – počáteční stav"');
  expect(html).toContain('title="K – konečný stav"');
  // Graf Rozložení majetku má vlastní tabulku se zkrácenými názvy období, kontrolují se jen tabulky zůstatků
  const balanceTables = html.replace(/Rozložení celkového majetku[\s\S]*?(?=>Účty<\/h2>)/, '');
  for (const table of balanceTables.split('<table').slice(1)) {
    for (const month of ['Srpen 2026', 'Září 2026', 'Říjen 2026']) expect(table).toContain(month);
  }
  expect(JSON.stringify(finance.forecast)).toBe(before);
});
