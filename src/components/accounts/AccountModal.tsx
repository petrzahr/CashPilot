import React, { useState, useEffect, useId } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { Modal, ModalFooter } from '../common/Modal';
import { Account, AccountType } from '../../types/finance';
import { halerToInputValue, parseInputToHaler } from '../../services/currencyService';
import { COLOR_NAMES, COLOR_PALETTE } from '../../constants/colors';
import { FieldError, FormError, fieldStateClass, fieldErrorProps } from '../common/FieldError';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountToEdit?: Account | null;
}

export const AccountModal: React.FC<AccountModalProps> = ({
  isOpen,
  onClose,
  accountToEdit,
}) => {
  const fieldId = useId();
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
  const [color, setColor] = useState(COLOR_PALETTE[0]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const isEditing = !!accountToEdit;

  useEffect(() => {
    setErrorMessage(null);
    setNameError(null);
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
      setColor(accountToEdit.color || COLOR_PALETTE[0]);
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
      setColor(COLOR_PALETTE[accounts.length % COLOR_PALETTE.length]);
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
      setNameError('Zadejte prosím název účtu.');
      document.getElementById(`${fieldId}-1`)?.focus();
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
      title={isEditing ? 'Upravit účet' : 'Nový účet'}
      subtitle={undefined}
      maxWidth="max-w-lg"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor={`${fieldId}-1`} className="block text-xs font-semibold text-slate-500 mb-1">
            Název účtu *
          </label>
          <input id={`${fieldId}-1`}
            type="text"
            required
            placeholder="např. Hlavní běžný účet, Spoření na rezervu"
            value={name}
            onChange={(e) => { setName(e.target.value); setNameError(null); }}
            {...fieldErrorProps(`${fieldId}-1`, nameError)}
            className={`w-full px-3.5 py-2 text-sm bg-white border rounded-xl focus:outline-none ${fieldStateClass(nameError, 'border-slate-200 focus:ring-2 focus:ring-sky-500')}`}
          />
          <FieldError inputId={`${fieldId}-1`} message={nameError} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${fieldId}-2`} className="block text-xs font-semibold text-slate-500 mb-1">
              Typ účtu *
            </label>
            <select id={`${fieldId}-2`}
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
            <label htmlFor={`${fieldId}-3`} className="block text-xs font-semibold text-slate-500 mb-1">
              Banka nebo obchodník (nepovinné)
            </label>
            <input id={`${fieldId}-3`}
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
            <label htmlFor={`${fieldId}-4`} className="block text-xs font-semibold text-slate-500 mb-1">
              Počáteční zůstatek *
            </label>
            <div className="relative">
              <input id={`${fieldId}-4`}
                type="text"
                autoComplete="off"
                required
                placeholder="0"
                value={balanceStr}
                onChange={(e) => setBalanceStr(e.target.value)}
                className="w-full pl-3.5 pr-10 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-xs font-semibold text-slate-500">Kč</span>
            </div>
          </div>

          <div>
            <label htmlFor={`${fieldId}-5`} className="block text-xs font-semibold text-slate-500 mb-1">
              Počáteční zůstatek ke dni *
            </label>
            <input id={`${fieldId}-5`}
              type="date"
              required
              value={initialBalanceDate}
              onChange={(e) => setInitialBalanceDate(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
        </div>

        {/* Přepínače zahrnutí a výchozí účet */}
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="w-4 h-4 text-sky-600 rounded border-slate-300 focus:ring-sky-500"
            />
            <span className="text-sm font-medium text-slate-900">
              Výchozí účet <span className="font-normal text-slate-500">– předvyplní se u nových položek a počítá se z něj souhrn rozpočtu</span>
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isUsableCash}
              onChange={(e) => setIsUsableCash(e.target.checked)}
              className="w-4 h-4 text-sky-600 rounded border-slate-300 focus:ring-sky-500"
            />
            <span className="text-sm font-medium text-slate-900">
              Započítat do použitelných peněz <span className="font-normal text-slate-500">– peníze k běžnému utrácení</span>
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isNetWorth}
              onChange={(e) => setIsNetWorth(e.target.checked)}
              className="w-4 h-4 text-sky-600 rounded border-slate-300 focus:ring-sky-500"
            />
            <span className="text-sm font-medium text-slate-900">
              Započítat do celkového majetku
            </span>
          </label>
        </div>

        {/* Barva účtu */}
        <div>
          <span id={`${fieldId}-color`} className="block text-xs font-semibold text-slate-500 mb-1.5">
            Barva účtu
          </span>
          <div role="group" aria-labelledby={`${fieldId}-color`} className="flex items-center gap-2 flex-wrap">
            {COLOR_PALETTE.map((c, i) => (
              <button
                key={c}
                type="button"
                aria-label={COLOR_NAMES[i] ?? `Barva ${i + 1}`}
                title={COLOR_NAMES[i]}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className={`w-7 h-7 max-md:w-9 max-md:h-9 relative max-md:after:absolute max-md:after:-inset-1 max-md:after:content-[''] rounded-full transition-transform motion-reduce:transition-none ${
                  color === c ? 'scale-125 ring-2 ring-offset-2 ring-slate-400' : 'hover:scale-110'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        {/* Chyba uložení stojí u tlačítek jako v ostatních formulářích */}
        <FormError message={errorMessage} />

        <ModalFooter>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-500 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
          >
            Zrušit
          </button>
          <button
            type="submit"
            className="px-5 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-sm"
          >
            {isEditing ? 'Uložit změny' : 'Vytvořit účet'}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
};
