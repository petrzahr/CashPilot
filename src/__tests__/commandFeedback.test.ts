import { describe, it, expect } from 'vitest';
import { createEmptyAppData } from '../constants/defaultData';
import * as feedback from '../services/commandFeedback';
import type { CommandFeedback } from '../services/commandFeedback';
import { createCommandContext } from '../services/transactionCommands';
import { formatCurrency } from '../services/currencyService';
import type { Account, BalanceCorrection, Category, InvestmentFee, MarketValueSnapshot, RecurringRule, Transaction } from '../types/finance';

const ctx = createCommandContext('2026-09-20', new Date('2026-09-20T12:00:00Z'));

const account: Account = {
  id: 'chk', name: 'Běžný', type: 'checking', currency: 'CZK', initialBalanceInHaler: 0, initialBalanceDate: '2026-01-01',
  isUsableCash: true, isNetWorth: true, color: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '',
};
const category: Category = {
  id: 'cat', name: 'Auto', type: 'expense', parentId: null, color: '', icon: '', sortOrder: 1, status: 'active', createdAt: '', updatedAt: '',
};
const tx: Transaction = {
  id: 'tx', title: 'Nákup', type: 'expense', status: 'planned', date: '2026-09-10', sequence: 1,
  amountInHaler: 1000, sourceAccountId: 'chk', createdAt: '', updatedAt: '',
};
const rule = { id: 'rule', title: 'Nájem' } as RecurringRule;
const correction: BalanceCorrection = {
  id: 'corr', accountId: 'chk', checkDate: '2026-09-01', actualBalanceInHaler: 0, calculatedBalanceInHaler: 0, diffInHaler: 5, createdAt: '',
};
const snapshot: MarketValueSnapshot = { id: 'mv', accountId: 'inv', date: '2026-09-01', marketValueInHaler: 1, createdAt: '' };
const fee: InvestmentFee = { id: 'fee', accountId: 'inv', periodKey: '2026-09', amountInHaler: 12345, createdAt: '' };

const ok = (text: string, type: feedback.ToastType = 'success'): CommandFeedback => ({ toast: { text, type } });
const undoToast = (f: CommandFeedback) => f.undo?.toast.text;

describe('položky', () => {
  it('přidání a úprava: úspěch, chyba jako oznámení i odmítnutí', () => {
    expect(feedback.addTransactionFeedback({ transaction: tx, sequence: 2 }))
      .toEqual(ok('Položka „Nákup“ byla přidána jako 2. v pořadí dne.'));
    expect(feedback.addTransactionFeedback({ error: 'Chyba' })).toEqual({ toast: { text: 'Chyba', type: 'error' }, rejected: 'Chyba' });
    expect(feedback.updateTransactionFeedback({ title: 'Nákup' })).toEqual(ok('Položka „Nákup“ byla upravena.'));
    expect(feedback.updateTransactionFeedback({ error: 'Chyba' })).toEqual({ toast: { text: 'Chyba', type: 'error' }, rejected: 'Chyba' });
    expect(feedback.reorderDayTransactionsFeedback()).toEqual(ok('Pořadí položek bylo uloženo.'));
  });

  it('smazání běžné položky nabídne „Vrátit“, které ji obnoví', () => {
    const plain = feedback.deleteTransactionFeedback({ kind: 'plain', transaction: tx }, { mode: 'occurrence' });
    expect(plain.toast).toEqual({ text: 'Položka „Nákup“ byla smazána.', type: 'success' });
    expect(undoToast(plain)).toBe('Položka byla obnovena.');
    const restored = plain.undo!.command(createEmptyAppData(), ctx).data;
    expect(restored.transactions.map(t => t.id)).toEqual(['tx']);

    const withCorrection = feedback.deleteTransactionFeedback({ kind: 'plain', transaction: tx, correction }, { mode: 'occurrence' });
    expect(withCorrection.toast?.text).toBe('Korekce zůstatku byla smazána.');
    expect(undoToast(withCorrection)).toBe('Korekce zůstatku byla obnovena.');
  });

  it('smazání pravidelné položky podle režimu, bez „Vrátit“', () => {
    const recurring = (mode: 'occurrence' | 'future' | 'series', ruleTitle?: string) =>
      feedback.deleteTransactionFeedback({ kind: 'recurring', mode, ruleTitle }, { mode });
    expect(recurring('series', 'Nájem')).toEqual(ok('Pravidelná položka „Nájem“ byla smazána.'));
    expect(recurring('future', 'Nájem')).toEqual(ok('Budoucí výskyty pravidelné položky „Nájem“ byly smazány.'));
    expect(recurring('occurrence', 'Nájem')).toEqual(ok('Výskyt pravidelné položky „Nájem“ byl smazán.'));
    expect(recurring('series')).toEqual(ok('Pravidelná položka byla smazána.'));
    expect(feedback.deleteTransactionFeedback({ kind: 'none' }, { mode: 'occurrence' }))
      .toEqual({ rejected: feedback.ITEM_NOT_FOUND_MESSAGE });
    expect(feedback.DELETE_TRANSACTION_FAILED).toEqual({ text: 'Položku se nepodařilo smazat. Zkuste to prosím znovu.', type: 'error' });
  });

  it('změna stavu', () => {
    const status = (s: 'executed' | 'cancelled' | 'planned', title = 'Nákup') => feedback.setTransactionStatusFeedback({ title }, { status: s });
    expect(status('executed')).toEqual(ok('Položka „Nákup“ byla označena jako uskutečněná.'));
    expect(status('cancelled')).toEqual(ok('Položka „Nákup“ byla označena jako zrušená.', 'info'));
    expect(status('planned')).toEqual(ok('Položka „Nákup“ byla nastavena jako plánovaná.', 'info'));
    expect(status('executed', '')).toEqual(ok('Položka byla označena jako uskutečněná.'));
    expect(status('cancelled', '')).toEqual(ok('Položka byla označena jako zrušená.', 'info'));
    expect(status('planned', '')).toEqual(ok('Položka byla nastavena jako plánovaná.', 'info'));
    expect(feedback.setTransactionStatusFeedback(null, { status: 'executed' })).toEqual({ rejected: feedback.ITEM_NOT_FOUND_MESSAGE });
  });
});

