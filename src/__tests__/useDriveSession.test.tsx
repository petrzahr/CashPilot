// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppData } from '../services/storageService';

const mocks = vi.hoisted(() => {
  class FakeSyncController {
    static instances: FakeSyncController[] = [];
    isReady = false;
    data = {} as AppData;
    sync = vi.fn(async () => {});
    change = vi.fn();
    stop = vi.fn(() => { this.isReady = false; });
    constructor(
      public identity: string,
      public token: () => string | null,
      public onChange: (data: AppData, status: string, ready: boolean, error?: string) => void,
    ) {
      FakeSyncController.instances.push(this);
    }
  }
  return {
    FakeSyncController,
    getValidAccessToken: vi.fn<() => string | null>(),
    fetchGoogleUserProfile: vi.fn(),
    logoutFromGoogle: vi.fn(async () => {}),
    loginToGoogle: vi.fn(async () => 'login-token'),
    setActiveStorageKey: vi.fn(),
    tryRunDriveBackup: vi.fn(async () => ({ ran: false })),
  };
});

vi.mock('../services/syncController', () => ({ SyncController: mocks.FakeSyncController }));
vi.mock('../services/googleDriveService', () => ({
  getValidAccessToken: mocks.getValidAccessToken,
  isStoredTokenValid: () => mocks.getValidAccessToken() !== null,
  fetchGoogleUserProfile: mocks.fetchGoogleUserProfile,
  loginToGoogle: mocks.loginToGoogle,
  logoutFromGoogle: mocks.logoutFromGoogle,
}));
vi.mock('../services/driveBackupService', () => ({
  getLastDriveBackupAt: () => null,
  isDriveBackupEnabled: () => true,
  setDriveBackupEnabled: vi.fn(),
  tryRunDriveBackup: mocks.tryRunDriveBackup,
}));
vi.mock('../services/storageService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/storageService')>()),
  setActiveStorageKey: mocks.setActiveStorageKey,
}));

import { useDriveSession } from '../hooks/useDriveSession';
import { accountStorageKey } from '../services/syncModel';

const user = { permissionId: 'perm-1', displayName: 'Petr' };
const cloudData = { accounts: [] } as unknown as AppData;

function callbacks() {
  return {
    onData: vi.fn(),
    onNoSession: vi.fn(),
    onDisconnected: vi.fn(),
    onLoadError: vi.fn(),
    getData: vi.fn(() => cloudData),
    showToast: vi.fn(),
  };
}

/** Spustí hook s tokenem a počká, až relace založí controller. */
async function startedSession() {
  mocks.getValidAccessToken.mockReturnValue('token-1');
  mocks.fetchGoogleUserProfile.mockResolvedValue(user);
  const cb = callbacks();
  const hook = renderHook((props: ReturnType<typeof callbacks>) => useDriveSession(props), { initialProps: cb });
  await waitFor(() => expect(mocks.FakeSyncController.instances).toHaveLength(1));
  const controller = mocks.FakeSyncController.instances[0];
  const emit = (status: string, ready: boolean, error?: string) => act(() => {
    controller.isReady = ready;
    controller.onChange(cloudData, status, ready, error);
  });
  return { hook, cb, controller, emit };
}

beforeEach(() => {
  mocks.FakeSyncController.instances = [];
  vi.clearAllMocks();
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('useDriveSession', () => {
  it('bez tokenu relaci nespustí a zápis odmítne', () => {
    mocks.getValidAccessToken.mockReturnValue(null);
    const cb = callbacks();
    const { result } = renderHook(() => useDriveSession(cb));

    expect(cb.onNoSession).toHaveBeenCalledTimes(1);
    expect(mocks.FakeSyncController.instances).toHaveLength(0);
    expect(result.current.driveSyncStatus).toBe('disconnected');
    expect(result.current.change(d => d)).toBe(false);
  });

  it('s tokenem ověří účet, nastaví úložiště účtu a předává data a stav', async () => {
    const { hook, cb, controller, emit } = await startedSession();

    expect(mocks.setActiveStorageKey).toHaveBeenCalledWith(accountStorageKey('perm-1'));
    expect(controller.identity).toBe('perm-1');
    expect(hook.result.current.driveUser).toEqual(user);
    // Před první synchronizací se zápis neuloží
    expect(hook.result.current.change(d => d)).toBe(false);

    emit('synced', true);
    expect(cb.onData).toHaveBeenCalledWith(cloudData);
    expect(hook.result.current.driveSyncStatus).toBe('synced');
    expect(hook.result.current.isCloudReady).toBe(true);
    expect(hook.result.current.lastDriveSyncTime).toBeInstanceOf(Date);

    const action = (d: AppData) => d;
    expect(hook.result.current.change(action, true)).toBe(true);
    expect(controller.change).toHaveBeenCalledWith(action, true);
  });

  it('nové identity callbacků relaci nerestartují a použijí se nejnovější', async () => {
    const { hook, emit } = await startedSession();
    const next = callbacks();
    hook.rerender(next);
    hook.rerender(callbacks());
    hook.rerender(next);

    expect(mocks.FakeSyncController.instances).toHaveLength(1);
    emit('synced', true);
    expect(next.onData).toHaveBeenCalledWith(cloudData);
  });

  it('odpojení zastaví controller, vynuluje stav a zahodí lokální data', async () => {
    const { hook, cb, controller, emit } = await startedSession();
    emit('synced', true);

    await act(() => hook.result.current.disconnectGoogleDrive());

    expect(controller.stop).toHaveBeenCalled();
    expect(mocks.setActiveStorageKey).toHaveBeenLastCalledWith(null);
    expect(cb.onDisconnected).toHaveBeenCalledTimes(1);
    expect(mocks.logoutFromGoogle).toHaveBeenCalled();
    expect(hook.result.current.driveSyncStatus).toBe('disconnected');
    expect(hook.result.current.driveUser).toBeNull();
    expect(hook.result.current.change(d => d)).toBe(false);
  });

  it('pozdní odpověď po odpojení komponenty relaci nezaloží', async () => {
    mocks.getValidAccessToken.mockReturnValue('token-1');
    let resolveProfile!: (value: typeof user) => void;
    mocks.fetchGoogleUserProfile.mockReturnValue(new Promise(resolve => { resolveProfile = resolve; }));
    const { unmount } = renderHook(() => useDriveSession(callbacks()));

    unmount();
    await act(async () => { resolveProfile(user); });

    expect(mocks.FakeSyncController.instances).toHaveLength(0);
    expect(mocks.setActiveStorageKey).not.toHaveBeenCalled();
  });

  it('chyba synchronizace ukáže oznámení se „Zkusit znovu“, obnovení potvrdí', async () => {
    const { cb, controller, emit } = await startedSession();
    emit('synced', true);

    emit('error', true, 'Síť nedostupná');
    expect(cb.showToast).toHaveBeenCalledTimes(1);
    const [, type, action] = cb.showToast.mock.calls[0];
    expect(type).toBe('error');
    expect(action.label).toBe('Zkusit znovu');

    controller.sync.mockClear();
    await act(async () => { action.onClick(); });
    expect(controller.sync).toHaveBeenCalled();

    emit('synced', true);
    expect(cb.showToast).toHaveBeenLastCalledWith('Změny jsou znovu uložené na Google Disku.');
  });
});
