import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FinanceProvider } from '../context/FinanceContext';
import { AccountsScreen } from '../components/accounts/AccountsScreen';
import { MoveButtons } from '../components/shared/MoveButtons';
import { getNeighborId, moveIdByStep, moveIdToTarget } from '../services/reorderService';
import { applyAccountOrder } from '../services/accountService';
import { Account } from '../types/finance';
import { AppData, getInitialData } from '../services/storageService';
import { SyncController } from '../services/syncController';

describe('reorderService - posun o jedno místo', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('posune položku nahoru a dolů o jedno místo', () => {
    expect(moveIdByStep(ids, ids, 'c', 'up')).toEqual(['a', 'c', 'b', 'd']);
    expect(moveIdByStep(ids, ids, 'b', 'down')).toEqual(['a', 'c', 'b', 'd']);
  });

  it('na okraji seznamu nic nemění', () => {
    expect(moveIdByStep(ids, ids, 'a', 'up')).toBeNull();
    expect(moveIdByStep(ids, ids, 'd', 'down')).toBeNull();
    expect(moveIdByStep(ids, ids, 'x', 'up')).toBeNull();
  });

  it('přeskočí skryté položky a nechá je na jejich relativní pozici', () => {
    // 'b' je skrytá (např. archivovaný účet) - sousedem 'c' nahoru je 'a'
    const visible = ['a', 'c', 'd'];
    expect(getNeighborId(visible, 'c', 'up')).toBe('a');
    expect(moveIdByStep(ids, visible, 'c', 'up')).toEqual(['c', 'a', 'b', 'd']);
    expect(moveIdByStep(ids, visible, 'a', 'down')).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moveIdToTarget odpovídá dropu při přetažení', () => {
    expect(moveIdToTarget(ids, 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(moveIdToTarget(ids, 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    expect(moveIdToTarget(ids, 'a', 'a')).toBeNull();
  });

  it('výsledné pořadí účtů projde přes applyAccountOrder', () => {
    const mk = (id: string, sortOrder: number): Account => ({
      id, name: id, type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01',
      isUsableCash: true, isNetWorth: true, color: '', sortOrder, status: 'active', createdAt: '', updatedAt: '',
    });
    const accounts = [mk('a', 1), mk('b', 2), mk('c', 3)];
    const ordered = moveIdByStep(accounts.map(a => a.id), accounts.map(a => a.id), 'c', 'up')!;
    const result = applyAccountOrder(ordered, accounts);
    expect([...result].sort((x, y) => x.sortOrder - y.sortOrder).map(a => a.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('MoveButtons', () => {
  const getButtons = (props: Partial<React.ComponentProps<typeof MoveButtons>>) => {
    const onMove = vi.fn();
    const tree = MoveButtons({ itemLabel: 'účet Spoření', canMoveUp: true, canMoveDown: true, onMove, ...props }) as React.ReactElement<{ children: React.ReactElement[] }>;
    return { onMove, buttons: tree.props.children };
  };

  it('volá onMove se směrem a má aria-label s názvem položky', () => {
    const { onMove, buttons } = getButtons({});
    expect(buttons.map(b => (b.props as { 'aria-label': string })['aria-label'])).toEqual([
      'Posunout nahoru: účet Spoření',
      'Posunout dolů: účet Spoření',
    ]);
    (buttons[0].props as { onClick: () => void }).onClick();
    (buttons[1].props as { onClick: () => void }).onClick();
    expect(onMove.mock.calls).toEqual([['up'], ['down']]);
  });

  it('neaktivní směr je aria-disabled a neposouvá', () => {
    const { onMove, buttons } = getButtons({ canMoveUp: false });
    expect((buttons[0].props as { 'aria-disabled': boolean })['aria-disabled']).toBe(true);
    (buttons[0].props as { onClick: () => void }).onClick();
    expect(onMove).not.toHaveBeenCalled();
  });

  it('dotykové cíle mají pod md alespoň 44 px', () => {
    const html = renderToStaticMarkup(<MoveButtons itemLabel="x" canMoveUp canMoveDown onMove={() => {}} />);
    expect(html.match(/min-w-11 min-h-11/g)).toHaveLength(2);
  });
});

it('AccountsScreen vykreslí tlačítka posunu s názvem účtu a zakáže posun na okrajích', () => {
  const mk = (id: string, name: string, sortOrder: number): Account => ({
    id, name, type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01',
    isUsableCash: true, isNetWorth: true, color: '', sortOrder, status: 'active', createdAt: '', updatedAt: '',
  });
  const data: AppData = { ...getInitialData(), accounts: [mk('a', 'Běžný', 1), mk('b', 'Spoření', 2)], transactions: [] };
  const session = { data, isReady: true, change: () => {} } as unknown as SyncController;
  const html = renderToStaticMarkup(<FinanceProvider syncSession={session}><AccountsScreen /></FinanceProvider>);

  expect(html).toMatch(/aria-label="Posunout nahoru: účet Běžný" aria-disabled="true"/);
  expect(html).toMatch(/aria-label="Posunout dolů: účet Běžný" aria-disabled="false"/);
  expect(html).toMatch(/aria-label="Posunout nahoru: účet Spoření" aria-disabled="false"/);
  expect(html).toMatch(/aria-label="Posunout dolů: účet Spoření" aria-disabled="true"/);
});
