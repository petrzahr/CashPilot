import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { MoveDirection } from '../../services/reorderService';

interface MoveButtonsProps {
  /** Název položky do aria-label, např. „účet Běžný účet“. */
  itemLabel: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: MoveDirection) => void;
  className?: string;
  /**
   * stack = na desktopu šipky pod sebou, vždy vidět a úzké (řádky položek dne);
   * row = vedle sebe, na desktopu jen při najetí (karty účtů).
   */
  layout?: 'row' | 'stack';
}

/**
 * Alternativa k drag & drop pro dotyk a klávesnici: posun o jedno místo.
 * Na mobilu je vidět vždy, na desktopu při najetí na rodiče (`group`) nebo
 * při fokusu, aby nepřekážela přetahování.
 * Neaktivní směr používá aria-disabled místo disabled, aby fokus po posunu
 * na okraj seznamu nezmizel.
 */
export const MoveButtons: React.FC<MoveButtonsProps> = ({ itemLabel, canMoveUp, canMoveDown, onMove, className = '', layout = 'row' }) => {
  // Skryté tlačítko by na desktopu dál drželo místo a v řádku by zela prázdná mezera
  const containerClass = layout === 'stack'
    ? 'md:flex-col md:gap-0'
    : 'md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity';
  const desktopButtonClass = layout === 'stack' ? 'md:p-0 md:h-4' : 'md:p-1';
  const buttons: { direction: MoveDirection; enabled: boolean; label: string; Icon: typeof ChevronUp }[] = [
    { direction: 'up', enabled: canMoveUp, label: 'Posunout nahoru', Icon: ChevronUp },
    { direction: 'down', enabled: canMoveDown, label: 'Posunout dolů', Icon: ChevronDown },
  ];

  return (
    <div className={`flex items-center ${containerClass} ${className}`}>
      {buttons.map(({ direction, enabled, label, Icon }) => (
        <button
          key={direction}
          type="button"
          title={label}
          aria-label={`${label}: ${itemLabel}`}
          aria-disabled={!enabled}
          onClick={() => { if (enabled) onMove(direction); }}
          className={`max-md:inline-flex md:flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 ${desktopButtonClass} rounded-lg transition-colors ${
            enabled ? 'text-slate-500 hover:text-slate-700 hover:bg-slate-100' : 'text-slate-300 cursor-default'
          }`}
        >
          <Icon className="w-4 h-4" />
        </button>
      ))}
    </div>
  );
};