describe('pravidelné položky', () => {
  it('vytvoření: neaktivní účet hlásí i oznámení, neplatný zdroj jen volajícímu', () => {
    expect(feedback.addRecurringRuleFeedback({ rule })).toEqual(ok('Pravidelná položka „Nájem“ byla vytvořena.'));
    expect(feedback.addRecurringRuleFeedback({ error: 'Neaktivní', kind: 'inactiveAccount' }))
      .toEqual({ toast: { text: 'Neaktivní', type: 'error' }, rejected: 'Neaktivní' });
    expect(feedback.addRecurringRuleFeedback({ error: 'Zdroj', kind: 'invalidSource' })).toEqual({ rejected: 'Zdroj' });
  });

  it('úprava, pořadí a smazání', () => {
    expect(feedback.updateRecurringRuleFeedback({ ruleTitle: 'Nájem' })).toEqual(ok('Pravidelná položka „Nájem“ byla upravena.'));
    expect(feedback.updateRecurringRuleFeedback({})).toEqual(ok('Pravidelná položka byla upravena.'));
    expect(feedback.reorderRecurringItemFeedback()).toEqual(ok('Pořadí pravidelné položky bylo uloženo.'));
    expect(feedback.deleteRecurringRuleFeedback({ ruleTitle: 'Nájem' })).toEqual(ok('Pravidelná položka „Nájem“ byla smazána.'));
    expect(feedback.deleteRecurringRuleFeedback({})).toEqual(ok('Pravidelná položka byla smazána.'));
  });
});

