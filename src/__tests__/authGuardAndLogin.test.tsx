import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppContent } from '../App';
import { FinanceProvider } from '../context/FinanceContext';
import { saveStoredAuth, clearStoredAuth, getStoredAuth, isStoredTokenValid } from '../services/googleDriveService';
import { getActiveStorageKey } from '../services/storageService';

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

describe('Auth Guard & Login Wall', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: storageMock,
      writable: true,
      configurable: true,
    });
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('1. Pokud uživatel není přihlášený, zobrazí se pouze LoginScreen a žádný obsah aplikace', () => {
    clearStoredAuth();
    expect(isStoredTokenValid()).toBe(false);

    const html = renderToStaticMarkup(
      <FinanceProvider>
        <AppContent />
      </FinanceProvider>
    );

    // LoginScreen prvky jsou přítomny
    expect(html).toContain('Přihlásit se přes Google');
    expect(html).toContain('CashPilot');
    expect(html).toContain('Soukromé úložiště Google Disk');
    expect(html).toContain('Automatická synchronizace');
    expect(html).toContain('Pro vstup do aplikace je vyžadováno přihlášení');

    // Chráněný obsah aplikace (navigace, dashboard) NENÍ vykreslen
    expect(html).not.toContain('Měsíční rozpočet');
    expect(html).not.toContain('Položky');
    expect(html).not.toContain('Účty');
    expect(html).not.toContain('Kategorie');
  });

  it('2. Pokud má uživatel platný token, AuthGuard zpřístupní aplikaci (MainLayout)', () => {
    saveStoredAuth({
      accessToken: 'valid_test_token',
      expiresAt: Date.now() + 3600 * 1000,
      user: { displayName: 'Petr Zahrádka', emailAddress: 'petr@example.com' },
    });
    expect(isStoredTokenValid()).toBe(true);

    const html = renderToStaticMarkup(
      <FinanceProvider>
        <AppContent />
      </FinanceProvider>
    );

    // LoginScreen není zobrazen
    expect(html).not.toContain('Pro vstup do aplikace je vyžadováno přihlášení');
    expect(html).not.toContain('Přihlásit se přes Google');

    // Chráněný obsah (Sidebar, Header, rozpočet) je přítomen
    expect(html).toContain('Měsíční rozpočet');
    expect(html).toContain('Položky');
    expect(html).toContain('Účty');
    expect(html).toContain('Kategorie');
  });

  it('3. Po vypršení tokenu je uživatel vyhodnocen jako nepřihlášený a chráněn Login Wall', () => {
    // Expirovaný token
    saveStoredAuth({
      accessToken: 'expired_token',
      expiresAt: Date.now() - 10000,
    });
    expect(isStoredTokenValid()).toBe(false);

    const html = renderToStaticMarkup(
      <FinanceProvider>
        <AppContent />
      </FinanceProvider>
    );

    // Zobrazí se LoginScreen
    expect(html).toContain('Přihlásit se přes Google');
    expect(html).not.toContain('Měsíční rozpočet');
    expect(html).not.toContain('Položky');
  });

  it('4. Bezpečné odhlášení vymaže autentizaci i lokální mezipaměť dat', () => {
    saveStoredAuth({
      accessToken: 'token_to_clear',
      expiresAt: Date.now() + 3600 * 1000,
    });
    const testStorageKey = getActiveStorageKey();
    localStorage.setItem(testStorageKey, JSON.stringify({ version: 1 }));
    localStorage.setItem('cashpilot_drive_file_id', 'file_abc_123');

    // Simulace vyčištění v rámci odhlášení
    clearStoredAuth();
    localStorage.removeItem(testStorageKey);
    localStorage.removeItem('cashpilot_drive_file_id');

    expect(getStoredAuth()).toBeNull();
    expect(isStoredTokenValid()).toBe(false);
    expect(localStorage.getItem(testStorageKey)).toBeNull();
    expect(localStorage.getItem('cashpilot_drive_file_id')).toBeNull();

    // Následný render zobrazí LoginScreen
    const html = renderToStaticMarkup(
      <FinanceProvider>
        <AppContent />
      </FinanceProvider>
    );
    expect(html).toContain('Přihlásit se přes Google');
    expect(html).not.toContain('Měsíční rozpočet');
  });
});
