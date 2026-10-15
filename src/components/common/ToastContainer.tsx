import React from 'react';
import { useFinance } from '../../context/FinanceContext';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useFinance();

  // Kontejner zůstává v DOM i bez toastů, aby čtečky obrazovky spolehlivě ohlásily nově přidané zprávy
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 inset-x-4 md:bottom-5 md:left-auto md:right-5 md:w-full z-50 flex flex-col gap-2 md:max-w-sm pointer-events-none"
    >
      {toasts.map((toast) => {
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
            key={toast.id}
            role={toast.type === 'error' ? 'alert' : undefined}
            className={`pointer-events-auto flex items-center justify-between p-4 rounded-xl border shadow-lg backdrop-blur-sm transition-all duration-200 ${bgClass}`}
          >
            <div className="flex items-start gap-3 min-w-0">
              <span className="shrink-0 mt-0.5" aria-hidden="true">{icon}</span>
              <div className="min-w-0 space-y-2">
                <span className="block text-sm font-medium">{toast.text}</span>
                {toast.action && (
                  <button
                    type="button"
                    onClick={() => {
                      removeToast(toast.id);
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
              onClick={() => removeToast(toast.id)}
              aria-label="Zavřít oznámení"
              className="ml-3 p-3.5 -m-2.5 md:p-1 md:m-0 md:ml-3 rounded-lg text-slate-500 hover:text-slate-600 hover:bg-slate-100/60 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
