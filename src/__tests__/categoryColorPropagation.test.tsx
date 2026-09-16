import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { FinanceProvider, useFinance } from '../context/FinanceContext';
import { Category } from '../types/finance';
import { AppData, getInitialData } from '../services/storageService';
import { SyncController } from '../services/syncController';

const mainCategory: Category = {
  id: 'main1', name: 'Hlavní kategorie', type: 'expense', parentId: null,
  color: '#111111', icon: 'Folder', sortOrder: 1, status: 'active',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

const activeSub: Category = {
  id: 'sub1', name: 'Aktivní podkategorie', type: 'expense', parentId: 'main1',
  color: '#222222', icon: 'Tag', sortOrder: 1, status: 'active',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

const archivedSub: Category = {
  id: 'sub2', name: 'Archivovaná podkategorie', type: 'expense', parentId: 'main1',
  color: '#333333', icon: 'Tag', sortOrder: 2, status: 'archived',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

function workflow(initial: Partial<AppData> = {}) {
  let data: AppData = { ...getInitialData(), categories: [mainCategory, activeSub, archivedSub], ...initial };
  return {
    get data() { return data; },
    updateCategory(cat: Category) {
      let finance!: ReturnType<typeof useFinance>;
      const session = {
        data, isReady: true, change: (action: React.SetStateAction<AppData>) => {
          data = typeof action === 'function' ? action(data) : action;
        }
      } as unknown as SyncController;
      function Capture() { finance = useFinance(); return null; }
      renderToStaticMarkup(<FinanceProvider syncSession={session}><Capture /></FinanceProvider>);
      finance.updateCategory(cat);
    },
  };
}

describe('Propagace barvy z hlavní kategorie na podkategorie', () => {
  it('změna barvy hlavní kategorie přepíše barvu všech jejích podkategorií (včetně archivovaných)', () => {
    const flow = workflow();
    flow.updateCategory({ ...mainCategory, color: '#abcdef' });

    const [main, sub1, sub2] = flow.data.categories;
    expect(main.color).toBe('#abcdef');
    expect(sub1.color).toBe('#abcdef');
    expect(sub2.color).toBe('#abcdef');
  });

  it('následná ruční změna barvy jedné podkategorie neovlivní ostatní podkategorie ani hlavní kategorii', () => {
    const flow = workflow();
    flow.updateCategory({ ...mainCategory, color: '#abcdef' });
    flow.updateCategory({ ...flow.data.categories[1], color: '#ff0000' });

    const [main, sub1, sub2] = flow.data.categories;
    expect(sub1.color).toBe('#ff0000');
    expect(sub2.color).toBe('#abcdef');
    expect(main.color).toBe('#abcdef');
  });

  it('úprava hlavní kategorie beze změny barvy nepropaguje nic do podkategorií', () => {
    const flow = workflow();
    flow.updateCategory({ ...mainCategory, name: 'Přejmenovaná hlavní kategorie' });

    const [main, sub1, sub2] = flow.data.categories;
    expect(main.name).toBe('Přejmenovaná hlavní kategorie');
    expect(sub1.color).toBe('#222222');
    expect(sub2.color).toBe('#333333');
  });

  it('úprava barvy podkategorie samotné nepropaguje barvu na sourozence ani na hlavní kategorii', () => {
    const flow = workflow();
    flow.updateCategory({ ...activeSub, color: '#00ff00' });

    const [main, sub1, sub2] = flow.data.categories;
    expect(sub1.color).toBe('#00ff00');
    expect(sub2.color).toBe('#333333');
    expect(main.color).toBe('#111111');
  });
});
