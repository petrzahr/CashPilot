import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidth?: string;
  /** Zavření, které mohlo přijít omylem (klepnutí mimo dialog, Escape); výchozí je onClose */
  onDismissAttempt?: () => void;
}

/** Identifikátory otevřených dialogů v pořadí otevření; poslední je nahoře. */
const openModalStack: string[] = [];

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = 'max-w-lg',
  onDismissAttempt,
}) => {
  const dismiss = onDismissAttempt ?? onClose;
  const titleId = useId();
  const subtitleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Zásobník otevřených dialogů: Escape zavře jen ten nejvrchnější, ne celý řetězec
  useEffect(() => {
    if (!isOpen) return;
    openModalStack.push(titleId);
    return () => {
      const index = openModalStack.lastIndexOf(titleId);
      if (index !== -1) openModalStack.splice(index, 1);
    };
  }, [isOpen, titleId]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (openModalStack[openModalStack.length - 1] !== titleId) return;
      e.preventDefault();
      dismiss();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, dismiss, titleId]);

  // Přesun fokusu do dialogu při otevření a jeho vrácení na původní prvek po zavření
  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      dialog.focus();
    }
    return () => {
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [isOpen]);

  // Udržení fokusu uvnitř dialogu při procházení klávesou Tab
  const handleTrapKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    ).filter((el) => el.offsetParent !== null);
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialogRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!isOpen) return null;

  const dialog = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div
        className="fixed inset-0 bg-scrim/40 backdrop-blur-xs transition-opacity"
        onClick={dismiss}
      />
      {/* Hlavička a patička stojí, posouvá se jen obsah; dialog se vždy vejde do viditelné výšky */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
        onKeyDown={handleTrapKeyDown}
        className={`relative flex flex-col w-full ${maxWidth} max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-3rem)] overflow-hidden rounded-2xl bg-white text-left shadow-xl border border-slate-200 focus:outline-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between gap-3 border-b border-slate-100 px-5 sm:px-6 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-bold text-slate-900">{title}</h2>
            {subtitle && <p id={subtitleId} className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zavřít"
            className="btn-icon -m-1.5 md:m-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="modal-body flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-6 py-5 has-[.modal-footer]:pb-0">
          {children}
        </div>
      </div>
    </div>
  );

  // Portal into body so parent layout utilities (e.g. space-y margins) never shift the overlay;
  // static rendering without a DOM (server-rendered tests) keeps the dialog inline
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
};

/**
 * Akční lišta dialogu. Při dlouhém obsahu zůstává přilepená ke spodnímu okraji,
 * ale patří do formuláře, takže odesílací tlačítko dál funguje přes onSubmit.
 */
export const ModalFooter: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = 'justify-end',
}) => (
  <div
    className={`modal-footer sticky bottom-0 z-10 -mx-5 sm:-mx-6 !mt-6 px-5 sm:px-6 py-4 bg-white border-t border-slate-100 flex items-center gap-3 [&>button]:whitespace-nowrap [&>button]:min-h-10 max-md:[&>button]:min-h-11 max-sm:[&>button]:flex-auto max-sm:[&>button]:justify-center ${className}`}
  >
    {children}
  </div>
);
