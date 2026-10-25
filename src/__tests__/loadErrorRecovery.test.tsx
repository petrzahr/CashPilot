// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createResetAppData } from '../constants/defaultData';
import { AppContent } from '../App';
import { FinanceProvider, useFinance } from '../context/FinanceContext';
import { RECOVERY_KEY_PREFIX, setActiveStorageKey } from '../services/storageService';
import { accountStorageKey } from '../services/syncModel';

const mocks = vi.hoisted(() => ({
  fetchGoogleUserProfile: vi.fn(),
  // Úvodní synchronizace se nikdy nedokončí: testuje se jen načtení lokální obálky
  findAppDataFile: vi.fn((): Promise<{ id: string } | null> => new Promise(() => {})),
  readDriveSnapshot: vi.fn(),
  uploadToGoogleDrive: vi.fn(),
}));

vi.mock('../services/googleDriveService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/googleDriveService')>()),
  getValidAccessToken: () => 'token-1',
  isStoredTokenValid: () => true,
  fetchGoogleUserProfile: mocks.fetchGoogleUserProfile,
  findAppDataFile: mocks.findAppDataFile,
  readDriveSnapshot: mocks.readDriveSnapshot,
  uploadToGoogleDrive: mocks.uploadToGoogleDrive,
  backupLegacyCloud: vi.fn(async () => {}),
}));
vi.mock('../services/driveBackupService', () => ({
  getLastDriveBackupAt: () => null,
  isDriveBackupEnabled: () => false,
  setDriveBackupEnabled: vi.fn(),
  tryRunDriveBackup: vi.fn(async () => ({ ran: false })),
}));

const envelopeKey = accountStorageKey('perm-1');
// jsdom neumí scrollTo; po obnově se vykreslí hlavní obrazovka aplikace
Element.prototype.scrollTo ??= () => {};

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

function dataWithAccount(id: string, revision = 0) {
  const data = createResetAppData();
  data.accounts = [{ id, name: id } as typeof data.accounts[number]];
  data.sync = { revision, updatedAt: '2026-10-01T00:00:00.000Z', updatedByDeviceId: 'other-device' };
  return data;
}

/** Google Disk s jedním souborem aplikace; upload přepíše jeho obsah. */
function useDriveWith(cloud: ReturnType<typeof createResetAppData>) {
  const drive = { data: cloud, etag: 1 };
  mocks.findAppDataFile.mockImplementation(async () => ({ id: 'file-1' }));
  mocks.readDriveSnapshot.mockImplementation(async () => ({ data: structuredClone(drive.data), etag: `e${drive.etag}` }));
  mocks.uploadToGoogleDrive.mockImplementation(async (_token: string, data: typeof cloud) => {
    drive.data = structuredClone(data);
    drive.etag++;
    return { id: 'file-1' };
  });
  return drive;
}

function recoveryKeys() {
  return Object.keys(localStorage).filter(key => key.startsWith(RECOVERY_KEY_PREFIX));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findAppDataFile.mockReset().mockImplementation(() => new Promise(() => {}));
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

describe('obnova z obrazovky chyby načtení', () => {
  it('„Načíst data z Google Disku“ zahodí jen lokální obálku a cloud nechá beze změny', async () => {
    const drive = useDriveWith(dataWithAccount('acc-cloud', 3));
    localStorage.setItem(envelopeKey, '{broken');
    renderApp();
    await waitFor(() => expect(finance.loadState).toBe('loadError'));
    const { recoveryKey } = finance.loadErrorDetails!;

    fireEvent.click(screen.getByRole('button', { name: 'Načíst data z Google Disku' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zahodit a načíst z Disku' }));

    await waitFor(() => expect(finance.isCloudReady).toBe(true));
    expect(finance.loadState).toBe('ready');
    expect(finance.loadErrorDetails).toBeNull();
    expect(finance.data.accounts.map(account => account.id)).toEqual(['acc-cloud']);
    expect(drive.data.accounts.map(account => account.id)).toEqual(['acc-cloud']);
    expect(drive.data.resetMarker).toBeUndefined();
    for (const [, data] of mocks.uploadToGoogleDrive.mock.calls) expect(data.resetMarker).toBeUndefined();
    // Kopie poškozených dat zůstala, obálka je nově založená z cloudu
    expect(localStorage.getItem(recoveryKey!)).toBe('{broken');
    expect(JSON.parse(localStorage.getItem(envelopeKey)!).fileId).toBe('file-1');
  });

  it('„Obnovit ze zálohy“ načte data z Disku a zálohu s nimi sloučí bez resetu', async () => {
    const drive = useDriveWith(dataWithAccount('acc-cloud', 3));
    localStorage.setItem(envelopeKey, '{broken');
    renderApp();
    await waitFor(() => expect(finance.loadState).toBe('loadError'));

    await act(async () => { finance.restoreFromBackupFile(JSON.stringify(dataWithAccount('acc-backup'))); });

    await waitFor(() => expect(finance.data.accounts.map(account => account.id).sort()).toEqual(['acc-backup', 'acc-cloud']));
    expect(finance.loadState).toBe('ready');
    expect(screen.getByText('Data z Google Disku byla načtena a záloha s nimi sloučena.')).toBeTruthy();
    // Sloučená data se nahrají po krátkém odkladu změny
    await waitFor(() => expect(drive.data.accounts.map(account => account.id).sort()).toEqual(['acc-backup', 'acc-cloud']), { timeout: 4000 });
    expect(drive.data.resetMarker).toBeUndefined();
  });

  it('neplatná záloha nic nesmaže a relaci nerestartuje', async () => {
    localStorage.setItem(envelopeKey, '{broken');
    renderApp();
    await waitFor(() => expect(finance.loadState).toBe('loadError'));

    let result: unknown;
    await act(async () => { result = await finance.restoreFromBackupFile('{"nope":'); });
    expect(result).toMatchObject({ ok: false, reason: 'rejected' });

    expect(localStorage.getItem(envelopeKey)).toBe('{broken');
    expect(mocks.fetchGoogleUserProfile).toHaveBeenCalledTimes(1);
    expect(finance.loadState).toBe('loadError');
  });

  it('bez uložené kopie poškozených dat se obálka nesmaže', async () => {
    const setItem = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.startsWith(RECOVERY_KEY_PREFIX)) throw new Error('QuotaExceededError');
      setItem.call(this, key, value);
    });
    try {
      localStorage.setItem(envelopeKey, '{broken');
      renderApp();
      await waitFor(() => expect(finance.loadState).toBe('loadError'));
      expect(finance.loadErrorDetails?.recoveryKey).toBeUndefined();

      await act(async () => { finance.reloadFromDrive(); });

      expect(localStorage.getItem(envelopeKey)).toBe('{broken');
      expect(mocks.fetchGoogleUserProfile).toHaveBeenCalledTimes(1);
      expect(finance.loadState).toBe('loadError');
      expect(screen.getByText('Kopii poškozených dat se nepodařilo uložit, proto zůstala beze změny.')).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });
});
