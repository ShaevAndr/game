import { Battle, elementNames } from '@game/core';
import { symbols } from '../../../shared/ui/game-labels';

interface Props { battle: Battle; myTurn: boolean; busy: boolean; selected: { row: number; col: number } | null; onTile: (row: number, col: number) => void }

export function BattleBoard({ battle, myTurn, busy, selected, onTile }: Props) {
  return <section className="panel board-panel">
    <div className="section-heading"><div className="section-label">ПОЛЕ СТИХИЙ · 8 × 8</div><span className="turn-badge">
      {battle.status === 'active' ? battle.phase === 'choose' ? 'Выбери навык' : battle.phase === 'after' ? 'Заверши ход' : 'Собери три в ряд' : 'Общее поле'}
    </span></div>
    <div className={`board ${!myTurn || battle.phase !== 'before' ? 'inactive' : ''}`} aria-label="Игровое поле">
      {battle.board.flatMap((row, rowIndex) => row.map((element, colIndex) => <button
        key={`${rowIndex}-${colIndex}`}
        className={`tile ${element} ${selected?.row === rowIndex && selected?.col === colIndex ? 'selected' : ''}`}
        aria-label={`${elementNames[element]}, строка ${rowIndex + 1}, столбец ${colIndex + 1}`}
        aria-pressed={selected?.row === rowIndex && selected?.col === colIndex}
        disabled={!myTurn || busy || battle.phase !== 'before'} onClick={() => onTile(rowIndex, colIndex)}>
        <span>{symbols[element]}</span>
      </button>))}
    </div>
    <p className="hint board-help">Нажми две соседние фишки. Линии от трёх и каскады заполняют энергию.</p>
  </section>;
}
