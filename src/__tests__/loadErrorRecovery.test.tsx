// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createResetAppData } from '../constants/defaultData';
import { AppContent } from '../App';
import { FinanceProvider, useFinance } from '../context/FinanceContext';
import { RECOVERY_KEY_PREFIX, setActiveStorageKey } from '../services/storageService';
import { accountStorageKey } from '../services/syncModel';

const mocks = vi.hoisted(() => ({
  fetchGoogleUserProfile: vi.fn(),
  // Úvodní synchronizace se nikdy nedokončí: testuje se jen načtení lokální obálky
  findAppDataFile: vi.fn(() => new Promise(() => {})),
}));

vi.mock('../services/googleDriveService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/googleDriveService')>()),
  getValidAccessToken: () => 'token-1',
  isStoredTokenValid: () => true,
  fetchGoogleUserProfile: mocks.fetchGoogleUserProfile,
  findAppDataFile: mocks.findAppDataFile,
}));
vi.mock('../services/driveBackupService', () => ({
  getLastDriveBackupAt: () => null,
  isDriveBackupEnabled: () => false,
  setDriveBackupEnabled: vi.fn(),
  tryRunDriveBackup: vi.fn(async () => ({ ran: false })),
}));

const envelopeKey = accountStorageKey('perm-1');

let finance: ReturnType<typeof useFinance>;
function Probe() {
  finance = useFinance();
  return null;
}

function renderApp() {
  render(
    <FinanceProvider>
      <Probe />
      <AppContent />
    </FinanceProvider>
  );
}

function validEnvelope() {
  const data = createResetAppData();
  data.accounts = [{ id: 'acc-1', name: 'Běžný účet' } as typeof data.accounts[number]];
  return JSON.stringify({ data, pending: [], cloudRevision: 0, generation: 0 });
}

function recoveryKeys() {
  return Object.keys(localStorage).filter(key => key.startsWith(RECOVERY_KEY_PREFIX));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.fetchGoogleUserProfile.mockResolvedValue({ permissionId: 'perm-1', displayName: 'Petr' });
});
afterEach(() => {
  cleanup();
  setActiveStorageKey(null);
});

describe('poškozená lokální obálka synchronizace', () => {
  it.each([
    ['neplatný JSON', '{"data": {"accounts": ['],
    ['poškozená fronta operací', JSON.stringify({ data: createResetAppData(), pending: [{}], cloudRevision: 0, generation: 0 })],
  ])('%s zobrazí obrazovku obnovy s kopií surových dat', async (_name, raw) => {
    localStorage.setItem(envelopeKey, raw);
    renderApp();

    await waitFor(() => expect(finance.loadState).toBe('loadError'));
    expect(screen.getByText('Data aplikace se nepodařilo bezpečně načíst')).toBeTruthy();

    const { recoveryKey, corruptedRaw } = finance.loadErrorDetails!;
    expect(corruptedRaw).toBe(raw);
    expect(recoveryKeys()).toEqual([recoveryKey]);
    expect(localStorage.getItem(recoveryKey!)).toBe(raw);
    // Původní obálka zůstala beze změny
    expect(localStorage.getItem(envelopeKey)).toBe(raw);
  });

  it('„Zkusit znovu“ načte opravenou obálku z klíče účtu', async () => {
    localStorage.setItem(envelopeKey, '{broken');
    renderApp();
    await waitFor(() => expect(finance.loadState).toBe('loadError'));

    localStorage.setItem(envelopeKey, validEnvelope());
    await act(async () => { finance.retryLoadData(); });

    await waitFor(() => expect(finance.loadState).toBe('ready'));
    expect(finance.loadErrorDetails).toBeNull();
    expect(finance.data.accounts.map(account => account.id)).toEqual(['acc-1']);
  });

  it('opakovaný pokus nad stále poškozenou obálkou zůstane na obrazovce obnovy', async () => {
    localStorage.setItem(envelopeKey, '{broken');
    renderApp();
    await waitFor(() => expect(finance.loadState).toBe('loadError'));

    await act(async () => { finance.retryLoadData(); });

    await waitFor(() => expect(mocks.fetchGoogleUserProfile).toHaveBeenCalledTimes(2));
    expect(finance.loadState).toBe('loadError');
    expect(finance.loadErrorDetails?.corruptedRaw).toBe('{broken');
    expect(localStorage.getItem(envelopeKey)).toBe('{broken');
  });
});
