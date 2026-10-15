import { describe, expect, it } from 'vitest';
import { reuseUnchangedSlices } from '../context/FinanceContext';
import { createEmptyAppData } from '../constants/defaultData';
import { AppData } from '../services/storageService';

const clone = (data: AppData): AppData => JSON.parse(JSON.stringify(data));

describe('reuseUnchangedSlices', () => {
  const base = (): AppData => ({
    ...createEmptyAppData(),
    transactions: [{ id: 't1', title: 'Nákup', amountInHaler: 1000, date: '2026-10-15', sequence: 1, type: 'expense', status: 'planned', createdAt: '', updatedAt: '' } as any],
  });

  it('returns the previous object when the re-parsed data has the same content', () => {
    const prev = base();
    expect(reuseUnchangedSlices(prev, clone(prev))).toBe(prev);
  });

  it('keeps references of unchanged slices and takes changed ones from the new data', () => {
    const prev = base();
    const next = clone(prev);
    next.sync = { ...next.sync, revision: next.sync.revision + 1 };

    const shared = reuseUnchangedSlices(prev, next);

    expect(shared).not.toBe(prev);
    expect(shared.transactions).toBe(prev.transactions);
    expect(shared.settings).toBe(prev.settings);
    expect(shared.sync).toBe(next.sync);
  });

  it('takes a changed transaction list from the new data', () => {
    const prev = base();
    const next = clone(prev);
    next.transactions[0].status = 'executed';

    const shared = reuseUnchangedSlices(prev, next);

    expect(shared.transactions).toBe(next.transactions);
    expect(shared.accounts).toBe(prev.accounts);
  });
});
