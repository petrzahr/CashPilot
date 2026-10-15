import React from 'react';

/**
 * Chyba formulářového pole zobrazená přímo pod polem (místo window.alert).
 * Pole se s textem chyby propojí přes aria-describedby a označí aria-invalid,
 * takže ji přečte i čtečka obrazovky.
 */

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export const fieldErrorId = (inputId: string) => `${inputId}-error`;

/** Atributy pole s chybou; bez chyby nic nepřidává. */
export const fieldErrorProps = (inputId: string, message?: string | null) =>
  message ? { 'aria-invalid': true as const, 'aria-describedby': fieldErrorId(inputId) } : {};

/** Okraj pole: červený při chybě, jinak běžná vlasová linka. */
export const fieldBorderClass = (message?: string | null) =>
  message ? 'border-red-500 ring-1 ring-red-500' : 'border-slate-200';

export const FieldError: React.FC<{ inputId: string; message?: string | null }> = ({ inputId, message }) =>
  message ? (
    <p id={fieldErrorId(inputId)} className="text-xs text-red-600 font-medium mt-1">
      {message}
    </p>
  ) : null;

/** Přesune fokus na první pole s chybou (v pořadí formuláře). */
export function focusFirstInvalid<K extends string>(errors: FieldErrors<K>, order: [K, string][]) {
  const first = order.find(([key]) => errors[key]);
  if (first) document.getElementById(first[1])?.focus();
}

/** Chyba uložení celého formuláře (např. selhání při zápisu), ohlášená čtečce. */
export const FormError: React.FC<{ message?: string | null }> = ({ message }) =>
  message ? (
    <p role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium leading-relaxed">
      {message}
    </p>
  ) : null;
