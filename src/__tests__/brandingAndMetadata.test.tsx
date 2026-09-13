import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'fs';
import path from 'path';
import { LoginScreen } from '../components/auth/LoginScreen';
import { FinanceProvider } from '../context/FinanceContext';

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

describe('CashPilot – Sjednocení brandingu a metadat', () => {
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

  describe('1. Přihlašovací obrazovka (LoginScreen)', () => {
    it('zobrazuje pod názvem CashPilot nový podtitul „Vaše osobní finance pod kontrolou“', () => {
      const html = renderToStaticMarkup(
        <FinanceProvider>
          <LoginScreen />
        </FinanceProvider>
      );

      // Přesný podtitul v hlavičce
      expect(html).toContain('Vaše osobní finance pod kontrolou');
      expect(html).toMatch(
        /<p[^>]*class="[^"]*text-xs text-sky-600 font-bold uppercase tracking-wider[^"]*"[^>]*>[\s\S]*?Vaše osobní finance pod kontrolou[\s\S]*?<\/p>/
      );
    });

    it('neobsahuje původní podtitul „Osobní rozpočet & forecast“ ani slovo „forecast“', () => {
      const html = renderToStaticMarkup(
        <FinanceProvider>
          <LoginScreen />
        </FinanceProvider>
      );

      expect(html).not.toContain('Osobní rozpočet &amp; forecast');
      expect(html).not.toContain('Osobní rozpočet & forecast');
      expect(html.toLowerCase()).not.toContain('forecast');
    });

    it('ponechává text v zápatí přihlašovací obrazovky beze změny', () => {
      const html = renderToStaticMarkup(
        <FinanceProvider>
          <LoginScreen />
        </FinanceProvider>
      );

      expect(html).toContain('CashPilot • Vaše osobní finance pod kontrolou');
    });
  });

  describe('2. Název karty prohlížeče a metadata v index.html', () => {
    const indexPath = path.resolve(__dirname, '../../index.html');
    const indexHtml = fs.readFileSync(indexPath, 'utf8');

    it('má element <title> s přesným zněním „CashPilot – Vaše osobní finance pod kontrolou“', () => {
      expect(indexHtml).toContain('<title>CashPilot – Vaše osobní finance pod kontrolou</title>');
    });

    it('neobsahuje původní formulaci o 12měsíčním výhledu', () => {
      expect(indexHtml).not.toContain('12měsíční výhled');
      expect(indexHtml).not.toContain('12měsíční');
    });

    it('obsahuje meta description, Open Graph a Twitter karty se sjednoceným názvem', () => {
      expect(indexHtml).toContain('meta property="og:title" content="CashPilot – Vaše osobní finance pod kontrolou"');
      expect(indexHtml).toContain('meta name="twitter:title" content="CashPilot – Vaše osobní finance pod kontrolou"');
      expect(indexHtml).toContain('meta name="theme-color" content="#0284c7"');
    });

    it('odkazuje na favikony a manifest s verzováním proti cache (?v=2) a relativní cestou', () => {
      expect(indexHtml).toContain('href="./favicon.svg?v=2"');
      expect(indexHtml).toContain('href="./favicon-32x32.png?v=2"');
      expect(indexHtml).toContain('href="./favicon-16x16.png?v=2"');
      expect(indexHtml).toContain('href="./apple-touch-icon.png?v=2"');
      expect(indexHtml).toContain('href="./site.webmanifest?v=2"');
    });
  });

  describe('3. Statické soubory ikon v public/', () => {
    const publicDir = path.resolve(__dirname, '../../public');

    it('obsahuje validní SVG favicon s motivem ikony CashPilot', () => {
      const svgPath = path.join(publicDir, 'favicon.svg');
      expect(fs.existsSync(svgPath)).toBe(true);

      const svgContent = fs.readFileSync(svgPath, 'utf8');
      expect(svgContent).toContain('<svg');
      expect(svgContent).toContain('#0284c7'); // sky-600
      expect(svgContent).toContain('#0ea5e9'); // sky-500
      expect(svgContent).toContain('circle cx="12" cy="12" r="10"'); // Lucide Compass
      expect(svgContent).toContain('16.24 7.76'); // needle path
    });

    it('obsahuje všechny požadované formáty PNG ikon s nenulovou velikostí', () => {
      const requiredFiles = [
        'favicon-16x16.png',
        'favicon-32x32.png',
        'apple-touch-icon.png',
        'favicon-192x192.png',
        'favicon-512x512.png',
      ];

      for (const file of requiredFiles) {
        const filePath = path.join(publicDir, file);
        expect(fs.existsSync(filePath), `File ${file} should exist`).toBe(true);
        const stats = fs.statSync(filePath);
        expect(stats.size).toBeGreaterThan(100);
      }
    });

    it('obsahuje validní web app manifest site.webmanifest se sjednoceným názvem', () => {
      const manifestPath = path.join(publicDir, 'site.webmanifest');
      expect(fs.existsSync(manifestPath)).toBe(true);

      const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      expect(manifestContent.name).toBe('CashPilot – Vaše osobní finance pod kontrolou');
      expect(manifestContent.short_name).toBe('CashPilot');
      expect(manifestContent.icons).toHaveLength(2);
      expect(manifestContent.icons[0].sizes).toBe('192x192');
      expect(manifestContent.icons[1].sizes).toBe('512x512');
    });
  });
});
