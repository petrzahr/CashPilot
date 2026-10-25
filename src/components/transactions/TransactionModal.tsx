import React, { useState, useEffect, useId, useRef } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { Modal, ModalFooter } from '../common/Modal';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { MovementType, RecurrenceFrequency, Transaction, TransactionStatus } from '../../types/finance';
import { formatCzechDate, getTodayInPrague } from '../../services/periodService';
import {
  TransactionFormData,
  TransactionFormErrors,
  TransactionFormMode,
  TransactionFormState,
  TxField,
  changeCategory,
  changeDate,
  changeType,
  createFormState,
  getAccountActivationErrors,
  getFormOptions,
  isSameForm,
  resetForAnother,
  setRecurring,
  toSaveAction,
  validateForm,
} from '../../services/transactionForm';
import { Hash, Loader2 } from 'lucide-react';
import { RecurrenceScopePicker } from '../shared/RecurrenceScopePicker';
import { FieldError, FormError, fieldStateClass, fieldErrorProps, focusFirstInvalid } from '../common/FieldError';

interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  transactionToEdit?: Transaction | null;
  initialType?: MovementType;
  initialDate?: string;
  /** Nová položka předvyplněná podle existující (duplikace); datum a pořadí jako u nové položky. */
  transactionToDuplicate?: Transaction | null;
}

