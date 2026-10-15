import React, { useState, useEffect, useId } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { Modal, ModalFooter } from '../common/Modal';
import { MovementType, RecurrenceFrequency, Transaction, TransactionStatus } from '../../types/finance';
import { halerToInputValue, parseInputToHaler } from '../../services/currencyService';
import { getNextSequenceForDate } from '../../services/sequenceService';
import { getEffectiveTransactionsForPeriod } from '../../services/financialEngine';
import { getDefaultDateForPeriod, getPeriodForDate, formatCzechDate } from '../../services/periodService';
import { getStatusForDate } from '../../services/statusService';
import { czechStringCompare } from '../../services/categoryService';
import { Repeat, Hash, Loader2 } from 'lucide-react';
import { FieldError, FieldErrors, FormError, fieldStateClass, fieldErrorProps, focusFirstInvalid } from '../common/FieldError';

type TxField = 'title' | 'amount' | 'source' | 'target' | 'endDate';

interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  transactionToEdit?: Transaction | null;
  initialType?: MovementType;
  initialDate?: string;
}

export const TransactionModal: React.FC<TransactionModalProps> = ({
  isOpen,
  onClose,
  transactionToEdit,
  initialType = 'expense',
  initialDate,
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
    reorderRecurringItem,
  } = useFinance();

  // Další volné pořadí v daném dni musí počítat i s ještě nezhmotněnými (virtuálními)
  // výskyty opakujících se položek, jinak by nová položka v budoucím dni, kde zatím
  // existuje jen virtuální výskyt, dostala pořadí 1 místo posledního místa v tom dni.
  const getEffectiveNextSequence = (targetDate: string, excludeId?: string): number => {
    const baseTxs = excludeId ? transactions.filter(t => t.id !== excludeId) : transactions;
    const period = getPeriodForDate(targetDate, settings.budgetStartDay);
    const effectiveTxs = getEffectiveTransactionsForPeriod(
      period,
      baseTxs,
      recurringRules,
      recurringExceptions,
      settings.budgetStartDay,
      undefined,
      accounts
    );
    return getNextSequenceForDate(targetDate, effectiveTxs);
  };

  const [title, setTitle] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [date, setDate] = useState('');
  const [sequenceStr, setSequenceStr] = useState('1');
  const [type, setType] = useState<MovementType>(initialType);
  const [sourceAccountId, setSourceAccountId] = useState('');
  const [targetAccountId, setTargetAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [status, setStatus] = useState<TransactionStatus>('planned');
  const [note, setNote] = useState('');

  // Pravidelnost
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState<RecurrenceFrequency>('monthly');
  const [dayOfMonth, setDayOfMonth] = useState<number>(1);
  const [recurringEndDate, setRecurringEndDate] = useState('');

  // Dialog úpravy pravidelné položky
  const [recurringEditMode, setRecurringEditMode] = useState<'occurrence' | 'future' | 'series'>('occurrence');
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<FieldErrors<TxField>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const clearError = (field: TxField) => setErrors(prev => (prev[field] ? { ...prev, [field]: undefined } : prev));

  const isEditing = !!transactionToEdit;
  const isLinkedToRecurring = !!transactionToEdit?.recurringRuleId;
  const linkedRule = isLinkedToRecurring
    ? recurringRules.find(r => r.id === transactionToEdit?.recurringRuleId)
    : undefined;

  const activeAccounts = accounts
    .filter(a => isEditing ? (a.status === 'active' || a.id === sourceAccountId || a.id === targetAccountId) : a.status === 'active')
    .sort((a, b) => czechStringCompare(a.name, b.name));

  const relevantCategories = categories
    .filter(c => 
      !c.parentId && 
      (type === 'transfer' ? false : c.type === type) &&
      (isEditing ? (c.status === 'active' || c.id === categoryId) : c.status === 'active')
    )
    .sort((a, b) => czechStringCompare(a.name, b.name));

  const subcategories = categories
    .filter(c => 
      c.parentId === categoryId && 
      (isEditing ? (c.status === 'active' || c.id === subcategoryId) : c.status === 'active')
    )
    .sort((a, b) => czechStringCompare(a.name, b.name));

  useEffect(() => {
    setErrors({});
    setSaveError(null);
    if (transactionToEdit) {
      setTitle(transactionToEdit.title);
      const haler = transactionToEdit.status === 'executed' && transactionToEdit.actualAmountInHaler !== undefined
        ? transactionToEdit.actualAmountInHaler
        : transactionToEdit.amountInHaler;
      setAmountStr(halerToInputValue(haler));
      setDate(transactionToEdit.date);
      setSequenceStr(transactionToEdit.sequence?.toString() || '1');
      setType(transactionToEdit.type);
      setSourceAccountId(transactionToEdit.sourceAccountId);
      setTargetAccountId(transactionToEdit.targetAccountId || '');
      setCategoryId(transactionToEdit.categoryId || '');
      setSubcategoryId(transactionToEdit.subcategoryId || '');
      setStatus(transactionToEdit.status);
      setNote(transactionToEdit.note || '');
      setIsRecurring(false);
      setFrequency('monthly');
      setDayOfMonth(parseInt(transactionToEdit.date.split('-')[2], 10) || 1);
      setRecurringEndDate('');
    } else {
      const defaultDate = initialDate || getDefaultDateForPeriod(selectedPeriod);
      const defaultDay = parseInt(defaultDate.split('-')[2], 10) || 1;
      setTitle('');
      setAmountStr('');
      setDate(defaultDate);
      const nextSeq = getEffectiveNextSequence(defaultDate);
      setSequenceStr(nextSeq.toString());
      setType(initialType);

      // Default account: preselect only if an active account is marked as default and valid for defaultDate
      const defaultAcc = accounts.find(a => a.status === 'active' && a.isDefault);
      const isDefaultValid = defaultAcc && (!defaultAcc.initialBalanceDate || defaultAcc.initialBalanceDate <= defaultDate);
      setSourceAccountId(isDefaultValid ? defaultAcc.id : '');
      setTargetAccountId('');

      // No category or subcategory preselected by default
      setCategoryId('');
      setSubcategoryId('');

      setStatus(getStatusForDate(defaultDate));
      setNote('');
      setIsRecurring(false);
      setFrequency('monthly');
      setDayOfMonth(defaultDay);
      setRecurringEndDate('');
    }
    // Formulář se má znovu naplnit jen při otevření modálu nebo přepnutí na jinou položku -
    // ne pokaždé, když se (i referenčně) změní transactions/accounts kdekoli jinde v appce
    // (např. periodická kontrola splatných položek na pozadí), jinak by to za běhu smazalo
    // rozepsaný formulář uživateli pod rukama.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionToEdit?.id, isOpen, initialType, initialDate, selectedPeriod.startDate, selectedPeriod.endDate]);

  // Při změně data v editačním formuláři ihned přepočti a předvyplň pořadí pro nově zvolený den
  const handleDateChange = (newDate: string) => {
    setDate(newDate);
    if (!isLinkedToRecurring) {
      const parsedDay = parseInt(newDate.split('-')[2], 10);
      if (!isNaN(parsedDay) && parsedDay >= 1 && parsedDay <= 31) {
        setDayOfMonth(parsedDay);
      }
    }
    if (!isEditing) {
      const nextSeq = getEffectiveNextSequence(newDate);
      setSequenceStr(nextSeq.toString());
      setStatus(getStatusForDate(newDate));
      // Účet se u nového data nemaže - pokud je pro dané datum neplatný, na to
      // upozorní sourceAccError/targetAccError a odešle se odeslání formuláře.
    } else {
      if (newDate === transactionToEdit?.date) {
        setSequenceStr((transactionToEdit.sequence || 1).toString());
      } else {
        const nextSeq = getEffectiveNextSequence(newDate, transactionToEdit?.id);
        setSequenceStr(nextSeq.toString());
      }
    }
  };

  const handleTypeChange = (newType: MovementType) => {
    setType(newType);
    if (newType === 'transfer') {
      setCategoryId('');
      setSubcategoryId('');
    } else {
      const selectedCat = categories.find(c => c.id === categoryId);
      if (!selectedCat || selectedCat.type !== newType || selectedCat.status === 'archived') {
        setCategoryId('');
        setSubcategoryId('');
      }
    }
  };

  const handleCategoryChange = (newCatId: string) => {
    setCategoryId(newCatId);
    setSubcategoryId('');
  };

  const selectedSourceAcc = accounts.find(a => a.id === sourceAccountId);
  const sourceAccError = selectedSourceAcc?.initialBalanceDate && date < selectedSourceAcc.initialBalanceDate
    ? `Tento účet je aktivní až od ${formatCzechDate(selectedSourceAcc.initialBalanceDate)}. Zvolte stejné nebo pozdější datum.`
    : null;

  const selectedTargetAcc = type === 'transfer' ? accounts.find(a => a.id === targetAccountId) : undefined;
  const targetAccError = selectedTargetAcc?.initialBalanceDate && date < selectedTargetAcc.initialBalanceDate
    ? `Tento účet je aktivní až od ${formatCzechDate(selectedTargetAcc.initialBalanceDate)}. Zvolte stejné nebo pozdější datum.`
    : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    const amountInHaler = parseInputToHaler(amountStr);
    const sequenceNum = Math.max(1, parseInt(sequenceStr, 10) || 1);

    const nextErrors: FieldErrors<TxField> = {};
    if (!title.trim()) nextErrors.title = 'Zadejte prosím název položky.';
    if (amountInHaler <= 0) nextErrors.amount = 'Zadejte částku větší než 0.';
    if (!sourceAccountId) nextErrors.source = 'Vyberte prosím účet.';
    else if (sourceAccError) nextErrors.source = sourceAccError;
    if (type === 'transfer') {
      if (!targetAccountId) nextErrors.target = 'Pro převod vyberte cílový účet.';
      else if (sourceAccountId === targetAccountId) nextErrors.target = 'Vyberte jiný účet, než ze kterého peníze odcházejí.';
      else if (targetAccError) nextErrors.target = targetAccError;
    }
    if (isRecurring && !isLinkedToRecurring && recurringEndDate && recurringEndDate < date) {
      nextErrors.endDate = 'Konec opakování musí být stejný den jako datum položky, nebo pozdější.';
    }
    setErrors(nextErrors);
    setSaveError(null);
    if (Object.values(nextErrors).some(Boolean)) {
      focusFirstInvalid(nextErrors, [
        ['title', `${fieldId}-1`],
        ['amount', `${fieldId}-2`],
        ['source', `${fieldId}-6`],
        ['target', `${fieldId}-7`],
        ['endDate', `${fieldId}-12`],
      ]);
      return;
    }

    setIsSaving(true);
    try {
      if (isRecurring && !isLinkedToRecurring) {
        const dateDay = parseInt(date.split('-')[2], 10) || 1;
        const chosenDay = (dayOfMonth >= 1 && dayOfMonth <= 31) ? dayOfMonth : dateDay;
        addRecurringRule({
          title,
          amountInHaler,
          type,
          frequency,
          dayOfMonth: chosenDay,
          endDate: recurringEndDate || null,
          startDate: date,
          sourceAccountId,
          targetAccountId: type === 'transfer' ? targetAccountId : undefined,
          categoryId: type !== 'transfer' && categoryId ? categoryId : null,
          subcategoryId: type !== 'transfer' && subcategoryId ? subcategoryId : null,
          note,
          isActive: true,
        }, sequenceNum, status, transactionToEdit?.id);
      } else if (isEditing && transactionToEdit) {
        if (isLinkedToRecurring && transactionToEdit.recurringRuleId) {
          if (recurringEditMode === 'occurrence') {
            if (transactionToEdit.id.startsWith('virtual_')) {
              addTransaction({
                title,
                amountInHaler,
                plannedAmountInHaler: transactionToEdit.amountInHaler,
                actualAmountInHaler: status === 'executed' ? amountInHaler : undefined,
                date,
                sequence: sequenceNum,
                type,
                sourceAccountId,
                targetAccountId: type === 'transfer' ? targetAccountId : undefined,
                categoryId: type !== 'transfer' && categoryId ? categoryId : null,
                subcategoryId: type !== 'transfer' && subcategoryId ? subcategoryId : null,
                status,
                note,
                recurringRuleId: transactionToEdit.recurringRuleId
              });
            } else {
              updateTransaction({
                ...transactionToEdit,
                title,
                amountInHaler,
                actualAmountInHaler: status === 'executed' ? amountInHaler : (status === 'planned' ? undefined : transactionToEdit.actualAmountInHaler),
                date,
                sequence: sequenceNum,
                type,
                sourceAccountId,
                targetAccountId: type === 'transfer' ? targetAccountId : undefined,
                categoryId: type !== 'transfer' && categoryId ? categoryId : null,
                subcategoryId: type !== 'transfer' && subcategoryId ? subcategoryId : null,
                status,
                note,
              });
            }
          } else {
            const futureRuleId = updateRecurringRule(
              transactionToEdit.recurringRuleId,
              recurringEditMode,
              selectedPeriod.key,
              {
                title,
                amountInHaler,
                // U celé série posíláme datum jen při skutečné změně - jinak by se
                // přesunutý jednotlivý výskyt propsal jako nový den celé série.
                date: recurringEditMode === 'series' && date === transactionToEdit.date ? undefined : date,
                sourceAccountId,
                targetAccountId: type === 'transfer' ? targetAccountId : undefined,
                categoryId: type !== 'transfer' && categoryId ? categoryId : null,
                subcategoryId: type !== 'transfer' && subcategoryId ? subcategoryId : null,
                note
              },
              transactionToEdit.id
            );

            // Pořadí se nastaví stejně jako přetažením: pozice v tomto dni a pořadí mezi
            // opakovanými platbami pro ostatní období. U „tento a budoucí“ už pravidlo
            // bylo rozštěpené, takže se pořadí nastaví nové větvi (ta minulost nemá).
            const seqChanged = sequenceNum !== (transactionToEdit.sequence || 1);
            const targetRuleId = recurringEditMode === 'future' ? futureRuleId : transactionToEdit.recurringRuleId;
            if (targetRuleId && (seqChanged || date !== transactionToEdit.date)) {
              const ruleId = transactionToEdit.recurringRuleId;
              const targetPeriod = getPeriodForDate(date, settings.budgetStartDay);
              const movedId = transactionToEdit.id.startsWith('virtual_')
                ? `virtual_${targetRuleId}_${targetPeriod.key}`
                : transactionToEdit.id;
              const orderedIds = getEffectiveTransactionsForPeriod(
                targetPeriod,
                transactions,
                recurringRules,
                recurringExceptions,
                settings.budgetStartDay,
                undefined,
                accounts
              )
                .filter(t => t.date === date && t.recurringRuleId !== ruleId && t.id !== transactionToEdit.id)
                .map(t => t.id);
              orderedIds.splice(Math.min(sequenceNum - 1, orderedIds.length), 0, movedId);
              reorderRecurringItem(targetRuleId, recurringEditMode, date, targetPeriod.key, orderedIds, movedId);
            }
          }
        } else {
          updateTransaction({
            ...transactionToEdit,
            title,
            amountInHaler,
            actualAmountInHaler: status === 'executed' ? amountInHaler : (status === 'planned' ? undefined : transactionToEdit.actualAmountInHaler),
            date,
            sequence: sequenceNum,
            type,
            sourceAccountId,
            targetAccountId: type === 'transfer' ? targetAccountId : undefined,
            categoryId: type !== 'transfer' && categoryId ? categoryId : null,
            subcategoryId: type !== 'transfer' && subcategoryId ? subcategoryId : null,
            status,
            note,
          });
        }
      } else {
        addTransaction({
            title,
            amountInHaler,
            plannedAmountInHaler: amountInHaler,
            actualAmountInHaler: status === 'executed' ? amountInHaler : undefined,
            date,
            sequence: sequenceNum,
            type,
            sourceAccountId,
            targetAccountId: type === 'transfer' ? targetAccountId : undefined,
            categoryId: type !== 'transfer' && categoryId ? categoryId : null,
            subcategoryId: type !== 'transfer' && subcategoryId ? subcategoryId : null,
            status,
            note,
        });
      }
      onClose();
    } catch (err) {
      console.error(err);
      setSaveError(err instanceof Error && err.message ? err.message : 'Položku se nepodařilo uložit. Zkuste to prosím znovu.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Upravit položku' : 'Nová položka'}
      maxWidth="max-w-xl"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* Přepínač typu pohybu */}
        <div className="grid grid-cols-3 gap-2 p-1 bg-slate-100 rounded-xl">
          <button
            type="button"
            onClick={() => handleTypeChange('expense')}
            className={`py-2 text-sm font-medium rounded-lg transition-all ${
              type === 'expense'
                ? 'bg-white text-red-600 shadow-sm font-semibold'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            Výdaj
          </button>
          <button
            type="button"
            onClick={() => handleTypeChange('income')}
            className={`py-2 text-sm font-medium rounded-lg transition-all ${
              type === 'income'
                ? 'bg-white text-emerald-600 shadow-sm font-semibold'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            Příjem
          </button>
          <button
            type="button"
            onClick={() => handleTypeChange('transfer')}
            className={`py-2 text-sm font-medium rounded-lg transition-all ${
              type === 'transfer'
                ? 'bg-white text-sky-600 shadow-sm font-semibold'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            Převod
          </button>
        </div>

        {/* Režim úpravy pravidelné položky */}
        {isEditing && isLinkedToRecurring && (
          <div className="p-4 bg-sky-50 border border-sky-100 rounded-xl space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-sky-800">
              <Repeat className="w-4 h-4" />
              <span>Pravidelná položka – co chcete upravit?</span>
            </div>
            {linkedRule && (
              <p className="text-xs text-slate-500">
                {linkedRule.endDate
                  ? `Opakuje se od ${formatCzechDate(linkedRule.startDate)} do ${formatCzechDate(linkedRule.endDate)}.`
                  : `Opakuje se od ${formatCzechDate(linkedRule.startDate)} bez konce.`}
              </p>
            )}
            <div className="space-y-1 text-xs text-slate-500">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="recMode"
                  value="occurrence"
                  checked={recurringEditMode === 'occurrence'}
                  onChange={() => setRecurringEditMode('occurrence')}
                  className="text-sky-600 focus:ring-sky-500"
                />
                <span>Jen tento výskyt ({selectedPeriod.name})</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="recMode"
                  value="future"
                  checked={recurringEditMode === 'future'}
                  onChange={() => setRecurringEditMode('future')}
                  className="text-sky-600 focus:ring-sky-500"
                />
                <span>Tento a všechny budoucí výskyty</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="recMode"
                  value="series"
                  checked={recurringEditMode === 'series'}
                  onChange={() => setRecurringEditMode('series')}
                  className="text-sky-600 focus:ring-sky-500"
                />
                <span>Celá série (včetně minulých výskytů)</span>
              </label>
            </div>
          </div>
        )}

        {/* Název a částka */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${fieldId}-1`} className="block text-xs font-semibold text-slate-500 mb-1">
              Název položky *
            </label>
            <input id={`${fieldId}-1`}
              type="text"
              required
              placeholder="např. Nákup potravin, Mzda"
              value={title}
              onChange={(e) => { setTitle(e.target.value); clearError('title'); }}
              {...fieldErrorProps(`${fieldId}-1`, errors.title)}
              className={`w-full px-3.5 py-2 text-sm bg-white border rounded-xl focus:outline-none ${fieldStateClass(errors.title, 'border-slate-200 focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500')}`}
            />
            <FieldError inputId={`${fieldId}-1`} message={errors.title} />
          </div>

          <div>
            <label htmlFor={`${fieldId}-2`} className="block text-xs font-semibold text-slate-500 mb-1">
              Částka *
            </label>
            <div className="relative">
              <input id={`${fieldId}-2`}
                type="number"
                step="any"
                min="0"
                required
                placeholder="0"
                value={amountStr}
                onChange={(e) => { setAmountStr(e.target.value); clearError('amount'); }}
                {...fieldErrorProps(`${fieldId}-2`, errors.amount)}
                className={`w-full px-3.5 py-2 text-sm bg-white border rounded-xl focus:outline-none ${fieldStateClass(errors.amount, 'border-slate-200 focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500')} font-medium`}
              />
              <span className="absolute right-3.5 top-2 text-xs font-semibold text-slate-500 pointer-events-none">
                Kč
              </span>
            </div>
            <FieldError inputId={`${fieldId}-2`} message={errors.amount} />
          </div>
        </div>

        {/* Datum, Pořadí v rámci dne a Stav */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor={`${fieldId}-3`} className="block text-xs font-semibold text-slate-500 mb-1">
              Datum *
            </label>
            <input id={`${fieldId}-3`}
              type="date"
              required
              value={date}
              onChange={(e) => handleDateChange(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
            />
          </div>

          <div>
            <label htmlFor={`${fieldId}-4`} className="block text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1">
              <Hash className="w-3.5 h-3.5 text-sky-600" />
              <span>Pořadí v rámci dne *</span>
            </label>
            <input id={`${fieldId}-4`}
              type="number"
              min="1"
              step="1"
              required
              value={sequenceStr}
              onChange={(e) => setSequenceStr(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 font-bold text-sky-900"
              title="1 = první položka dne. Pořadí určuje průběžný zůstatek po každé položce."
            />
          </div>

          <div>
            <label htmlFor={`${fieldId}-5`} className="block text-xs font-semibold text-slate-500 mb-1">
              Stav
            </label>
            <select id={`${fieldId}-5`}
              value={status}
              onChange={(e) => setStatus(e.target.value as TransactionStatus)}
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
            >
              <option value="planned">Plánovaná</option>
              <option value="executed">Uskutečněná</option>
              <option value="cancelled">Zrušená</option>
            </select>
          </div>
        </div>

        {/* Účty */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${fieldId}-6`} className="block text-xs font-semibold text-slate-500 mb-1">
              {type === 'transfer' ? 'Z účtu *' : 'Účet *'}
            </label>
            <select id={`${fieldId}-6`}
              required
              value={sourceAccountId}
              onChange={(e) => { setSourceAccountId(e.target.value); clearError('source'); }}
              {...fieldErrorProps(`${fieldId}-6`, errors.source || sourceAccError)}
              className={`w-full px-3.5 py-2 text-sm bg-white border rounded-xl focus:outline-none ${fieldStateClass(errors.source || sourceAccError, 'border-slate-200 focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500')}`}
            >
              <option value="">Vyberte účet</option>
              {activeAccounts.map((acc) => {
                const isInactive = !!(acc.initialBalanceDate && date && date < acc.initialBalanceDate);
                return (
                  <option key={acc.id} value={acc.id} disabled={isInactive}>
                    {acc.name} ({acc.institution || (acc.isUsableCash ? 'Použitelné' : 'Majetek')}){isInactive ? ` — aktivní až od ${formatCzechDate(acc.initialBalanceDate!)}` : ''}
                  </option>
                );
              })}
            </select>
            <FieldError inputId={`${fieldId}-6`} message={errors.source || sourceAccError} />
          </div>

          {type === 'transfer' ? (
            <div>
              <label htmlFor={`${fieldId}-7`} className="block text-xs font-semibold text-slate-500 mb-1">
                Na účet *
              </label>
              <select id={`${fieldId}-7`}
                required
                value={targetAccountId}
                onChange={(e) => { setTargetAccountId(e.target.value); clearError('target'); }}
                {...fieldErrorProps(`${fieldId}-7`, errors.target || targetAccError)}
                className={`w-full px-3.5 py-2 text-sm bg-white border rounded-xl focus:outline-none ${fieldStateClass(errors.target || targetAccError, 'border-slate-200 focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500')}`}
              >
                <option value="">Vyberte účet</option>
                {activeAccounts
                  .filter((a) => a.id !== sourceAccountId)
                  .map((acc) => {
                    const isInactive = !!(acc.initialBalanceDate && date && date < acc.initialBalanceDate);
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
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor={`${fieldId}-8`} className="block text-xs font-semibold text-slate-500 mb-1">
                  Kategorie
                </label>
                <select id={`${fieldId}-8`}
                  value={categoryId}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
                >
                  <option value="">Bez kategorie</option>
                  {relevantCategories.map((cat) => (
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
                  value={subcategoryId}
                  onChange={(e) => setSubcategoryId(e.target.value)}
                  disabled={!categoryId || subcategories.length === 0}
                  className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 disabled:bg-slate-50 disabled:text-slate-400"
                >
                  <option value="">Bez podkategorie</option>
                  {subcategories.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Volba opakování pro položky bez pravidelné série */}
        {!isLinkedToRecurring && (
          <div className="pt-2 border-t border-slate-100">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setIsRecurring(checked);
                  if (checked) {
                    const parsedDay = parseInt(date.split('-')[2], 10);
                    if (!isNaN(parsedDay) && parsedDay >= 1 && parsedDay <= 31) {
                      setDayOfMonth(parsedDay);
                    }
                  }
                }}
                className="w-4 h-4 text-sky-600 rounded border-slate-300 focus:ring-sky-500"
              />
              <span className="text-sm font-medium text-slate-900">
                Opakovat v dalších obdobích
              </span>
            </label>

            {isRecurring && (
              <div className="mt-3 p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className={`grid ${frequency !== 'custom' ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
                  <div>
                    <label htmlFor={`${fieldId}-10`} className="block text-xs font-semibold text-slate-500 mb-1">
                      Jak často
                    </label>
                    <select id={`${fieldId}-10`}
                      value={frequency}
                      onChange={(e) => setFrequency(e.target.value as RecurrenceFrequency)}
                      className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                    >
                      <option value="monthly">Každý měsíc</option>
                      <option value="bi_monthly">Každé 2 měsíce</option>
                      <option value="quarterly">Čtvrtletně (3 měsíce)</option>
                      <option value="semi_annually">Pololetně (6 měsíců)</option>
                      <option value="annually">Ročně (12 měsíců)</option>
                    </select>
                  </div>
                  {frequency !== 'custom' && (
                    <div>
                      <label htmlFor={`${fieldId}-11`} className="block text-xs font-semibold text-slate-500 mb-1">
                        Den v měsíci
                      </label>
                      <input id={`${fieldId}-11`}
                        type="number"
                        min="1"
                        max="31"
                        value={dayOfMonth || ''}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          setDayOfMonth(isNaN(val) ? 0 : val);
                        }}
                        className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
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
                    value={recurringEndDate}
                    min={date}
                    onChange={(e) => { setRecurringEndDate(e.target.value); clearError('endDate'); }}
                    {...fieldErrorProps(`${fieldId}-12`, errors.endDate)}
                    className={`w-full px-3.5 py-2 text-sm bg-white border rounded-xl focus:outline-none ${fieldStateClass(errors.endDate, 'border-slate-200 focus:ring-2 focus:ring-sky-500')}`}
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
            placeholder="např. Faktura č. 2026-04, účel platby..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
          />
        </div>

        <FormError message={saveError} />

        {/* Akční tlačítka */}
        <ModalFooter>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-500 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
          >
            Zrušit
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="px-5 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-sm shadow-sky-200 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{isEditing ? 'Uložit změny' : 'Vytvořit položku'}</span>
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
};
