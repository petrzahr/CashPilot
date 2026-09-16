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

describe('CategoriesScreen - Přepínač typu kategorií [Výdaje] [Příjmy]', () => {
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

  it('1. Pořadí záložek v přepínači je vlevo Výdaje a vpravo Příjmy: [ Výdaje ] [ Příjmy ]', () => {
    const html = renderToStaticMarkup(
      <FinanceProvider>
        <CategoriesScreen />
      </FinanceProvider>
    );

    // Přepínač záložek existuje
    const switcherIndex = html.indexOf('bg-slate-200/60 rounded-xl');
    expect(switcherIndex).toBeGreaterThan(0);

    // Index "Výdaje" v přepínači musí být PŘED indexem "Příjmy"
    const expenseIndex = html.indexOf('Výdaje</span>', switcherIndex);
    const incomeIndex = html.indexOf('Příjmy</span>', switcherIndex);

    expect(expenseIndex).toBeGreaterThan(switcherIndex);
    expect(incomeIndex).toBeGreaterThan(expenseIndex);
  });

  it('2. Po otevření stránky je výchozí aktivní záložkou Výdaje (zvýrazněna červeně) a Příjmy jsou neaktivní', () => {
    const html = renderToStaticMarkup(
      <FinanceProvider>
        <CategoriesScreen />
      </FinanceProvider>
    );

    // Výdaje mají aktivní styl (bílé pozadí, stín, červený text text-red-600)
    expect(html).toMatch(/<button[^>]*class="[^"]*bg-white text-red-600 shadow-sm[^"]*"[^>]*>[\s\S]*?Výdaje[\s\S]*?<\/button>/);

    // Příjmy mají neaktivní styl (šedý text text-slate-500)
    expect(html).toMatch(/<button[^>]*class="[^"]*text-slate-500 hover:text-slate-900[^"]*"[^>]*>[\s\S]*?Příjmy[\s\S]*?<\/button>/);
  });

  it('3. Po otevření stránky se pod přepínačem zobrazují výdajové kategorie (Bydlení, Auto) a nezobrazují se příjmové (Mzda)', () => {
    const html = renderToStaticMarkup(
      <FinanceProvider>
        <CategoriesScreen />
      </FinanceProvider>
    );

    // Výdajové kategorie a podkategorie jsou zobrazeny
    expect(html).toContain('Bydlení');
    expect(html).toContain('Hypotéka');

    // Příjmové kategorie pod přepínačem zobrazeny nejsou
    expect(html).not.toContain('Mzda');
    expect(html).not.toContain('Ostatní příjmy');
  });

  it('4. Vizuální invariant: výsledkem je nové pořadí [Výdaje] [Příjmy]', () => {
    const html = renderToStaticMarkup(
      <FinanceProvider>
        <CategoriesScreen />
      </FinanceProvider>
    );

    const switcherIndex = html.indexOf('bg-slate-200/60 rounded-xl');
    expect(switcherIndex).toBeGreaterThan(0);
    const switcherHtml = html.slice(switcherIndex, switcherIndex + 800);

    const firstBtnMatch = switcherHtml.match(/<button[\s\S]*?<\/button>/);
    expect(firstBtnMatch).not.toBeNull();
    expect(firstBtnMatch![0]).toContain('Výdaje');
    expect(firstBtnMatch![0]).not.toContain('Příjmy');
  });
});
