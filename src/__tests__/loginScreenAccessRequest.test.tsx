import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoginScreen } from '../components/auth/LoginScreen';
import { FinanceProvider } from '../context/FinanceContext';
import {
  ACCESS_REQUEST_EMAIL,
  ACCESS_REQUEST_SUBJECT,
  ACCESS_REQUEST_BODY,
  buildAccessRequestMailtoUrl,
} from '../constants/authConfig';

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

describe('CashPilot - Přihlašovací stránka a žádost o přístup (18 bodů ověření)', () => {
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

  const renderScreen = () => {
    return renderToStaticMarkup(
      <FinanceProvider>
        <LoginScreen />
      </FinanceProvider>
    );
  };

  it('1. Úvodní text přesně odpovídá novému znění a je zobrazen nad panelem výhod', () => {
    const html = renderScreen();
    const expectedIntro =
      'Mějte své příjmy, výdaje i budoucí vývoj zůstatků pod kontrolou. Data jsou bezpečně uložena v soukromém prostoru vašeho účtu Google.';
    expect(html).toContain(expectedIntro);

    const introIndex = html.indexOf(expectedIntro);
    const featuresIndex = html.indexOf('Soukromé úložiště Google Disk');
    expect(introIndex).toBeGreaterThan(-1);
    expect(featuresIndex).toBeGreaterThan(introIndex);
  });

  it('2. První vlastnost se jmenuje „Soukromé úložiště Google Disk“ a má správný popis', () => {
    const html = renderScreen();
    expect(html).toContain('Soukromé úložiště Google Disk');
    expect(html).toContain(
      'Vaše finanční data jsou bezpečně uložena v neveřejném aplikačním prostoru vašeho účtu Google.'
    );
  });

  it('3. Druhá vlastnost se jmenuje „Automatická synchronizace“ a má správný popis', () => {
    const html = renderScreen();
    expect(html).toContain('Automatická synchronizace');
    expect(html).toContain(
      'Aplikace pracuje rychle s místní mezipamětí a všechny změny průběžně ukládá na pozadí.'
    );
  });

  it('4. Třetí vlastnost se jmenuje „Plánování a statistiky“ a má správný popis', () => {
    const html = renderScreen();
    expect(html).toContain('Plánování a statistiky');
    expect(html).toContain(
      'Plánujte budoucí příjmy a výdaje a sledujte vývoj svých financí v přehledných statistikách.'
    );
  });

  it('5. V prezentační části přihlašovací stránky nejsou uvedeny žádné zmínky o kontokorentu ani bankovních limitech', () => {
    const html = renderScreen();
    expect(html.toLowerCase()).not.toContain('kontokorent');
    expect(html.toLowerCase()).not.toContain('bankovních limitech');
    expect(html.toLowerCase()).not.toContain('hlídání limitů');
    expect(html.toLowerCase()).not.toContain('hlídání kontokorentu');
  });

  it('6. Je zobrazena samostatná část „Nemáte přístup?“ s popisem testovacího režimu', () => {
    const html = renderScreen();
    expect(html).toContain('Nemáte přístup?');
    expect(html).toContain(
      'CashPilot je momentálně dostupný pouze schváleným testovacím uživatelům. Pošlete žádost o přístup a po schválení se budete moci přihlásit svým účtem Google.'
    );
  });

  it('7. Je zobrazeno tlačítko / odkaz „Požádat o přístup“', () => {
    const html = renderScreen();
    expect(html).toContain('Požádat o přístup');
  });

  it('8. Hlavní akcí stránky zůstává tlačítko „Přihlásit se přes Google“ a je zobrazen oddělovač „nebo“', () => {
    const html = renderScreen();
    const loginBtnIndex = html.indexOf('Přihlásit se přes Google');
    const dividerIndex = html.indexOf('nebo');
    const requestAccessIndex = html.indexOf('Nemáte přístup?');

    expect(loginBtnIndex).toBeGreaterThan(-1);
    expect(dividerIndex).toBeGreaterThan(loginBtnIndex);
    expect(requestAccessIndex).toBeGreaterThan(dividerIndex);
  });

  it('9. Tlačítko žádosti o přístup obsahuje platný mailto: odkaz otevírající výchozí e-mail', () => {
    const html = renderScreen();
    expect(html).toContain('href="mailto:');
    const expectedUrl = buildAccessRequestMailtoUrl();
    // V HTML výstupu renderToStaticMarkup je & v atributech kódován jako &amp;
    expect(html).toContain(expectedUrl.replace(/&/g, '&amp;'));
  });

  it('10. Příjemcem žádosti o přístup je přesně cashpilot@byzahr.app', () => {
    expect(ACCESS_REQUEST_EMAIL).toBe('cashpilot@byzahr.app');
    const mailtoUrl = buildAccessRequestMailtoUrl();
    expect(mailtoUrl.startsWith('mailto:cashpilot@byzahr.app?')).toBe(true);
  });

  it('11. Předmět zprávy je přesně „Žádost o přístup do CashPilot“', () => {
    expect(ACCESS_REQUEST_SUBJECT).toBe('Žádost o přístup do CashPilot');
    const mailtoUrl = buildAccessRequestMailtoUrl();
    expect(mailtoUrl).toContain(encodeURIComponent('Žádost o přístup do CashPilot'));
  });

  it('12. Text zprávy obsahuje předepsanou strukturu a místo pro doplnění Google účtu', () => {
    expect(ACCESS_REQUEST_BODY).toContain('Dobrý den,');
    expect(ACCESS_REQUEST_BODY).toContain('žádám o přístup do aplikace CashPilot.');
    expect(ACCESS_REQUEST_BODY).toContain('E-mail účtu Google, kterým se budu přihlašovat:');
    expect(ACCESS_REQUEST_BODY).toContain('[DOPLŇTE E-MAIL]');
    expect(ACCESS_REQUEST_BODY).toContain('Děkuji.');
  });

  it('13. Česká diakritika, mezery, odřádkování i hranaté závorky jsou v mailto URL správně zakódovány', () => {
    const mailtoUrl = buildAccessRequestMailtoUrl();
    const urlObj = new URL(mailtoUrl);
    expect(urlObj.protocol).toBe('mailto:');
    expect(urlObj.pathname).toBe('cashpilot@byzahr.app');

    const searchParams = new URLSearchParams(urlObj.search);
    expect(searchParams.get('subject')).toBe(ACCESS_REQUEST_SUBJECT);
    expect(searchParams.get('body')).toBe(ACCESS_REQUEST_BODY);
  });

  it('14. Aplikace netvrdí, že byl e-mail automaticky odeslán (žádná falešná zpráva)', () => {
    const html = renderScreen();
    expect(html).not.toContain('Žádost byla odeslána');
    expect(html).not.toContain('byla odeslána');
    expect(html).not.toContain('Odesláno');
  });

  it('15. Adresa pzahradn@gmail.com se nikde v konfiguraci ani kódu žádosti nepoužívá', () => {
    const mailtoUrl = buildAccessRequestMailtoUrl();
    expect(mailtoUrl).not.toContain('pzahradn@gmail.com');
    const html = renderScreen();
    expect(html).not.toContain('pzahradn@gmail.com');
  });

  it('16. Tlačítko přihlášení zůstává plně zachováno s Google ikonou a funkcionalitou', () => {
    const html = renderScreen();
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>[\s\S]*?Přihlásit se přes Google[\s\S]*?<\/button>/);
    expect(html).toContain('Pro vstup do aplikace je vyžadováno přihlášení k vašemu Google účtu.');
  });

  it('17. Všechny prvky jsou začleněny do jedné přihlašovací karty s responzivním rozložením', () => {
    const html = renderScreen();
    // Jediná hlavní karta s max-w-md
    expect(html).toContain('max-w-md w-full bg-white rounded-3xl');
    // Oddělovač nebo
    expect(html).toContain('nebo</span>');
  });

  it('18. Odkaz / tlačítko je plně přístupné (srozumitelný název, ikona, focus styly)', () => {
    const html = renderScreen();
    expect(html).toMatch(
      /<a[^>]*href="mailto:[^"]*"[^>]*class="[^"]*focus:ring-2[^"]*"[^>]*>[\s\S]*?Požádat o přístup[\s\S]*?<\/a>/
    );
  });
});
