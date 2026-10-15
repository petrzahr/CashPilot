import React from 'react';
import { useFinance } from '../../context/FinanceContext';
import { ConfirmationModal } from './ConfirmationModal';

interface DisconnectDriveDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Jediné potvrzení odpojení Google Disku pro hlavičku i Nastavení: odpojení odhlásí
 * z aplikace, a pokud synchronizace neproběhla, upozorní na neuložené změny.
 */
export const DisconnectDriveDialog: React.FC<DisconnectDriveDialogProps> = ({ isOpen, onClose }) => {
  const { driveSyncStatus, disconnectGoogleDrive } = useFinance();

  return (
    <ConfirmationModal
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={() => void disconnectGoogleDrive()}
      title="Odpojit Google Disk?"
      message={
        driveSyncStatus === 'synced'
          ? 'Aplikace se odhlásí a vrátí na přihlašovací obrazovku. Vaše data zůstávají na Google Disku a po novém přihlášení se znovu načtou.'
          : 'Některé změny ještě nemusí být uložené na Google Disku. Doporučujeme nejdřív počkat na dokončení synchronizace. Aplikace se odhlásí a vrátí na přihlašovací obrazovku.'
      }
      confirmText="Odpojit a odhlásit"
    />
  );
};
