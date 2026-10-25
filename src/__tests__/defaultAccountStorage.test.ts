import { describe, it, expect, beforeEach } from 'vitest';
import { AppData, getInitialData } from '../services/storageService';
import { loadStoredData, saveStoredData } from './testStorageHelpers';

describe('CashPilot - Výchozí účet v úložišti', () => {
  const storageMock = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => {
        store[key] = value.toString();
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      }
    };
  })();

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: storageMock,
      writable: true,
      configurable: true
    });
    localStorage.clear();
  });

  it('Migrace zachová výchozí příznaky účtů bez tiché změny finančních dat', () => {
    const rawData: AppData = {
      ...getInitialData(),
      accounts: [
        { id: 'acc1', name: 'Účet 1', type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01', isUsableCash: true, isNetWorth: true, isDefault: true, color: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '' },
        { id: 'acc2', name: 'Účet 2', type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01', isUsableCash: true, isNetWorth: true, isDefault: true, color: '', sortOrder: 2, status: 'active', createdAt: '', updatedAt: '' },
      ]
    };
    saveStoredData(rawData);

    const loaded = loadStoredData();
    const defaults = loaded.accounts.filter(a => a.isDefault);
    expect(defaults.length).toBe(2);
    expect(defaults[0].id).toBe('acc1');
  });
});
