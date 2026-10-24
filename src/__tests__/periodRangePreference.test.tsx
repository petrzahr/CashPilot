import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FinanceProvider } from '../context/FinanceContext';
import { AnalyticsScreen } from '../components/analytics/AnalyticsScreen';
import { OverviewScreen } from '../components/overview/OverviewScreen';
import {
  BUILT_IN_DEFAULT_RANGE,
  getDefaultRangeId,
  rememberSessionRange,
  resolveSessionRange,
} from '../services/periodRangePreference';
import { getInitialData, validateAndParseBackup } from '../services/storageService';
import { mergePending, migrateSyncData, recordLocalChange, type SyncEnvelope } from '../services/syncModel';
import { SyncController } from '../services/syncController';
import { AppSettings } from '../types/finance';

const base = (): AppSettings => ({ ...getInitialData().settings });

describe('Výchozí rozsah období v nastavení', () => {
  it('bez uložené volby (starší data) použije vestavěné výchozí rozsahy', () => {
    expect(getDefaultRangeId(base(), 'overview')).toBe('future:12');
    expect(getDefaultRangeId(base(), 'analytics')).toBe('past:12');
    expect(getDefaultRangeId(undefined, 'analytics')).toBe(BUILT_IN_DEFAULT_RANGE.analytics);
  });

  it('platnou volbu použije, neplatnou z Disku ignoruje', () => {
    expect(getDefaultRangeId({ ...base(), defaultPeriodRanges: { analytics: 'past:6' } }, 'analytics')).toBe('past:6');
    for (const bad of ['future:7', 'custom', 42, null, '']) {
      const settings = { ...base(), defaultPeriodRanges: { overview: bad } } as unknown as AppSettings;
      expect(getDefaultRangeId(settings, 'overview')).toBe('future:12');
    }
    const broken = { ...base(), defaultPeriodRanges: 'past:3' } as unknown as AppSettings;
    expect(getDefaultRangeId(broken, 'analytics')).toBe('past:12');
  });

  it('v relaci si pamatuje poslední výběr, po změně výchozí volby začne znovu od ní', () => {
    const settings = { ...base(), defaultPeriodRanges: { overview: 'future:6' as const } };
    expect(resolveSessionRange(undefined, settings, 'overview')).toEqual({ direction: 'future', months: 6 });

    const saved = rememberSessionRange(settings, 'overview', { direction: 'past', preset: 'ytd' });
    expect(resolveSessionRange(saved, settings, 'overview')).toEqual({ direction: 'past', preset: 'ytd' });
    expect(resolveSessionRange(undefined, settings, 'analytics')).toEqual({ direction: 'past', months: 12 });

    const changed = { ...settings, defaultPeriodRanges: { overview: 'future:24' as const } };
    expect(resolveSessionRange(saved, changed, 'overview')).toEqual({ direction: 'future', months: 24 });
  });

  it('obrazovky se otevřou s výchozím rozsahem z nastavení', () => {
    const data = getInitialData();
    data.settings.defaultPeriodRanges = { overview: 'future:3', analytics: 'past:6' };
    const session = { data, isReady: true } as SyncController;
    const overview = renderToStaticMarkup(<FinanceProvider syncSession={session}><OverviewScreen onNavigateToBudget={() => {}} /></FinanceProvider>);
    const analytics = renderToStaticMarkup(<FinanceProvider syncSession={session}><AnalyticsScreen /></FinanceProvider>);
    expect(overview).toContain('aria-pressed="true" aria-label="Příští 3 měsíce"');
    expect(analytics).toContain('aria-pressed="true" aria-label="Posledních 6 měsíců"');
  });
});

describe('Výchozí rozsah – záloha a synchronizace', () => {
  it('záloha volbu zachová a starší záloha bez ní projde beze změny', () => {
    const data = getInitialData();
    data.settings.defaultPeriodRanges = { analytics: 'past:3' };
    expect(validateAndParseBackup(JSON.stringify(data)).settings.defaultPeriodRanges).toEqual({ analytics: 'past:3' });

    const old = getInitialData();
    const restored = validateAndParseBackup(JSON.stringify(old));
    expect(restored.settings.defaultPeriodRanges).toBeUndefined();
    expect(restored.version).toBe(2);
  });

  it('změna volby vznikne jako operace nastavení a po sloučení s Diskem se neztratí', () => {
    const local = migrateSyncData(getInitialData());
    const envelope: SyncEnvelope = { data: local, pending: [], cloudRevision: 0, generation: 0 };
    const requested = { ...local, settings: { ...local.settings, defaultPeriodRanges: { overview: 'past:all' as const } } };
    const next = recordLocalChange(envelope, requested, 'device-a', '2026-10-18T10:00:00.000Z');

    expect(next.pending.map((op) => op.entityType)).toEqual(['settings']);
    const merged = mergePending(migrateSyncData(getInitialData()), next.data, next.pending);
    expect(merged.settings.defaultPeriodRanges).toEqual({ overview: 'past:all' });
  });

  it('jiná změna nastavení volbu zachová (sloučení přes spread jako v updateSettings)', () => {
    const local = migrateSyncData(getInitialData());
    local.settings.defaultPeriodRanges = { analytics: 'future:18' };
    const envelope: SyncEnvelope = { data: local, pending: [], cloudRevision: 0, generation: 0 };
    const requested = { ...local, settings: { ...local.settings, budgetStartDay: 1 } };
    const next = recordLocalChange(envelope, requested, 'device-a', '2026-10-18T10:00:00.000Z');
    const merged = mergePending(migrateSyncData(getInitialData()), next.data, next.pending);
    expect(merged.settings.defaultPeriodRanges).toEqual({ analytics: 'future:18' });
    expect(merged.settings.budgetStartDay).toBe(1);
  });
});
