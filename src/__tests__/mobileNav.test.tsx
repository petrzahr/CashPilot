import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MobileNav } from '../components/layout/MobileNav';
import { NavScreen } from '../components/layout/Sidebar';

const render = (currentScreen: NavScreen, drawerOpen = false) =>
  renderToStaticMarkup(
    <MobileNav currentScreen={currentScreen} onSelectScreen={() => {}} drawerOpen={drawerOpen} onOpenDrawer={() => {}} />
  );

const labels = (html: string) =>
  Array.from(html.matchAll(/<span class="text-xs[^"]*">([^<]+)<\/span>/g)).map((m) => m[1]);

describe('MobileNav - spodní lišta na telefonu', () => {
  it('ukazuje čtyři hlavní sekce a „Více“ v daném pořadí', () => {
    expect(labels(render('budget'))).toEqual(['Rozpočet', 'Majetek', 'Analýza', 'Položky', 'Více']);
  });

  it('označí aktivní hlavní sekci přes aria-current', () => {
    const html = render('transactions');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>(?:(?!<\/button>).)*Položky/);
  });

  it('pro sekci mimo lištu zvýrazní „Více“ a žádná sekce není aktuální', () => {
    const html = render('settings');
    expect(html).not.toContain('aria-current');
    expect(html).toMatch(/text-sky-700">Více</);
  });

  it('„Více“ odkazuje na zásuvku a hlásí její stav', () => {
    expect(render('budget', true)).toMatch(/aria-expanded="true" aria-controls="app-drawer"/);
    expect(render('budget', false)).toMatch(/aria-expanded="false" aria-controls="app-drawer"/);
  });
});
