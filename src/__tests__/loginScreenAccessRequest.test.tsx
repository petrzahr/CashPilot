import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoginScreen } from '../components/auth/LoginScreen';
import { FinanceProvider } from '../context/FinanceContext';
import {
  ACCESS_REQUEST_EMAIL,
  ACCESS_REQUEST_SUBJECT,
  ACCESS_REQUEST_BODY,
  buildGmailComposeUrl,
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

describe('CashPilot - Přihlašovací stránka a žádost o přístup přes Gmail (ověření požadavků)', () => {
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

  it('1. Tlačítko již nepoužívá protokol mailto:', () => {
    const html = renderScreen();
    expect(html).not.toContain('mailto:');
    expect(html).not.toContain('href="mailto:');
  });

  it('2. Kliknutí na žádost o přístup otevírá webový Gmail v nové kartě se zabezpečením', () => {
    const html = renderScreen();
    // Musí obsahovat Gmail compose URL
    expect(html).toContain('https://mail.google.com/mail/?view=cm&amp;fs=1');
    // Musí mít target="_blank" a rel="noopener noreferrer"
    expect(html).toMatch(/<a[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>/);
  });

  it('3. Text tlačítka žádosti je přesně „Požádat o přístup přes Gmail“', () => {
    const html = renderScreen();
    expect(html).toContain('Požádat o přístup přes Gmail');
  });

  it('4. Cílovým příjemcem v Gmail Compose URL je přesně cashpilot@byzahr.app', () => {
    expect(ACCESS_REQUEST_EMAIL).toBe('cashpilot@byzahr.app');
    const gmailUrl = buildGmailComposeUrl();
    expect(gmailUrl).toContain('to=cashpilot%40byzahr.app');
  });

  it('5. Předmět zprávy je správně předvyplněný a zakódovaný v parametru su', () => {
    expect(ACCESS_REQUEST_SUBJECT).toBe('Žádost o přístup do CashPilot');
    const gmailUrl = buildGmailComposeUrl();
    expect(gmailUrl).toContain(`su=${encodeURIComponent('Žádost o přístup do CashPilot')}`);
  });

  it('6. Text zprávy je předvyplněný v parametru body a obsahuje místo pro doplnění Google účtu', () => {
    expect(ACCESS_REQUEST_BODY).toContain('Dobrý den,');
    expect(ACCESS_REQUEST_BODY).toContain('žádám o přístup do aplikace CashPilot.');
    expect(ACCESS_REQUEST_BODY).toContain('E-mail účtu Google, kterým se budu přihlašovat:');
    expect(ACCESS_REQUEST_BODY).toContain('[DOPLŇTE E-MAIL]');
    expect(ACCESS_REQUEST_BODY).toContain('Děkuji.');

    const gmailUrl = buildGmailComposeUrl();
    expect(gmailUrl).toContain(`body=${encodeURIComponent(ACCESS_REQUEST_BODY)}`);
  });

  it('7. Česká diakritika, mezery a odřádkování v Gmail Compose URL fungují a dekódují se správně', () => {
    const gmailUrl = buildGmailComposeUrl();
    const urlObj = new URL(gmailUrl);
    expect(urlObj.origin).toBe('https://mail.google.com');
    expect(urlObj.pathname).toBe('/mail/');
    expect(urlObj.searchParams.get('view')).toBe('cm');
    expect(urlObj.searchParams.get('fs')).toBe('1');
    expect(urlObj.searchParams.get('to')).toBe('cashpilot@byzahr.app');
    expect(urlObj.searchParams.get('su')).toBe('Žádost o přístup do CashPilot');
    expect(urlObj.searchParams.get('body')).toBe(ACCESS_REQUEST_BODY);
  });

  it('8. Uživatel bez lokálního poštovního klienta může žádost připravit přímo v prohlížeči', () => {
    const gmailUrl = buildGmailComposeUrl();
    expect(gmailUrl.startsWith('https://mail.google.com/mail/?view=cm&fs=1')).toBe(true);
  });

  it('9. Pod tlačítkem je zobrazena záložní možnost „Zkopírovat kontaktní e-mail“', () => {
    const html = renderScreen();
    expect(html).toContain('Zkopírovat kontaktní e-mail');
  });

  it('10. Záložní možnost obsahuje adresu cashpilot@byzahr.app', () => {
    const html = renderScreen();
    expect(html).toContain('cashpilot@byzahr.app');
  });

  it('11. Aplikace netvrdí, že byla zpráva odeslána (žádné falešné hlášení)', () => {
    const html = renderScreen();
    expect(html).not.toContain('Žádost byla odeslána');
    expect(html).not.toContain('Zpráva byla odeslána');
    expect(html).not.toContain('byla odeslána');
  });

  it('12. Původní přihlášení přes Google zůstalo zachováno jako primární akce', () => {
    const html = renderScreen();
    const loginBtnIndex = html.indexOf('Přihlásit se přes Google');
    const dividerIndex = html.indexOf('nebo');
    const gmailBtnIndex = html.indexOf('Požádat o přístup přes Gmail');

    expect(loginBtnIndex).toBeGreaterThan(-1);
    expect(dividerIndex).toBeGreaterThan(loginBtnIndex);
    expect(gmailBtnIndex).toBeGreaterThan(dividerIndex);
  });

  it('13. Adresa pzahradn@gmail.com se nikde v souvislosti se žádostí nepoužívá', () => {
    const gmailUrl = buildGmailComposeUrl();
    expect(gmailUrl).not.toContain('pzahradn@gmail.com');
    const html = renderScreen();
    expect(html).not.toContain('pzahradn@gmail.com');
  });

  it('14. Úvodní text a 3 vlastnosti odpovídají novému znění bez kontokorentu', () => {
    const html = renderScreen();
    expect(html).toContain('Mějte své příjmy, výdaje i budoucí vývoj zůstatků pod kontrolou');
    expect(html).toContain('Soukromé úložiště Google Disk');
    expect(html).toContain('Automatická synchronizace');
    expect(html).toContain('Plánování a statistiky');
    expect(html.toLowerCase()).not.toContain('kontokorent');
    expect(html.toLowerCase()).not.toContain('bankovních limitech');
  });
});
