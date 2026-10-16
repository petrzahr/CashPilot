import React, { useEffect, useRef } from 'react';
import { Modal, ModalFooter } from './Modal';
import { AlertTriangle, Info } from 'lucide-react';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  /** false = jen informační dialog s jediným tlačítkem */
  showCancel?: boolean;
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
  showCancel = true,
}) => {
  // Nevratné potvrzení začíná na Zrušit, aby omylem stisknutý Enter nic nesmazal
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!isOpen || !isDestructive || !showCancel) return;
    const frame = requestAnimationFrame(() => cancelButtonRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isOpen, isDestructive, showCancel]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth="max-w-md">
      <div className="flex items-start gap-3">
        {/* Čistě informační dialog (jediné tlačítko) nevaruje, jen sděluje */}
        <div className={`p-2.5 rounded-xl shrink-0 ${
          isDestructive ? 'bg-red-50 text-red-600' : !showCancel ? 'bg-sky-50 text-sky-600' : 'bg-amber-50 text-amber-600'
        }`}>
          {!showCancel && !isDestructive
            ? <Info className="w-5 h-5" aria-hidden="true" />
            : <AlertTriangle className="w-5 h-5" aria-hidden="true" />}
        </div>
        <div className="text-sm text-slate-500 space-y-2">
          <p>{message}</p>
        </div>
      </div>
      <ModalFooter>
        {showCancel && (
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onClose}
            className="btn-secondary"
          >
            {cancelText}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className={isDestructive ? 'btn-danger' : 'btn-primary'}
        >
          {confirmText}
        </button>
      </ModalFooter>
    </Modal>
  );
};