describe('účty', () => {
  it('vytvoření, úprava a obnova z archivu', () => {
    expect(feedback.addAccountFeedback({ account })).toEqual(ok('Účet „Běžný“ byl vytvořen.'));
    expect(feedback.updateAccountFeedback({ account }, { account: { ...account, name: 'Nový' } })).toEqual(ok('Účet „Nový“ byl upraven.'));
    expect(feedback.updateAccountFeedback({ error: 'Chyba' }, { account })).toEqual({ toast: { text: 'Chyba', type: 'error' }, rejected: 'Chyba' });
    expect(feedback.restoreAccountFeedback({ name: 'Běžný' })).toEqual(ok('Účet „Běžný“ byl obnoven z archivu.'));
    expect(feedback.restoreAccountFeedback({})).toEqual(ok('Účet byl obnoven z archivu.'));
  });

  it('archivace s „Vrátit“, odmítnutí bez oznámení', () => {
    const archived = feedback.archiveAccountFeedback({ before: account });
    expect(archived.toast?.text).toBe('Účet „Běžný“ byl archivován.');
    expect(undoToast(archived)).toBe('Archivace účtu „Běžný“ byla vrácena.');
    const undone = archived.undo!.command({ ...createEmptyAppData(), accounts: [{ ...account, status: 'archived' }] }, ctx).data;
    expect(undone.accounts[0].status).toBe('active');
    expect(feedback.archiveAccountFeedback({})).toEqual(ok('Účet byl archivován.'));
    expect(feedback.archiveAccountFeedback({ error: 'V použití' })).toEqual({ rejected: 'V použití' });
  });

  it('smazání s „Vrátit“, odmítnutí bez oznámení', () => {
    const removed = { account, corrections: [], snapshots: [], fees: [], exceptions: [], usableOverride: undefined };
    const deleted = feedback.deleteAccountFeedback({ removed });
    expect(deleted.toast?.text).toBe('Účet „Běžný“ byl smazán.');
    expect(undoToast(deleted)).toBe('Účet „Běžný“ byl obnoven.');
    expect(deleted.undo!.command(createEmptyAppData(), ctx).data.accounts.map(a => a.id)).toEqual(['chk']);
    expect(feedback.deleteAccountFeedback({ removed: null })).toEqual({});
    expect(feedback.deleteAccountFeedback({ error: 'V použití' })).toEqual({ rejected: 'V použití' });
  });

  it('srovnání zůstatku a tržní hodnota', () => {
    expect(feedback.reconcileBalanceFeedback({ kind: 'none' })).toEqual({});
    expect(feedback.reconcileBalanceFeedback({ kind: 'warning', message: 'Pozor' }))
      .toEqual({ toast: { text: 'Pozor', type: 'warning' }, rejected: 'Pozor' });
    expect(feedback.reconcileBalanceFeedback({ kind: 'unchanged' })).toEqual(ok('Zůstatek sedí s bankou, korekce nebyla potřeba.', 'info'));
    expect(feedback.reconcileBalanceFeedback({ kind: 'corrected', diffInHaler: 150000 }).toast?.text)
      .toBe(`Zůstatek srovnán s bankou. Uložena korekce +${(1500).toLocaleString('cs-CZ')} Kč.`);
    expect(feedback.reconcileBalanceFeedback({ kind: 'corrected', diffInHaler: -2000 }).toast?.text)
      .toBe(`Zůstatek srovnán s bankou. Uložena korekce ${(-20).toLocaleString('cs-CZ')} Kč.`);

    expect(feedback.updateMarketValueFeedback({ kind: 'none' })).toEqual({});
    expect(feedback.updateMarketValueFeedback({ kind: 'warning', message: 'Pozor' }))
      .toEqual({ toast: { text: 'Pozor', type: 'warning' }, rejected: 'Pozor' });
    expect(feedback.updateMarketValueFeedback({ kind: 'saved', accountType: 'pension' })).toEqual(ok('Tržní hodnota penzijního účtu byla aktualizována.'));
    expect(feedback.updateMarketValueFeedback({ kind: 'saved', accountType: 'investment' })).toEqual(ok('Tržní hodnota investičního účtu byla aktualizována.'));
    expect(feedback.editMarketValueFeedback(null, { edit: { date: '2026-09-01', marketValueInHaler: 1 } }))
      .toEqual(ok('Tržní hodnota z 1. 9. 2026 byla upravena.'));
  });

  it('smazání ocenění, poplatku a korekce s „Vrátit“', () => {
    const mv = feedback.deleteMarketValueFeedback({ deleted: snapshot });
    expect(mv.toast?.text).toBe('Tržní hodnota z 1. 9. 2026 byla smazána.');
    expect(undoToast(mv)).toBe('Tržní hodnota byla obnovena.');
    expect(feedback.deleteMarketValueFeedback({})).toEqual(ok('Tržní hodnota byla smazána.'));

    const deletedFee = feedback.deleteInvestmentFeeFeedback({ target: fee, deleted: [fee] });
    expect(deletedFee.toast?.text).toBe(`Poplatek ${formatCurrency(12345)} byl smazán.`);
    expect(undoToast(deletedFee)).toBe('Poplatek byl obnoven.');
    expect(deletedFee.undo!.command(createEmptyAppData(), ctx).data.investmentFees.map(f => f.id)).toEqual(['fee']);
    expect(feedback.deleteInvestmentFeeFeedback({ deleted: [] })).toEqual(ok('Poplatek byl smazán.'));

    const corr = feedback.deleteCorrectionFeedback({ deleted: correction });
    expect(corr.toast?.text).toBe('Korekce zůstatku byla smazána.');
    expect(undoToast(corr)).toBe('Korekce zůstatku byla obnovena.');
    expect(corr.undo!.command(createEmptyAppData(), ctx).data.corrections.map(c => c.id)).toEqual(['corr']);
    expect(feedback.deleteCorrectionFeedback({})).toEqual({ toast: { text: 'Korekce zůstatku byla smazána.', type: 'success' }, undo: undefined });
  });

  it('poplatek a poznámka ke korekci', () => {
    expect(feedback.saveInvestmentFeeFeedback({ fee })).toEqual(ok('Poplatek byl uložen.'));
    expect(feedback.saveInvestmentFeeFeedback({ error: 'Neplatná' })).toEqual({ toast: { text: 'Neplatná', type: 'warning' }, rejected: 'Neplatná' });
    expect(feedback.updateCorrectionNoteFeedback()).toEqual(ok('Poznámka ke korekci byla uložena.'));
  });
});

