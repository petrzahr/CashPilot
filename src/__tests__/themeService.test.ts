import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, getThemePreference, resolveTheme, setThemePreference, THEME_STORAGE_KEY } from '../services/themeService';

let store: Record<string, string>;
let root: { dataset: Record<string, string> };
let systemDark = false;

beforeEach(() => {
  store = {};
  root = { dataset: {} };
  systemDark = false;
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => { store[key] = value; },
  });
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: systemDark, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    dispatchEvent: vi.fn(),
  });
  vi.stubGlobal('CustomEvent', class { constructor(public type: string, public init?: unknown) {} });
  vi.stubGlobal('document', { documentElement: root });
});

afterEach(() => vi.unstubAllGlobals());

describe('themeService', () => {
  it('defaults to following the system', () => {
    expect(getThemePreference()).toBe('system');
    systemDark = true;
    expect(resolveTheme('system')).toBe('dark');
    systemDark = false;
    expect(resolveTheme('system')).toBe('light');
  });

  it('ignores unknown stored values', () => {
    store[THEME_STORAGE_KEY] = 'sepia';
    expect(getThemePreference()).toBe('system');
  });

  it('explicit choice wins over the system and is stored per device', () => {
    systemDark = true;
    expect(setThemePreference('light')).toBe('light');
    expect(store[THEME_STORAGE_KEY]).toBe('light');
    expect(root.dataset.theme).toBe('light');
  });

  it('applies the resolved theme to the root element', () => {
    store[THEME_STORAGE_KEY] = 'dark';
    expect(applyTheme()).toBe('dark');
    expect(root.dataset.theme).toBe('dark');
  });
});
