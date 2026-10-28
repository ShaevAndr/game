import type { ReactNode } from 'react';
import { Board, Cell, tileTypeNames } from '@game/core';
import { symbols } from '../../../shared/ui/game-labels';
import '../battlefield.css';

interface Props { board: Board; enabled: boolean; selected: Cell | null; onTile: (row: number, col: number) => void; phaseLabel: string; children?: ReactNode }
export function BattlefieldBoard({ board, enabled, selected, onTile, phaseLabel, children }: Props) {
  const rows = board.length, cols = board[0]?.length ?? 0;
  return <section className="panel board-panel battlefield-panel">
    <div className="section-heading"><div className="section-label">ПОЛЕ СТИХИЙ · {rows} × {cols}</div><span className="turn-badge">{phaseLabel}</span></div>
    <div className={`board ${!enabled ? 'inactive' : ''}`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: Math.max(1, Math.min(5, Math.floor(40 / cols))) }} aria-label={`Игровое поле ${rows} × ${cols}`}>
      {board.flatMap((row, rowIndex) => row.map((element, colIndex) => <button
        key={`${rowIndex}-${colIndex}`} className={`tile ${element} ${selected?.row === rowIndex && selected?.col === colIndex ? 'selected' : ''}`}
        aria-label={`${tileTypeNames[element]}, строка ${rowIndex + 1}, столбец ${colIndex + 1}`}
        aria-pressed={selected?.row === rowIndex && selected?.col === colIndex} disabled={!enabled} onClick={() => onTile(rowIndex, colIndex)}>
        <span style={cols > 10 ? { fontSize: cols > 20 ? 7 : cols > 16 ? 10 : 14 } : undefined}>{symbols[element]}</span>
      </button>))}
    </div>
    <p className="hint board-help">Нажми две соседние фишки. Первое совпадение и каскады учитываются отдельно.</p>
    {children}
  </section>;
}
