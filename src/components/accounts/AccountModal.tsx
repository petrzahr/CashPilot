import React, { useState, useEffect } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { Modal } from '../common/Modal';
import { Account, AccountType } from '../../types/finance';
import { halerToInputValue, parseInputToHaler } from '../../services/currencyService';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountToEdit?: Account | null;
}

const ACCOUNT_COLORS = [
  '#0284c7', // Sky blue
  '#0d9488', // Teal
  '#10b981', // Emerald
  '#84cc16', // Lime
  '#f59e0b', // Amber
  '#ea580c', // Orange
  '#dc2626', // Red
  '#8b5cf6', // Violet
  '#6366f1', // Indigo
  '#64748b', // Slate
];

export const AccountModal: React.FC<AccountModalProps> = ({
  isOpen,
  onClose,
  accountToEdit,
}) => {
  const { addAccount, updateAccount, accounts } = useFinance();

  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('checking');
  const [currency, setCurrency] = useState('CZK');
  const [balanceStr, setBalanceStr] = useState('');
  const [initialBalanceDate, setInitialBalanceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [isUsableCash, setIsUsableCash] = useState(true);
  const [isNetWorth, setIsNetWorth] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [institution, setInstitution] = useState('');
  const [color, setColor] = useState(ACCOUNT_COLORS[0]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isEditing = !!accountToEdit;

  useEffect(() => {
    setErrorMessage(null);
    if (accountToEdit) {
      setName(accountToEdit.name);
      setType(accountToEdit.type);
      setCurrency(accountToEdit.currency || 'CZK');
      setBalanceStr(halerToInputValue(accountToEdit.initialBalanceInHaler));
      setInitialBalanceDate(accountToEdit.initialBalanceDate || new Date().toISOString().slice(0, 10));
      setIsUsableCash(accountToEdit.isUsableCash);
      setIsNetWorth(accountToEdit.isNetWorth);
      setIsDefault(Boolean(accountToEdit.isDefault));
      setInstitution(accountToEdit.institution || '');
      setColor(accountToEdit.color || ACCOUNT_COLORS[0]);
    } else {
      setName('');
      setType('checking');
      setCurrency('CZK');
      setBalanceStr('0');
      setInitialBalanceDate(new Date().toISOString().slice(0, 10));
      setIsUsableCash(true);
      setIsNetWorth(true);
      setIsDefault(false);
      setInstitution('');
      setColor(ACCOUNT_COLORS[accounts.length % ACCOUNT_COLORS.length]);
    }
  }, [accountToEdit, isOpen, accounts.length]);

  // Automatické nastavení flagů podle typu účtu
  const handleTypeChange = (newType: AccountType) => {
    setType(newType);
    if (newType === 'investment' || newType === 'pension') {
      setIsUsableCash(false);
      setIsNetWorth(true);
    } else {
      setIsUsableCash(true);
      setIsNetWorth(true);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert('Zadejte prosím název účtu.');
      return;
    }

    const initialBalanceInHaler = parseInputToHaler(balanceStr);

    if (isEditing && accountToEdit) {
      const res = updateAccount({
        ...accountToEdit,
        name: name.trim(),
        type,
        currency,
        initialBalanceInHaler,
        initialBalanceDate,
        isUsableCash,
        isNetWorth,
        isDefault,
        institution: institution.trim() || undefined,
        color,
      });
      if (res && !res.success) {
        setErrorMessage(res.message || 'Účet se nepodařilo uložit.');
        return;
      }
    } else {
      addAccount({
        name: name.trim(),
        type,
        currency,
        initialBalanceInHaler,
        initialBalanceDate,
        isUsableCash,
        isNetWorth,
        isDefault,
        institution: institution.trim() || undefined,
        color,
        sortOrder: accounts.length + 1,
        status: 'active',
        currentMarketValueInHaler: type === 'investment' ? initialBalanceInHaler : undefined,
      });
    }

    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Upravit účet' : 'Přidat nový účet'}
      subtitle={isEditing ? 'Úprava parametrů účtu' : 'Založte běžný, spořicí nebo investiční účet'}
      maxWidth="max-w-lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMessage && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium leading-relaxed">
            {errorMessage}
          </div>
        )}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Název účtu *
          </label>
          <input
            type="text"
            required
            placeholder="např. Hlavní běžný účet, Spoření na rezervu"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Typ účtu *
            </label>
            <select
              value={type}
              onChange={(e) => handleTypeChange(e.target.value as AccountType)}
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="checking">Běžný účet</option>
              <option value="cash">Hotovost</option>
              <option value="savings">Spořicí účet</option>
              <option value="investment">Investiční účet</option>
              <option value="pension">Penzijní účet</option>
              <option value="other">Jiný účet</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Finanční instituce (banka / broker)
            </label>
            <input
              type="text"
              placeholder="např. Česká spořitelna, Air Bank"
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Počáteční zůstatek (Kč) *
            </label>
            <div className="relative">
              <input
                type="number"
                step="any"
                required
                placeholder="0"
                value={balanceStr}
                onChange={(e) => setBalanceStr(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium"
              />
              <span className="absolute right-3.5 top-2 text-xs font-semibold text-slate-400">Kč</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Datum počátečního stavu *
            </label>
            <input
              type="date"
              required
              value={initialBalanceDate}
              onChange={(e) => setInitialBalanceDate(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
        </div>

        {/* Přepínače zahrnutí a výchozí účet */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="w-4 h-4 text-sky-600 rounded border-slate-300 focus:ring-sky-500"
            />
            <span className="text-sm font-medium text-slate-800">
              Nastavit jako výchozí účet
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isUsableCash}
              onChange={(e) => setIsUsableCash(e.target.checked)}
              className="w-4 h-4 text-sky-600 rounded border-slate-300 focus:ring-sky-500"
            />
            <span className="text-sm font-medium text-slate-800">
              Zahrnout do „Použitelných peněz“ (provozní likvidita)
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isNetWorth}
              onChange={(e) => setIsNetWorth(e.target.checked)}
              className="w-4 h-4 text-sky-600 rounded border-slate-300 focus:ring-sky-500"
            />
            <span className="text-sm font-medium text-slate-800">
              Zahrnout do „Celkového majetku“ (Net Worth)
            </span>
          </label>
        </div>

        {/* Barva účtu */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Barva účtu
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            {ACCOUNT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-full transition-transform ${
                  color === c ? 'scale-125 ring-2 ring-offset-2 ring-slate-400' : 'hover:scale-110'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
          >
            Zrušit
          </button>
          <button
            type="submit"
            className="px-5 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-sm shadow-sky-200"
          >
            {isEditing ? 'Uložit změny' : 'Vytvořit účet'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
