import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsScreen } from '../components/settings/SettingsScreen';
import { FinanceProvider } from '../context/FinanceContext';
import { createBudgetPeriod, getPeriodForDate, formatPeriodRange } from '../services/periodService';
import { saveStoredAuth, clearStoredAuth } from '../services/googleDriveService';

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
    },
  };
})();

describe('SettingsScreen - Rozbalovací seznam Počáteční den rozpočtového měsíce', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: storageMock,
      writable: true,
      configurable: true,
    });
    localStorage.clear();
    saveStoredAuth({
      accessToken: 'mock_token',
      expiresAt: Date.now() + 3600000,
      user: {
        emailAddress: 'test@example.com',
        displayName: 'Test User',
      },
    });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearStoredAuth();
    vi.unstubAllGlobals();
  });

  it('1. Možnost se zobrazuje přesně jako "15. den v měsíci"', () => {
    const html = renderToStaticMarkup(
      <FinanceProvider>
        <SettingsScreen />
      </FinanceProvider>
    );

    expect(html).toContain('<option value="15" selected="">15. den v měsíci</option>');
  });

  it('2. U 15. dne již není žádná poznámka v závorce', () => {
    const html = renderToStaticMarkup(
      <FinanceProvider>
        <SettingsScreen />
      </FinanceProvider>
    );

    expect(html).not.toContain('15. den v měsíci (výchozí doporučeno)');
    expect(html).not.toContain('(výchozí doporučeno)');
    expect(html).not.toMatch(/15\.\s*den[^<]*\(/i);
  });

  it('3. Text odpovídá jednotnému formátu u všech ostatních možností (1. až 31. den v měsíci)', () => {
    const html = renderToStaticMarkup(
      <FinanceProvider>
        <SettingsScreen />
      </FinanceProvider>
    );

    // Ani den 1 nemá starou poznámku v závorce
    expect(html).not.toContain('1. den (standardní kalendářní měsíc)');
    expect(html).not.toContain('(standardní kalendářní měsíc)');

    for (let day = 1; day <= 31; day++) {
      expect(html).toContain(`>${day}. den v měsíci</option>`);
    }
  });

  it('4. Hodnota 15 zůstává správně vybraná a interní hodnota je 15', () => {
    const html = renderToStaticMarkup(
      <FinanceProvider>
        <SettingsScreen />
      </FinanceProvider>
    );

    expect(html).toContain('<option value="15" selected="">15. den v měsíci</option>');
  });

  it('5. Změna textu neovlivnila výpočet rozpočtových období', () => {
    const period = createBudgetPeriod(2026, 9, 15);
    expect(period.startDate).toBe('2026-09-15');
    expect(period.endDate).toBe('2026-10-14');
    expect(formatPeriodRange(period)).toBe('15. 9. 2026 – 14. 10. 2026');

    const sepPeriod = getPeriodForDate('2026-09-13', 15);
    expect(sepPeriod.key).toBe('2026-08');
    expect(sepPeriod.startDate).toBe('2026-08-15');
    expect(sepPeriod.endDate).toBe('2026-09-14');
  });

  it('6. Všechny možnosti od 1. do 31. dne zůstávají dostupné v číselném pořadí', () => {
    const html = renderToStaticMarkup(
      <FinanceProvider>
        <SettingsScreen />
      </FinanceProvider>
    );

    const matches = Array.from(html.matchAll(/<option value="(\d+)"[^>]*>(\d+)\. den v měsíci<\/option>/g));
    expect(matches).toHaveLength(31);

    for (let i = 0; i < 31; i++) {
      const day = i + 1;
      expect(matches[i][1]).toBe(String(day));
      expect(matches[i][2]).toBe(String(day));
    }
  });

  it('7. Stávající uživatelská data a nastavení zůstala zachována', () => {
    const initialData = {
      version: 1,
      settings: {
        budgetStartDay: 15,
        overdraftLimitInHaler: 2000000,
        forecastMonths: 6,
        roundAmounts: true,
      },
      accounts: [
        {
          id: 'test_acc',
          name: 'Test Účet',
          type: 'checking',
          currency: 'CZK',
          initialBalanceInHaler: 100000,
          currentBalanceInHaler: 100000,
          isActive: true,
          includeInNetWorth: true,
        }
      ],
      transactions: [],
      recurringRules: [],
      recurringExceptions: [],
      corrections: [],
      marketValueSnapshots: [],
    };
    storageMock.setItem('cashpilot_data', JSON.stringify(initialData));

    const html = renderToStaticMarkup(
      <FinanceProvider>
        <SettingsScreen />
      </FinanceProvider>
    );

    expect(html).toContain('<option value="15" selected="">15. den v měsíci</option>');
    expect(html).toContain('value="20000"'); // 2000000 halers = 20000 CZK
  });
});
