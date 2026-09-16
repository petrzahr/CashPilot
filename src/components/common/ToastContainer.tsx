import React from 'react';
import { useFinance } from '../../context/FinanceContext';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useFinance();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
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
            className={`pointer-events-auto flex items-center justify-between p-3.5 rounded-xl border shadow-lg backdrop-blur-sm transition-all duration-200 ${bgClass}`}
          >
            <div className="flex items-center gap-3">
              <span className="shrink-0">{icon}</span>
              <span className="text-sm font-medium">{toast.text}</span>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="ml-3 p-1 rounded-lg text-slate-500 hover:text-slate-600 hover:bg-slate-100/60 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
