import { describe, it, expect } from 'vitest';
import { describeSyncError, getSyncErrorDetails } from '../services/syncErrorText';

describe('describeSyncError – hlášky s HTTP odpovědí', () => {
  it('odřízne surovou odpověď a u 5xx přidá další krok', () => {
    const raw = 'Nepodařilo se uložit data na Google Disk (HTTP 503): {"error":{"code":503}}';
    expect(describeSyncError(raw)).toBe(
      'Nepodařilo se uložit data na Google Disk. Google Disk má teď potíže, zkuste to za chvíli znovu. Změny zůstávají v tomto zařízení.'
    );
    expect(getSyncErrorDetails(raw)).toBe(raw);
  });

  it('u konfliktu zachová dovětek, že nic nebylo přepsáno', () => {
    const raw = 'Konflikt synchronizace: duplicitní datový soubor se nepodařilo odložit (HTTP 400): {"x":1}. Žádný soubor nebyl přepsán.';
    expect(describeSyncError(raw)).toBe(
      'Konflikt synchronizace: duplicitní datový soubor se nepodařilo odložit. Žádný soubor nebyl přepsán. Zkuste to znovu, změny zůstávají v tomto zařízení.'
    );
  });

  it('kód 403 převede na výzvu k novému přihlášení', () => {
    expect(describeSyncError('Chyba při hledání souboru na Google Disku (HTTP 403): forbidden'))
      .toContain('Přihlaste se znovu');
  });

  it('srozumitelná česká hláška nemá technické podrobnosti', () => {
    const msg = 'Platnost přihlášení k Google Disku vypršela. Přihlaste se prosím znovu.';
    expect(describeSyncError(msg)).toBe(msg);
    expect(getSyncErrorDetails(msg)).toBeNull();
  });
});
