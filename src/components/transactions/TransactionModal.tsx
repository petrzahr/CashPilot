import React, { useState, useEffect } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { Modal } from '../common/Modal';
import { MovementType, RecurrenceFrequency, Transaction, TransactionStatus } from '../../types/finance';
import { czkToHaler, halerToInputValue, parseInputToHaler } from '../../services/currencyService';
import { getNextSequenceForDate } from '../../services/sequenceService';
import { getDefaultDateForPeriod, formatCzechDate } from '../../services/periodService';
import { getStatusForDate } from '../../services/statusService';
import { czechStringCompare } from '../../services/categoryService';
import { AlertCircle, ArrowRightLeft, Calendar, Repeat, Hash, Loader2 } from 'lucide-react';

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
  const {
    accounts,
    categories,
    transactions,
    selectedPeriod,
    addTransaction,
    updateTransaction,
    addRecurringRule,
    updateRecurringRule,
  } = useFinance();

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

  // Dialog úpravy pravidelné položky
  const [recurringEditMode, setRecurringEditMode] = useState<'occurrence' | 'future' | 'series'>('occurrence');
  const [isSaving, setIsSaving] = useState(false);

  const isEditing = !!transactionToEdit;
  const isLinkedToRecurring = !!transactionToEdit?.recurringRuleId;

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
    } else {
      const defaultDate = initialDate || getDefaultDateForPeriod(selectedPeriod);
      const defaultDay = parseInt(defaultDate.split('-')[2], 10) || 1;
      setTitle('');
      setAmountStr('');
      setDate(defaultDate);
      const nextSeq = getNextSequenceForDate(defaultDate, transactions);
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
    }
  }, [transactionToEdit, isOpen, initialType, initialDate, selectedPeriod.startDate, selectedPeriod.endDate, transactions, accounts]);

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
      const nextSeq = getNextSequenceForDate(newDate, transactions);
      setSequenceStr(nextSeq.toString());
      setStatus(getStatusForDate(newDate));
      if (sourceAccountId) {
        const srcAcc = accounts.find(a => a.id === sourceAccountId);
        if (srcAcc?.initialBalanceDate && newDate < srcAcc.initialBalanceDate) {
          setSourceAccountId('');
        }
      }
      if (targetAccountId) {
        const tgtAcc = accounts.find(a => a.id === targetAccountId);
        if (tgtAcc?.initialBalanceDate && newDate < tgtAcc.initialBalanceDate) {
          setTargetAccountId('');
        }
      }
    } else {
      if (newDate === transactionToEdit?.date) {
        setSequenceStr((transactionToEdit.sequence || 1).toString());
      } else {
        const otherTxs = transactions.filter(t => t.id !== transactionToEdit?.id);
        const nextSeq = getNextSequenceForDate(newDate, otherTxs);
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

    if (!title.trim()) {
      alert('Zadejte prosím název položky.');
      return;
    }
    if (amountInHaler <= 0) {
      alert('Částka musí být kladné číslo.');
      return;
    }
    if (!sourceAccountId) {
      alert('Vyberte prosím účet.');
      return;
    }
    if (sourceAccError) {
      alert(sourceAccError);
      return;
    }
    if (type === 'transfer') {
      if (!targetAccountId) {
        alert('Pro převod vyberte cílový účet.');
        return;
      }
      if (sourceAccountId === targetAccountId) {
        alert('Zdrojový a cílový účet převodu se musí lišit.');
        return;
      }
      if (targetAccError) {
        alert(targetAccError);
        return;
      }
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
            updateRecurringRule(
              transactionToEdit.recurringRuleId,
              recurringEditMode,
              selectedPeriod.key,
              {
                title,
                amountInHaler,
                date,
                sourceAccountId,
                targetAccountId: type === 'transfer' ? targetAccountId : undefined,
                categoryId: type !== 'transfer' && categoryId ? categoryId : null,
                subcategoryId: type !== 'transfer' && subcategoryId ? subcategoryId : null,
                note
              }
            );
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
      alert('Při ukládání položky došlo k chybě.');
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
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Přepínač typu pohybu */}
        <div className="grid grid-cols-3 gap-2 p-1 bg-slate-100 rounded-xl">
          <button
            type="button"
            onClick={() => handleTypeChange('expense')}
            className={`py-2 text-sm font-medium rounded-lg transition-all ${
              type === 'expense'
                ? 'bg-white text-red-600 shadow-sm font-semibold'
                : 'text-slate-600 hover:text-slate-900'
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
                : 'text-slate-600 hover:text-slate-900'
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
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Převod
          </button>
        </div>

        {/* Režim úpravy pravidelné položky */}
        {isEditing && isLinkedToRecurring && (
          <div className="p-3 bg-sky-50 border border-sky-100 rounded-xl space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-sky-800">
              <Repeat className="w-4 h-4" />
              <span>Tato položka je součástí pravidelné série</span>
            </div>
            <div className="space-y-1 text-xs text-slate-700">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="recMode"
                  value="occurrence"
                  checked={recurringEditMode === 'occurrence'}
                  onChange={() => setRecurringEditMode('occurrence')}
                  className="text-sky-600 focus:ring-sky-500"
                />
                <span>Upravit pouze tento výskyt ({selectedPeriod.name})</span>
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
                <span>Upravit tento a všechny budoucí výskyty</span>
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
                <span>Upravit celou sérii (včetně minulých)</span>
              </label>
            </div>
          </div>
        )}

        {/* Název a částka */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Název položky *
            </label>
            <input
              type="text"
              required
              placeholder="např. Nákup potravin, Mzda"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Částka v Kč *
            </label>
            <div className="relative">
              <input
                type="number"
                step="any"
                min="0"
                required
                placeholder="0"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 font-medium"
              />
              <span className="absolute right-3.5 top-2 text-xs font-semibold text-slate-400 pointer-events-none">
                Kč
              </span>
            </div>
          </div>
        </div>

        {/* Datum, Pořadí v rámci dne a Stav */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Datum *
            </label>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => handleDateChange(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
              <Hash className="w-3.5 h-3.5 text-sky-600" />
              <span>Pořadí v dni *</span>
            </label>
            <input
              type="number"
              min="1"
              step="1"
              required
              value={sequenceStr}
              onChange={(e) => setSequenceStr(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 font-bold text-sky-900"
              title="Pořadí v rámci dne (1, 2, 3...). Určuje přesný sled pohybů a průběžný zůstatek."
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Stav položky
            </label>
            <select
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
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {type === 'transfer' ? 'Zdrojový účet (odkud) *' : 'Účet *'}
            </label>
            <select
              required
              value={sourceAccountId}
              onChange={(e) => setSourceAccountId(e.target.value)}
              className={`w-full px-3.5 py-2 text-sm bg-white border ${sourceAccError ? 'border-rose-500 ring-1 ring-rose-500' : 'border-slate-200'} rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500`}
            >
              <option value="">-- Žádný --</option>
              {activeAccounts.map((acc) => {
                const isInactive = !!(acc.initialBalanceDate && date && date < acc.initialBalanceDate);
                return (
                  <option key={acc.id} value={acc.id} disabled={isInactive}>
                    {acc.name} ({acc.institution || (acc.isUsableCash ? 'Použitelné' : 'Majetek')}){isInactive ? ` — aktivní až od ${formatCzechDate(acc.initialBalanceDate!)}` : ''}
                  </option>
                );
              })}
            </select>
            {sourceAccError && (
              <p className="text-xs text-rose-600 font-medium mt-1">{sourceAccError}</p>
            )}
          </div>

          {type === 'transfer' ? (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Cílový účet (kam) *
              </label>
              <select
                required
                value={targetAccountId}
                onChange={(e) => setTargetAccountId(e.target.value)}
                className={`w-full px-3.5 py-2 text-sm bg-white border ${targetAccError ? 'border-rose-500 ring-1 ring-rose-500' : 'border-slate-200'} rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500`}
              >
                <option value="">-- Žádný --</option>
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
              {targetAccError && (
                <p className="text-xs text-rose-600 font-medium mt-1">{targetAccError}</p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Kategorie
                </label>
                <select
                  value={categoryId}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
                >
                  <option value="">-- Žádná --</option>
                  {relevantCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Podkategorie
                </label>
                <select
                  value={subcategoryId}
                  onChange={(e) => setSubcategoryId(e.target.value)}
                  disabled={!categoryId || subcategories.length === 0}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 disabled:bg-slate-50 disabled:text-slate-400"
                >
                  <option value="">-- Žádná --</option>
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
              <span className="text-sm font-medium text-slate-800">
                Pravidelná položka (opakovat v dalších měsících)
              </span>
            </label>

            {isRecurring && (
              <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className={`grid ${frequency !== 'custom' ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Frekvence opakování
                    </label>
                    <select
                      value={frequency}
                      onChange={(e) => setFrequency(e.target.value as RecurrenceFrequency)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
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
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Den opakování v měsíci
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="31"
                        value={dayOfMonth || ''}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          setDayOfMonth(isNaN(val) ? 0 : val);
                        }}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                    </div>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  Budoucí výskyty se dynamicky generují do forecastu bez zahlcení databáze fyzickými řádky.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Poznámka */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Poznámka (volitelné)
          </label>
          <input
            type="text"
            placeholder="např. Faktura č. 2026-04, účel platby..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
          />
        </div>

        {/* Akční tlačítka */}
        <div className="mt-6 flex justify-end gap-3 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
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
        </div>
      </form>
    </Modal>
  );
};
