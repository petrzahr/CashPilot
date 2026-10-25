// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemActionsDeps, STATUS_CHANGE_DELAY_MS, useItemActions } from '../hooks/useItemActions';
import { buildVirtualId } from '../services/transactionCommands';
import { Transaction } from '../types/finance';

const tx = (overrides: Partial<Transaction>): Transaction => ({
  id: 'tx_1', title: 'Položka', amountInHaler: 10000, date: '2026-10-01', sequence: 1, type: 'expense',
  sourceAccountId: 'acc_a', status: 'planned', createdAt: '', updatedAt: '', ...overrides,
});

const done = { ok: true, value: undefined } as const;

function setup(overrides: Partial<ItemActionsDeps> = {}) {
  const deps: ItemActionsDeps = {
    transactions: [],
    deleteTransaction: vi.fn().mockReturnValue(done),
    deleteCorrection: vi.fn().mockReturnValue(done),
    setTransactionStatus: vi.fn().mockReturnValue(done),
    showToast: vi.fn(),
    ...overrides,
  };
  return { deps, hook: renderHook(() => useItemActions(deps)) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useItemActions', () => {
  it('deletes a one-off item at once and asks for scope on a recurring one', () => {
    const { deps, hook } = setup();

    act(() => hook.result.current.requestDelete(tx({ id: 'plain' })));
    expect(deps.deleteTransaction).toHaveBeenCalledWith('plain');
    expect(hook.result.current.deletingTx).toBeNull();

    const recurring = tx({ id: 'rec', recurringRuleId: 'rule_1' });
    act(() => hook.result.current.requestDelete(recurring));
    expect(hook.result.current.deletingTx).toBe(recurring);

    const virtual = tx({ id: buildVirtualId('rule_1', '2026-10') });
    act(() => hook.result.current.requestDelete(virtual));
    expect(hook.result.current.deletingTx).toBe(virtual);
    expect(deps.deleteTransaction).toHaveBeenCalledTimes(1);
  });

  it('reports executed history of the rule being deleted, also for a virtual occurrence', () => {
    const { hook } = setup({ transactions: [tx({ id: 'old', recurringRuleId: 'rule_1', status: 'executed' })] });
    act(() => hook.result.current.requestDelete(tx({ id: buildVirtualId('rule_1', '2026-10') })));
    expect(hook.result.current.deletingTxHasExecutedHistorical).toBe(true);

    act(() => hook.result.current.requestDelete(tx({ id: 'other', recurringRuleId: 'rule_2' })));
    expect(hook.result.current.deletingTxHasExecutedHistorical).toBe(false);
  });

  it('confirms the scoped delete and clears the pending item only when idle', async () => {
    const { deps, hook } = setup();
    const recurring = tx({ id: 'rec', recurringRuleId: 'rule_1' });
    act(() => hook.result.current.requestDelete(recurring));

    let ok: boolean | undefined;
    await act(async () => { ok = await hook.result.current.confirmDelete(recurring, 'future', true); });
    expect(ok).toBe(true);
    expect(deps.deleteTransaction).toHaveBeenCalledWith('rec', 'future', true);
    expect(hook.result.current.isDeletingTx).toBe(false);

    act(() => hook.result.current.closeDelete());
    expect(hook.result.current.deletingTx).toBeNull();
  });

  it('changes status after the delay and ignores a second click meanwhile', async () => {
    const { deps, hook } = setup();

    act(() => { void hook.result.current.handleStatusChange('a', 'executed'); });
    expect(hook.result.current.updatingStatusTxId).toBe('a');
    act(() => { void hook.result.current.handleStatusChange('b', 'cancelled'); });

    await act(async () => { await vi.advanceTimersByTimeAsync(STATUS_CHANGE_DELAY_MS); });
    expect(deps.setTransactionStatus).toHaveBeenCalledTimes(1);
    expect(deps.setTransactionStatus).toHaveBeenCalledWith('a', 'executed');
    expect(hook.result.current.updatingStatusTxId).toBeNull();
  });

  it('shows an error toast when the status change throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { deps, hook } = setup({ setTransactionStatus: vi.fn(() => { throw new Error('boom'); }) });

    act(() => { void hook.result.current.handleStatusChange('a', 'executed'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(STATUS_CHANGE_DELAY_MS); });

    expect(deps.showToast).toHaveBeenCalledWith('Při změně stavu položky došlo k chybě.', 'error');
    expect(hook.result.current.updatingStatusTxId).toBeNull();
    consoleError.mockRestore();
  });

  it('opens and closes the correction detail', () => {
    const { hook } = setup();
    const correction = tx({ type: 'balance_adjustment' });
    act(() => hook.result.current.openCorrection(correction));
    expect(hook.result.current.selectedCorrection).toBe(correction);
    act(() => hook.result.current.closeCorrection());
    expect(hook.result.current.selectedCorrection).toBeNull();
  });
});
