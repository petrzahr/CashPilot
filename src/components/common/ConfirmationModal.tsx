import React from 'react';
import { Modal } from './Modal';
import { AlertTriangle } from 'lucide-react';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Potvrdit',
  cancelText = 'Zrušit',
  isDestructive = false,
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth="max-w-md">
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-xl shrink-0 ${isDestructive ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
          <AlertTriangle className="w-6 h-6" />
        </div>
        <div className="text-sm text-slate-600 space-y-2">
          <p>{message}</p>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
        >
          {cancelText}
        </button>
        <button
          type="button"
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className={`px-4 py-2 text-sm font-medium text-white rounded-xl transition-colors ${
            isDestructive 
              ? 'bg-red-600 hover:bg-red-700 shadow-sm shadow-red-200' 
              : 'bg-sky-600 hover:bg-sky-700 shadow-sm shadow-sky-200'
          }`}
        >
          {confirmText}
        </button>
      </div>
    </Modal>
  );
};
