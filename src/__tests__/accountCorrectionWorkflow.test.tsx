import React from 'react';
import * as ReactHooks from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { FinanceProvider, useFinance } from '../context/FinanceContext';
import { AccountModal } from '../components/accounts/AccountModal';
import { MarketValueModal } from '../components/accounts/MarketValueModal';
import { AppData, getInitialData } from '../services/storageService';
import { loadStoredData, saveStoredData } from './testStorageHelpers';
import { SyncController } from '../services/syncController';
import { calculateForecast } from '../services/financialEngine';

const bridge = vi.hoisted(() => ({ finance: null as ReturnType<typeof useFinance> | null }));
vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>() }));
vi.mock('../context/FinanceContext', async importOriginal => {
  const actual = await importOriginal<typeof import('../context/FinanceContext')>();
  return { ...actual, useFinance: () => bridge.finance ?? actual.useFinance() };
});

// Exercise the real form handlers with a small hook runner; no DOM dependency is needed.
function form(render: () => React.ReactNode) {
  const values: unknown[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  const state = vi.spyOn(ReactHooks, 'useState').mockImplementation(((initial: unknown) => {
    const index = cursor++;
    if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
    return [values[index], (value: unknown) => { values[index] = value; }];
  }) as typeof React.useState);
  const effect = vi.spyOn(ReactHooks, 'useEffect').mockImplementation(fn => { effects.push(fn); });
  const memo = vi.spyOn(ReactHooks, 'useMemo').mockImplementation(fn => fn());
  let tree: React.ReactNode;
  const refresh = () => { cursor = 0; tree = render(); };
  refresh();
  effects.forEach(fn => fn());
  effects = [];
  refresh();
  const nodes = (): React.ReactElement<any>[] => {
    const walk = (node: React.ReactNode): React.ReactElement<any>[] =>
      React.isValidElement<any>(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(walk)] : [];
    return walk(tree);
  };
  return {
    nodes,
    change: (node: React.ReactElement<any>, value: string) => { node.props.onChange({ target: { value } }); refresh(); },
    submit: () => nodes().find(node => node.type === 'form')!.props.onSubmit({ preventDefault() {} }),
    close: () => { state.mockRestore(); effect.mockRestore(); memo.mockRestore(); },
  };
}

afterEach(() => { bridge.finance = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('creates without correction, preserves it through general editing, and saves subsequent market corrections', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-15T12:00:00Z'));
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
  let data: AppData = { ...getInitialData(), accounts: [] };
  const capture = () => {
    bridge.finance = null;
    const session = { data, isReady: true, change: (action: React.SetStateAction<AppData>) => {
      data = typeof action === 'function' ? action(data) : action;
    } } as unknown as SyncController;
    function Capture() { bridge.finance = useFinance(); return null; }
    renderToStaticMarkup(<FinanceProvider syncSession={session}><Capture /></FinanceProvider>);
  };
  capture();
  const accountForm = form(() => AccountModal({ isOpen: true, onClose() {} }));
  accountForm.change(accountForm.nodes().find(n => n.type === 'select')!, 'investment');
  accountForm.change(accountForm.nodes().find(n => n.type === 'input' && n.props.type === 'text')!, 'Investment');
  accountForm.change(accountForm.nodes().find(n => n.type === 'input' && n.props.type === 'number')!, '100000');
  expect(accountForm.nodes().filter(n => n.type === 'input' && n.props.type === 'number')).toHaveLength(1);
  accountForm.submit();
  accountForm.close();
  expect(data.accounts[0]).not.toHaveProperty('investedAmountAdjustmentInHaler');

  for (const correction of ['-1000', '2500']) {
    capture();
    const market = form(() => MarketValueModal({ isOpen: true, onClose() {}, account: data.accounts[0] }));
    const numbers = market.nodes().filter(n => n.type === 'input' && n.props.type === 'number');
    expect(numbers).toHaveLength(2);
    market.change(numbers[0], '120000');
    market.change(numbers[1], correction);
    market.submit();
    market.close();
    const expected = Number(correction) * 100;
    expect(data.accounts[0].investedAmountAdjustmentInHaler).toBe(expected);
    capture();
    const edit = form(() => AccountModal({ isOpen: true, onClose() {}, accountToEdit: data.accounts[0] }));
    expect(edit.nodes().filter(n => n.type === 'input' && n.props.type === 'number')).toHaveLength(1);
    edit.change(edit.nodes().find(n => n.type === 'input' && n.props.type === 'text')!, 'Renamed investment');
    edit.submit();
    edit.close();
    saveStoredData(data, 'workflow-test');
    data = loadStoredData('workflow-test');
    expect(data.accounts[0].name).toBe('Renamed investment');
    expect(data.accounts[0].investedAmountAdjustmentInHaler).toBe(expected);
    const forecast = calculateForecast([{
      key: '2026-09', name: '', year: 2026, month: 9, startDate: '2026-09-01', endDate: '2026-09-30',
    }], data.accounts, [], [], [], [], undefined, data.marketValueSnapshots);
    const balance = forecast.periods[0].accountBalances[data.accounts[0].id];
    expect(balance.investedPrincipalInHaler).toBe(10000000 + expected);
    expect(balance.unrealizedGainLossInHaler).toBe(2000000 - expected);
  }
});
