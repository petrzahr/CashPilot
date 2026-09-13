import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CategoriesScreen } from '../components/categories/CategoriesScreen';
import { FinanceProvider } from '../context/FinanceContext';
import { saveStoredAuth } from '../services/googleDriveService';

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

describe('CategoriesScreen - Přepínač typu kategorií [Příjmy] [Výdaje]', () => {
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Pořadí záložek v přepínači je vlevo Příjmy a vpravo Výdaje: [ Příjmy ] [ Výdaje ]', () => {
    const html = renderToStaticMarkup(
      <FinanceProvider>
        <CategoriesScreen />
      </FinanceProvider>
    );

    // Přepínač záložek existuje
    const switcherIndex = html.indexOf('bg-slate-200/60 rounded-xl max-w-xs');
    expect(switcherIndex).toBeGreaterThan(0);

    // Index "Příjmy" v přepínači musí být PŘED indexem "Výdaje"
    const incomeIndex = html.indexOf('Příjmy</span>', switcherIndex);
    const expenseIndex = html.indexOf('Výdaje</span>', switcherIndex);

    expect(incomeIndex).toBeGreaterThan(switcherIndex);
    expect(expenseIndex).toBeGreaterThan(incomeIndex);
  });

  it('2. Po otevření stránky je výchozí aktivní záložkou Příjmy (zvýrazněna zeleně) a Výdaje jsou neaktivní', () => {
    const html = renderToStaticMarkup(
      <FinanceProvider>
        <CategoriesScreen />
      </FinanceProvider>
    );

    // Příjmy mají aktivní styl (bílé pozadí, stín, zelený text text-emerald-600)
    expect(html).toMatch(/<button[^>]*class="[^"]*bg-white text-emerald-600 shadow-sm[^"]*"[^>]*>[\s\S]*?Příjmy[\s\S]*?<\/button>/);

    // Výdaje mají neaktivní styl (šedý text text-slate-600)
    expect(html).toMatch(/<button[^>]*class="[^"]*text-slate-600 hover:text-slate-900[^"]*"[^>]*>[\s\S]*?Výdaje[\s\S]*?<\/button>/);
  });

  it('3. Po otevření stránky se pod přepínačem zobrazují příjmové kategorie (Mzda) a nezobrazují se výdajové (Bydlení, Auto)', () => {
    const html = renderToStaticMarkup(
      <FinanceProvider>
        <CategoriesScreen />
      </FinanceProvider>
    );

    // Příjmové kategorie a podkategorie jsou zobrazeny
    expect(html).toContain('Mzda');
    expect(html).toContain('Ostatní příjmy');

    // Výdajové kategorie pod přepínačem zobrazeny nejsou
    expect(html).not.toContain('Hypotéka');
    expect(html).not.toContain('Bydlení');
    expect(html).not.toContain('Elektřina');
    expect(html).not.toContain('Leasing');
  });

  it('4. Vizuální invariant: výsledkem není původní pořadí [Výdaje] [Příjmy]', () => {
    const html = renderToStaticMarkup(
      <FinanceProvider>
        <CategoriesScreen />
      </FinanceProvider>
    );

    const switcherIndex = html.indexOf('bg-slate-200/60 rounded-xl max-w-xs');
    expect(switcherIndex).toBeGreaterThan(0);
    const switcherHtml = html.slice(switcherIndex, switcherIndex + 800);

    const firstBtnMatch = switcherHtml.match(/<button[\s\S]*?<\/button>/);
    expect(firstBtnMatch).not.toBeNull();
    expect(firstBtnMatch![0]).toContain('Příjmy');
    expect(firstBtnMatch![0]).not.toContain('Výdaje');
  });
});
