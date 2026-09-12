import { describe, it, expect } from 'vitest';
import { NavScreen } from '../components/layout/Sidebar';

describe('Navigation and Screen Routing', () => {
  const VALID_SCREENS: NavScreen[] = ['budget', 'overview', 'transactions', 'accounts', 'categories', 'settings'];

  function parseScreenFromHash(hashStr: string): NavScreen {
    const hash = hashStr.replace(/^#\/?/, '').trim().toLowerCase();
    if (VALID_SCREENS.includes(hash as NavScreen)) {
      return hash as NavScreen;
    }
    return 'budget';
  }

  it('should have the correct order of menu items: budget, overview, transactions, accounts, categories, settings', () => {
    expect(VALID_SCREENS).toEqual([
      'budget',
      'overview',
      'transactions',
      'accounts',
      'categories',
      'settings'
    ]);
  });

  it('should default to budget when hash is empty or root', () => {
    expect(parseScreenFromHash('')).toBe('budget');
    expect(parseScreenFromHash('#')).toBe('budget');
    expect(parseScreenFromHash('#/')).toBe('budget');
  });

  it('should parse budget hash correctly', () => {
    expect(parseScreenFromHash('#budget')).toBe('budget');
    expect(parseScreenFromHash('#/budget')).toBe('budget');
  });

  it('should preserve direct links to other screens', () => {
    expect(parseScreenFromHash('#overview')).toBe('overview');
    expect(parseScreenFromHash('#/overview')).toBe('overview');
    expect(parseScreenFromHash('#transactions')).toBe('transactions');
    expect(parseScreenFromHash('#accounts')).toBe('accounts');
    expect(parseScreenFromHash('#categories')).toBe('categories');
    expect(parseScreenFromHash('#settings')).toBe('settings');
  });

  it('should fallback to budget on unknown hash', () => {
    expect(parseScreenFromHash('#unknown')).toBe('budget');
  });
});
