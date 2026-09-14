import { describe, it, expect } from 'vitest';
import { Account } from '../types/finance';
import { applyAccountOrder, sortAccountsByOrder } from '../services/accountService';

describe('CashPilot - Vlastní pořadí účtů', () => {
  const makeAccount = (id: string, sortOrder: number, createdAt: string, overrides: Partial<Account> = {}): Account => ({
    id,
    name: `Účet ${id}`,
    type: 'checking',
    currency: 'CZK',
    initialBalanceInHaler: 0,
    initialBalanceDate: '2026-01-01',
    isUsableCash: true,
    isNetWorth: true,
    color: '#0284c7',
    sortOrder,
    status: 'active',
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  });

  it('Řadí účty podle sortOrder bez ohledu na pořadí v poli', () => {
    const accounts = [
      makeAccount('c', 3, '2026-01-01T00:00:00Z'),
      makeAccount('a', 1, '2026-03-01T00:00:00Z'),
      makeAccount('b', 2, '2026-02-01T00:00:00Z'),
    ];

    expect(sortAccountsByOrder(accounts).map(a => a.id)).toEqual(['a', 'b', 'c']);
    // Vstupní pole zůstává nezměněno
    expect(accounts.map(a => a.id)).toEqual(['c', 'a', 'b']);
  });

  it('Při shodném sortOrder rozhoduje datum vytvoření (původní pořadí založení)', () => {
    const accounts = [
      makeAccount('novy', 1, '2026-05-01T00:00:00Z'),
      makeAccount('stary', 1, '2026-01-01T00:00:00Z'),
    ];

    expect(sortAccountsByOrder(accounts).map(a => a.id)).toEqual(['stary', 'novy']);
  });

  it('Přeuspořádání přepíše sortOrder na souvislou řadu 1, 2, 3...', () => {
    const accounts = [
      makeAccount('a', 1, '2026-01-01T00:00:00Z'),
      makeAccount('b', 2, '2026-01-02T00:00:00Z'),
      makeAccount('c', 3, '2026-01-03T00:00:00Z'),
    ];

    const reordered = applyAccountOrder(['c', 'a', 'b'], accounts);

    expect(reordered.map(a => a.id)).toEqual(['c', 'a', 'b']);
    expect(reordered.map(a => a.sortOrder)).toEqual([1, 2, 3]);
    expect(sortAccountsByOrder(reordered).map(a => a.id)).toEqual(['c', 'a', 'b']);
  });

  it('Účty chybějící v zadaném pořadí se zařadí na konec a nezmizí', () => {
    const accounts = [
      makeAccount('a', 1, '2026-01-01T00:00:00Z'),
      makeAccount('archiv', 2, '2026-01-02T00:00:00Z', { status: 'archived' }),
      makeAccount('b', 3, '2026-01-03T00:00:00Z'),
    ];

    const reordered = applyAccountOrder(['b', 'a'], accounts);

    expect(reordered.map(a => a.id)).toEqual(['b', 'a', 'archiv']);
    expect(reordered.map(a => a.sortOrder)).toEqual([1, 2, 3]);
  });

  it('Účty na nezměněné pozici si zachovají původní updatedAt', () => {
    const accounts = [
      makeAccount('a', 1, '2026-01-01T00:00:00Z'),
      makeAccount('b', 2, '2026-01-02T00:00:00Z'),
      makeAccount('c', 3, '2026-01-03T00:00:00Z'),
    ];

    const reordered = applyAccountOrder(['a', 'c', 'b'], accounts);
    const byId = new Map(reordered.map(a => [a.id, a]));

    expect(byId.get('a')?.updatedAt).toBe('2026-01-01T00:00:00Z');
    expect(byId.get('c')?.updatedAt).not.toBe('2026-01-03T00:00:00Z');
    expect(byId.get('b')?.updatedAt).not.toBe('2026-01-02T00:00:00Z');
  });
});
