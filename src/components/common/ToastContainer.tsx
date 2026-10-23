import React, { useEffect, useRef } from 'react';
import { useFinance, ToastMessage } from '../../context/FinanceContext';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

/**
 * Jedno oznámení. Samo zmizí po `durationMs`, ale odpočet se zastaví, dokud je nad ním myš
 * nebo v něm fokus, aby „Vrátit“ nikdy neuteklo pod rukama.
 */
const ToastItem: React.FC<{ toast: ToastMessage; onRemove: (id: string) => void }> = ({ toast, onRemove }) => {
  const remainingRef = useRef(toast.durationMs ?? 0);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoveredRef = useRef(false);
  const focusedRef = useRef(false);

  const pause = () => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    remainingRef.current -= Date.now() - startedAtRef.current;
  };
  const resume = () => {
    if (!toast.durationMs || timerRef.current || hoveredRef.current || focusedRef.current) return;
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(() => onRemove(toast.id), Math.max(1000, remainingRef.current));
  };

  useEffect(() => {
    resume();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // Odpočet se spouští jen jednou při zobrazení oznámení
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  let icon = <CheckCircle2 className="w-5 h-5 text-emerald-600" />;
  let bgClass = 'bg-white border-slate-200 text-slate-900';

  if (toast.type === 'error') {
    icon = <AlertCircle className="w-5 h-5 text-red-600" />;
    bgClass = 'bg-red-50/90 border-red-200 text-red-900';
  } else if (toast.type === 'warning') {
    icon = <AlertTriangle className="w-5 h-5 text-amber-600" />;
    bgClass = 'bg-amber-50/90 border-amber-200 text-amber-900';
  } else if (toast.type === 'info') {
    icon = <Info className="w-5 h-5 text-sky-600" />;
    bgClass = 'bg-sky-50/90 border-sky-200 text-sky-900';
  }

  return (
    <div
      role={toast.type === 'error' ? 'alert' : undefined}
      onPointerEnter={() => { hoveredRef.current = true; pause(); }}
      onPointerLeave={() => { hoveredRef.current = false; resume(); }}
      onFocus={() => { focusedRef.current = true; pause(); }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        focusedRef.current = false;
        resume();
      }}
      className={`pointer-events-auto flex items-center justify-between p-4 rounded-xl border shadow-lg backdrop-blur-xs transition-all duration-200 ${bgClass}`}
    >
      <div className="flex items-start gap-3 min-w-0">
        <span className="shrink-0 mt-0.5" aria-hidden="true">{icon}</span>
        <div className="min-w-0 space-y-2">
          <span className="block text-sm font-medium">{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              aria-keyshortcuts="Control+Z Meta+Z"
              title="Ctrl+Z"
              onClick={() => {
                onRemove(toast.id);
                toast.action?.onClick();
              }}
              className="max-md:min-h-11 inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-200 text-slate-900 hover:bg-slate-50 transition-colors"
            >
              {toast.action.label}
            </button>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onRemove(toast.id)}
        aria-label="Zavřít oznámení"
        className="btn-icon ml-3 -my-2.5 -mr-2.5 md:m-0 md:ml-3"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useFinance();

  // Ctrl/⌘+Z spustí akci posledního viditelného oznámení (např. „Vrátit“ po smazání).
  // Při psaní do pole zůstává Ctrl+Z vrácením textu.
  const toastsRef = useRef(toasts);
  toastsRef.current = toasts;
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || target.closest('input, textarea, select'))) return;
      const latest = [...toastsRef.current].reverse().find(t => t.action);
      if (!latest?.action) return;
      e.preventDefault();
      removeToast(latest.id);
      latest.action.onClick();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [removeToast]);

  // Kontejner zůstává v DOM i bez toastů, aby čtečky obrazovky spolehlivě ohlásily nově přidané zprávy
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 inset-x-4 md:bottom-5 md:left-auto md:right-5 md:w-full z-50 flex flex-col gap-2 md:max-w-sm pointer-events-none"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
      ))}
    </div>
  );
};