describe('kategorie', () => {
  it('vytvoření, úprava, přesun a obnova', () => {
    expect(feedback.addCategoryFeedback({ category })).toEqual(ok('Kategorie „Auto“ byla vytvořena.'));
    expect(feedback.updateCategoryFeedback(null, { category })).toEqual(ok('Kategorie „Auto“ byla upravena.'));
    expect(feedback.moveSubcategoryFeedback({ subName: 'Palivo', parentName: 'Auto' }))
      .toEqual(ok('Podkategorie „Palivo“ byla přesunuta do kategorie „Auto“.'));
    expect(feedback.moveSubcategoryFeedback({})).toEqual(ok('Podkategorie byla přesunuta do jiné kategorie.'));
    expect(feedback.restoreCategoryFeedback({ name: 'Auto' })).toEqual(ok('Kategorie „Auto“ byla obnovena z archivu.'));
    expect(feedback.restoreCategoryFeedback({})).toEqual(ok('Kategorie byla obnovena z archivu.'));
  });

  it('archivace vždy s „Vrátit“', () => {
    const archived = feedback.archiveCategoryFeedback({ name: 'Auto', affectedIds: ['cat'] });
    expect(archived.toast?.text).toBe('Kategorie „Auto“ byla archivována.');
    expect(undoToast(archived)).toBe('Archivace kategorie „Auto“ byla vrácena.');
    const unnamed = feedback.archiveCategoryFeedback({ affectedIds: [] });
    expect(unnamed.toast?.text).toBe('Kategorie byla archivována.');
    expect(undoToast(unnamed)).toBe('Archivace kategorie byla vrácena.');
  });

  it('smazání s „Vrátit“ jen když se něco smazalo, odmítnutí bez oznámení', () => {
    const deleted = feedback.deleteCategoryFeedback({ name: 'Auto', removed: [category] });
    expect(deleted.toast?.text).toBe('Kategorie „Auto“ byla smazána.');
    expect(undoToast(deleted)).toBe('Kategorie „Auto“ byla obnovena.');
    expect(deleted.undo!.command({ ...createEmptyAppData(), categories: [] }, ctx).data.categories.map(c => c.id)).toEqual(['cat']);
    expect(feedback.deleteCategoryFeedback({ removed: [] })).toEqual({ toast: { text: 'Kategorie byla smazána.', type: 'success' }, undo: undefined });
    expect(feedback.deleteCategoryFeedback({ error: 'V použití' })).toEqual({ rejected: 'V použití' });
  });
});

describe('nastavení a data', () => {
  it('texty správy dat', () => {
    expect(feedback.updateSettingsFeedback()).toEqual(ok('Nastavení bylo uloženo.'));
    expect(feedback.loadDemoDataFeedback()).toEqual(ok('Ukázková data byla načtena.'));
    expect(feedback.DEMO_MODE_ONLY).toEqual({ text: 'Ukázková data jdou načíst jen v demo režimu.', type: 'warning' });
    expect(feedback.RECOVERY_BACKUP_FAILED).toEqual({
      text: 'Nepodařilo se uložit pojistnou kopii dat, proto se nic nesmazalo. Zkuste to prosím znovu.', type: 'error',
    });
    expect(feedback.clearAllTransactionsFeedback()).toEqual(ok('Všechny položky, pravidelné položky a korekce byly smazány.'));
    expect(feedback.clearAllAccountsFeedback()).toEqual(ok('Všechny účty a data k nim byly smazány.'));
    expect(feedback.clearAllCategoriesFeedback()).toEqual(ok('Všechny kategorie byly smazány. Položky zůstaly bez kategorie.'));
    expect(feedback.resetAllDataFeedback()).toEqual(ok('Všechna data byla smazána. Aplikace začíná od nuly.'));
  });

  it('zálohy a export', () => {
    expect(feedback.importBackupFeedback()).toEqual(ok('Záloha byla sloučena s aktuálními daty.'));
    expect(feedback.importBackupFailed('vadný soubor')).toEqual({ text: 'Zálohu se nepodařilo obnovit: vadný soubor', type: 'error' });
    expect(feedback.restoreFromBackupToast(true)).toEqual({ text: 'Data z Google Disku byla načtena a záloha s nimi sloučena.', type: 'success' });
    expect(feedback.restoreFromBackupToast(false)).toEqual({
      text: 'Zálohu se zatím nepodařilo sloučit. Až se data z Google Disku načtou, sloučte ji v Nastavení.', type: 'error',
    });
    expect(feedback.EXPORT_JSON_DONE).toEqual({ text: 'Záloha byla stažena.', type: 'success' });
    expect(feedback.EXPORT_CSV_DONE).toEqual({ text: 'Položky byly staženy jako CSV.', type: 'success' });
  });
});