export const TransactionModal: React.FC<TransactionModalProps> = ({
  isOpen,
  onClose,
  transactionToEdit,
  initialType = 'expense',
  initialDate,
  transactionToDuplicate,
}) => {
  const fieldId = useId();
  const {
    accounts,
    categories,
    transactions,
    recurringRules,
    recurringExceptions,
    settings,
    selectedPeriod,
    addTransaction,
    updateTransaction,
    addRecurringRule,
    updateRecurringRule,
  } = useFinance();

  const formData: TransactionFormData = {
    transactions, recurringRules, recurringExceptions, accounts, categories, settings, today: getTodayInPrague(),
  };
  const mode: TransactionFormMode = transactionToEdit
    ? { kind: 'edit', transaction: transactionToEdit, periodKey: selectedPeriod.key }
    : transactionToDuplicate
      ? { kind: 'duplicate', source: transactionToDuplicate, initialDate, period: selectedPeriod }
      : { kind: 'new', initialType, initialDate, period: selectedPeriod };

  const [form, setForm] = useState<TransactionFormState>(() => createFormState(mode, formData));
  const update = (patch: Partial<TransactionFormState>) => setForm(prev => ({ ...prev, ...patch }));

  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<TransactionFormErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const clearError = (field: TxField) => setErrors(prev => (prev[field] ? { ...prev, [field]: undefined } : prev));

  const isEditing = mode.kind === 'edit';
  const isLinkedToRecurring = !!transactionToEdit?.recurringRuleId;
  const linkedRule = isLinkedToRecurring
    ? recurringRules.find(r => r.id === transactionToEdit?.recurringRuleId)
    : undefined;

  const options = getFormOptions(form, mode, formData);

  // Rozepsaný formulář: po naplnění se uloží otisk hodnot a zavření omylem (klepnutí mimo,
  // Escape) se při jakékoli změně nejdřív zeptá.
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false);
  const formSnapshotRef = useRef(form);
  const handleDismissAttempt = () => {
    if (!isSameForm(form, formSnapshotRef.current)) setIsDiscardConfirmOpen(true);
    else onClose();
  };
  const resetForm = (next: TransactionFormState) => {
    setForm(next);
    formSnapshotRef.current = next;
  };

  useEffect(() => {
    setErrors({});
    setSaveError(null);
    setIsDiscardConfirmOpen(false);
    resetForm(createFormState(mode, formData));
    // Formulář se má znovu naplnit jen při otevření modálu nebo přepnutí na jinou položku -
    // ne pokaždé, když se (i referenčně) změní transactions/accounts kdekoli jinde v appce
    // (např. periodická kontrola splatných položek na pozadí), jinak by to za běhu smazalo
    // rozepsaný formulář uživateli pod rukama.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionToEdit?.id, transactionToDuplicate?.id, isOpen, initialType, initialDate, selectedPeriod.startDate, selectedPeriod.endDate]);

  // Plánovaná položka s dnešním či starším datem se sama uskuteční, proto ji tak nejde nastavit
  const isPastOrToday = !!form.date && form.date <= formData.today;

  // Rychlý zápis: nová položka začíná rovnou v poli Částka (na telefonu se otevře klávesnice)
  const addAnotherRef = useRef(false);
  const focusAmountField = () => {
    requestAnimationFrame(() => document.getElementById(`${fieldId}-2`)?.focus());
  };
  useEffect(() => {
    if (isOpen && !transactionToEdit) focusAmountField();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, transactionToEdit?.id]);

  const { source: sourceAccError, target: targetAccError } = getAccountActivationErrors(form, accounts);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Které tlačítko formulář odeslalo; příznak se hned shodí, aby nepřežil neúspěšnou validaci
    const addAnother = addAnotherRef.current;
    addAnotherRef.current = false;
    if (isSaving) return;

    const nextErrors = validateForm(form, mode, accounts);
    setErrors(nextErrors);
    setSaveError(null);
    if (Object.values(nextErrors).some(Boolean)) {
      focusFirstInvalid(nextErrors, [
        ['amount', `${fieldId}-2`],
        ['title', `${fieldId}-1`],
        ['source', `${fieldId}-6`],
        ['target', `${fieldId}-7`],
        ['endDate', `${fieldId}-12`],
      ]);
      return;
    }

    setIsSaving(true);
    try {
      const action = toSaveAction(form, mode);
      const result =
        action.kind === 'addTransaction' ? addTransaction(action.transaction)
        : action.kind === 'updateTransaction' ? updateTransaction(action.transaction)
        : action.kind === 'addRecurringRule'
          ? addRecurringRule(action.rule, action.initialSequence, action.initialStatus, action.existingTransactionId)
          : updateRecurringRule(action.ruleId, action.mode, action.periodKey, action.overrideData, action.originalTransactionId, action.placement);
      // Neuložená nebo odmítnutá změna nechá formulář otevřený se zprávou
      if (!result.ok) {
        setSaveError(result.message);
        return;
      }
      if (addAnother && !isEditing && !form.isRecurring) {
        resetForm(resetForAnother(form));
        setErrors({});
        focusAmountField();
      } else {
        onClose();
      }
    } catch (err) {
      console.error(err);
      setSaveError(err instanceof Error && err.message ? err.message : 'Položku se nepodařilo uložit. Zkuste to prosím znovu.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      onDismissAttempt={handleDismissAttempt}
      title={isEditing ? 'Upravit položku' : 'Nová položka'}
      maxWidth="max-w-xl"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* Přepínač typu pohybu */}
        <div role="group" aria-label="Typ položky" className="segmented grid grid-cols-3">
          <button
            type="button"
            onClick={() => setForm(prev => changeType(prev, 'expense', categories))}
            aria-pressed={form.type === 'expense'}
            className={`segment ${form.type === 'expense' ? 'text-red-600' : ''}`}
          >
            Výdaj
          </button>
          <button
            type="button"
            onClick={() => setForm(prev => changeType(prev, 'income', categories))}
            aria-pressed={form.type === 'income'}
            className={`segment ${form.type === 'income' ? 'text-emerald-600' : ''}`}
          >
            Příjem
          </button>
          <button
            type="button"
            onClick={() => setForm(prev => changeType(prev, 'transfer', categories))}
            aria-pressed={form.type === 'transfer'}
            className="segment"
          >
            Převod
          </button>
        </div>

        {/* Režim úpravy pravidelné položky */}
        {isEditing && isLinkedToRecurring && (
          <div className="space-y-2">
            <RecurrenceScopePicker
              legend="Pravidelná položka – co chcete upravit?"
              name="recMode"
              value={form.recurringEditMode}
              onChange={(recurringEditMode) => update({ recurringEditMode })}
              descriptions={{
                occurrence: `Změna platí jen v období ${selectedPeriod.name}.`,
                future: 'Změna platí od tohoto výskytu dál. Minulé výskyty zůstanou beze změny.',
                series: 'Změna platí pro všechny výskyty, minulé i budoucí.',
              }}
            />
            {linkedRule && (
              <p className="text-xs text-slate-500">
                {linkedRule.endDate
                  ? `Opakuje se od ${formatCzechDate(linkedRule.startDate)} do ${formatCzechDate(linkedRule.endDate)}.`
                  : `Opakuje se od ${formatCzechDate(linkedRule.startDate)} bez konce.`}
              </p>
            )}
          </div>
        )}

        {/* Částka a název: částka první, protože ji při rychlém zápisu znáte hned */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${fieldId}-2`} className="block text-xs font-semibold text-slate-500 mb-1">
              Částka *
            </label>
            <div className="relative">
              {/* Textové pole s desetinnou klávesnicí: přijme českou čárku i tečku */}
              <input id={`${fieldId}-2`}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                required
                placeholder="0"
                value={form.amountStr}
                onChange={(e) => { update({ amountStr: e.target.value }); clearError('amount'); }}
                {...fieldErrorProps(`${fieldId}-2`, errors.amount)}
                className={`w-full pl-3.5 pr-10 py-2 text-sm bg-white border rounded-xl focus:outline-hidden ${fieldStateClass(errors.amount, 'border-slate-200 focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500')} font-medium`}
              />
              <span className="absolute right-3.5 inset-y-0 flex items-center text-xs font-semibold text-slate-500 pointer-events-none">
                Kč
              </span>
            </div>
            <FieldError inputId={`${fieldId}-2`} message={errors.amount} />
          </div>

          <div>
            <label htmlFor={`${fieldId}-1`} className="block text-xs font-semibold text-slate-500 mb-1">
              Název položky *
            </label>
            <input id={`${fieldId}-1`}
              type="text"
              required
              placeholder="např. Nákup potravin, Mzda"
              value={form.title}
              onChange={(e) => { update({ title: e.target.value }); clearError('title'); }}
              {...fieldErrorProps(`${fieldId}-1`, errors.title)}
              className={`w-full px-3.5 py-2 text-sm bg-white border rounded-xl focus:outline-hidden ${fieldStateClass(errors.title, 'border-slate-200 focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500')}`}
            />
            <FieldError inputId={`${fieldId}-1`} message={errors.title} />
          </div>
        </div>

        {/* Datum a Stav; pořadí v rámci dne se doplní samo a je schované níže */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${fieldId}-3`} className="block text-xs font-semibold text-slate-500 mb-1">
              Datum *
            </label>
            <input id={`${fieldId}-3`}
              type="date"
              required
              value={form.date}
              onChange={(e) => { const date = e.target.value; setForm(prev => changeDate(prev, date, mode, formData)); }}
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
            />
          </div>

          <div>
            <label htmlFor={`${fieldId}-5`} className="block text-xs font-semibold text-slate-500 mb-1">
              Stav
            </label>
            <select id={`${fieldId}-5`}
              value={form.status}
              onChange={(e) => update({ status: e.target.value as TransactionStatus })}
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
            >
              <option value="planned" disabled={isPastOrToday && form.status !== 'planned'}>Plánovaná</option>
              <option value="executed">Uskutečněná</option>
              <option value="cancelled">Zrušená</option>
            </select>
            {isPastOrToday && (
              <p className="text-xs text-slate-500 mt-1">Položky s dnešním nebo starším datem se uskuteční automaticky.</p>
            )}
          </div>
        </div>

        {/* Účty */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${fieldId}-6`} className="block text-xs font-semibold text-slate-500 mb-1">
              {form.type === 'transfer' ? 'Z účtu *' : 'Účet *'}
            </label>
            <select id={`${fieldId}-6`}
              required
              value={form.sourceAccountId}
              onChange={(e) => { update({ sourceAccountId: e.target.value }); clearError('source'); }}
              {...fieldErrorProps(`${fieldId}-6`, errors.source || sourceAccError)}
              className={`w-full px-3.5 py-2 text-sm bg-white border rounded-xl focus:outline-hidden ${fieldStateClass(errors.source || sourceAccError, 'border-slate-200 focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500')}`}
            >
              <option value="">Vyberte účet</option>
              {options.accounts.map((acc) => {
                const isInactive = !!(acc.initialBalanceDate && form.date && form.date < acc.initialBalanceDate);
                return (
                  <option key={acc.id} value={acc.id} disabled={isInactive}>
                    {acc.name} ({acc.institution || (acc.isUsableCash ? 'Použitelné' : 'Majetek')}){isInactive ? ` — aktivní až od ${formatCzechDate(acc.initialBalanceDate!)}` : ''}
                  </option>
                );
              })}
            </select>
            <FieldError inputId={`${fieldId}-6`} message={errors.source || sourceAccError} />
          </div>

          {form.type === 'transfer' ? (
            <div>
              <label htmlFor={`${fieldId}-7`} className="block text-xs font-semibold text-slate-500 mb-1">
                Na účet *
              </label>
              <select id={`${fieldId}-7`}
                required
                value={form.targetAccountId}
                onChange={(e) => { update({ targetAccountId: e.target.value }); clearError('target'); }}
                {...fieldErrorProps(`${fieldId}-7`, errors.target || targetAccError)}
                className={`w-full px-3.5 py-2 text-sm bg-white border rounded-xl focus:outline-hidden ${fieldStateClass(errors.target || targetAccError, 'border-slate-200 focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500')}`}
              >
                <option value="">Vyberte účet</option>
                {options.accounts
                  .filter((a) => a.id !== form.sourceAccountId)
                  .map((acc) => {
                    const isInactive = !!(acc.initialBalanceDate && form.date && form.date < acc.initialBalanceDate);
                    return (
                      <option key={acc.id} value={acc.id} disabled={isInactive}>
                        {acc.name}{isInactive ? ` — aktivní až od ${formatCzechDate(acc.initialBalanceDate!)}` : ''}
                      </option>
                    );
                  })}
              </select>
              <FieldError inputId={`${fieldId}-7`} message={errors.target || targetAccError} />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-2">
              <div>
                <label htmlFor={`${fieldId}-8`} className="block text-xs font-semibold text-slate-500 mb-1">
                  Kategorie
                </label>
                <select id={`${fieldId}-8`}
                  value={form.categoryId}
                  onChange={(e) => { const categoryId = e.target.value; setForm(prev => changeCategory(prev, categoryId)); }}
                  className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
                >
                  <option value="">Bez kategorie</option>
                  {options.categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor={`${fieldId}-9`} className="block text-xs font-semibold text-slate-500 mb-1">
                  Podkategorie
                </label>
                <select id={`${fieldId}-9`}
                  value={form.subcategoryId}
                  onChange={(e) => update({ subcategoryId: e.target.value })}
                  disabled={!form.categoryId || options.subcategories.length === 0}
                  className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 disabled:bg-slate-50 disabled:text-slate-400"
                >
                  <option value="">Bez podkategorie</option>
                  {options.subcategories.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Pořadí v rámci dne: doplní se samo (na konec dne), ruční změna je jen pro výjimky */}
        <details className="group rounded-xl border border-slate-200">
          <summary className="flex items-center justify-between gap-3 px-3.5 min-h-10 max-md:min-h-11 cursor-pointer list-none [&::-webkit-details-marker]:hidden rounded-xl hover:bg-slate-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-sky-500/40">
            <span className="flex items-center gap-1.5 text-xs text-slate-500 min-w-0">
              <Hash className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">
                Pořadí v rámci dne: <strong className="text-slate-900">{form.sequenceStr || '1'}.</strong>
              </span>
            </span>
            <span className="text-xs font-semibold text-sky-700 shrink-0 group-open:hidden">Změnit</span>
            <span className="text-xs font-semibold text-sky-700 shrink-0 hidden group-open:inline">Skrýt</span>
          </summary>
          <div className="px-3.5 pb-3.5 pt-1 space-y-1.5">
            <label htmlFor={`${fieldId}-4`} className="block text-xs font-semibold text-slate-500">
              Pořadí v rámci dne
            </label>
            <input id={`${fieldId}-4`}
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={form.sequenceStr}
              onChange={(e) => update({ sequenceStr: e.target.value })}
              className="w-full sm:w-32 px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 font-medium"
              aria-describedby={`${fieldId}-4-hint`}
            />
            <p id={`${fieldId}-4-hint`} className="text-xs text-slate-500">
              1 = první položka dne. Pořadí určuje průběžný zůstatek po každé položce; v rozpočtu ho změníte i přetažením.
            </p>
          </div>
        </details>

        {/* Volba opakování pro položky bez pravidelné série */}
        {!isLinkedToRecurring && (
          <div className="pt-2 border-t border-slate-100">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.isRecurring}
                onChange={(e) => { const checked = e.target.checked; setForm(prev => setRecurring(prev, checked)); }}
                className="w-4 h-4 text-sky-600 rounded-sm border-slate-300 focus:ring-sky-500"
              />
              <span className="text-sm font-medium text-slate-900">
                Opakovat v dalších obdobích
              </span>
            </label>

            {form.isRecurring && (
              <div className="mt-3 p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className={`grid ${form.frequency !== 'custom' ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
                  <div>
                    <label htmlFor={`${fieldId}-10`} className="block text-xs font-semibold text-slate-500 mb-1">
                      Jak často
                    </label>
                    <select id={`${fieldId}-10`}
                      value={form.frequency}
                      onChange={(e) => update({ frequency: e.target.value as RecurrenceFrequency })}
                      className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
                    >
                      <option value="monthly">Každý měsíc</option>
                      <option value="bi_monthly">Každé 2 měsíce</option>
                      <option value="quarterly">Čtvrtletně (3 měsíce)</option>
                      <option value="semi_annually">Pololetně (6 měsíců)</option>
                      <option value="annually">Ročně (12 měsíců)</option>
                    </select>
                  </div>
                  {form.frequency !== 'custom' && (
                    <div>
                      <label htmlFor={`${fieldId}-11`} className="block text-xs font-semibold text-slate-500 mb-1">
                        Den v měsíci
                      </label>
                      <input id={`${fieldId}-11`}
                        type="number"
                        min="1"
                        max="31"
                        value={form.dayOfMonth || ''}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          update({ dayOfMonth: isNaN(val) ? 0 : val });
                        }}
                        className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
                      />
                    </div>
                  )}
                </div>
                <div>
                  <label htmlFor={`${fieldId}-12`} className="block text-xs font-semibold text-slate-500 mb-1">
                    Opakovat do (nepovinné)
                  </label>
                  <input id={`${fieldId}-12`}
                    type="date"
                    value={form.recurringEndDate}
                    min={form.date}
                    onChange={(e) => { update({ recurringEndDate: e.target.value }); clearError('endDate'); }}
                    {...fieldErrorProps(`${fieldId}-12`, errors.endDate)}
                    className={`w-full px-3.5 py-2 text-sm bg-white border rounded-xl focus:outline-hidden ${fieldStateClass(errors.endDate, 'border-slate-200 focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500')}`}
                  />
                  <FieldError inputId={`${fieldId}-12`} message={errors.endDate} />
                  <p className="text-xs text-slate-500 mt-1">
                    Bez data se položka opakuje bez konce.
                  </p>
                </div>
                <p className="text-xs text-slate-500">
                  Budoucí výskyty uvidíte jako plánované položky v dalších obdobích.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Poznámka */}
        <div>
          <label htmlFor={`${fieldId}-13`} className="block text-xs font-semibold text-slate-500 mb-1">
            Poznámka (nepovinné)
          </label>
          <input id={`${fieldId}-13`}
            type="text"
            placeholder="např. Faktura č. 2026-04, účel platby…"
            value={form.note}
            onChange={(e) => update({ note: e.target.value })}
            className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
          />
        </div>

        <FormError message={saveError} />

        {/* Akční tlačítka */}
        <ModalFooter>
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary"
          >
            Zrušit
          </button>
          {!isEditing && !form.isRecurring && (
            <button
              type="submit"
              disabled={isSaving}
              onClick={() => { addAnotherRef.current = true; }}
              className="btn-secondary"
            >
              Uložit a další
            </button>
          )}
          <button
            type="submit"
            disabled={isSaving}
            className="btn-primary"
          >
            {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{isEditing ? 'Uložit změny' : 'Vytvořit položku'}</span>
          </button>
        </ModalFooter>
      </form>
    </Modal>

    <ConfirmationModal
      isOpen={isOpen && isDiscardConfirmOpen}
      onClose={() => setIsDiscardConfirmOpen(false)}
      onConfirm={onClose}
      title={isEditing ? 'Zahodit změny položky?' : 'Zahodit rozepsanou položku?'}
      message={isEditing ? 'Neuložené změny se ztratí.' : 'Vyplněné údaje se ztratí.'}
      confirmText="Zahodit"
      cancelText="Pokračovat v úpravě"
      isDestructive={true}
    />
    </>
  );
};
