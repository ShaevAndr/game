import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Board, Cell, tileTypeNames } from '@game/core';
import { symbols } from '../../../shared/ui/game-labels';
import { FieldMotion, MovingTile } from '../model/field-playback';
import '../battlefield.css';

interface Props { board: Board; enabled: boolean; selected: Cell | null; onTile: (row: number, col: number) => void; phaseLabel: string; motion?: FieldMotion; children?: ReactNode }
function Tile({ tile, cols, rows, gap, motion, enabled, selected, onTile }: { tile: MovingTile; cols: number; rows: number; gap: number; motion?: FieldMotion; enabled: boolean; selected: Cell | null; onTile: Props['onTile'] }) {
  const ref = useRef<HTMLButtonElement>(null);
  const { row, col, fromRow, fromCol, removed } = tile;
  const stage = motion?.stage, duration = motion?.duration;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !stage || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const frames = stage === 'remove'
      ? removed ? [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.3)' }] : []
      : [{ transform: `translate(calc(${fromCol - col} * (100% + ${gap}px)), calc(${fromRow - row} * (100% + ${gap}px)))` }, { transform: 'translate(0, 0)' }];
    if (!frames.length) return;
    const animation = element.animate(frames, { duration, easing: stage === 'fall' ? 'cubic-bezier(.32,.05,.64,1)' : 'ease-in-out', fill: 'both' });
    return () => animation.cancel();
  }, [row, col, fromRow, fromCol, removed, stage, duration, gap]);
  const isSelected = selected?.row === row && selected?.col === col;
  return <button ref={ref} className={`tile ${tile.element} ${isSelected ? 'selected' : ''} ${removed ? 'removing' : ''}`}
    style={{ left: `calc(${100 * col / cols}% + ${gap / 2}px)`, top: `calc(${100 * row / rows}% + ${gap / 2}px)`, width: `calc(${100 / cols}% - ${gap}px)`, height: `calc(${100 / rows}% - ${gap}px)` }}
    aria-label={`${tileTypeNames[tile.element]}, строка ${row + 1}, столбец ${col + 1}`}
    aria-pressed={isSelected} disabled={!enabled} onClick={() => onTile(row, col)}>
    <span style={cols > 10 ? { fontSize: cols > 20 ? 7 : cols > 16 ? 10 : 14 } : undefined}>{symbols[tile.element]}</span>
  </button>;
}
export function BattlefieldBoard({ board, enabled, selected, onTile, phaseLabel, motion, children }: Props) {
  const rows = board.length, cols = board[0]?.length ?? 0;
  const gap = Math.max(1, Math.min(5, Math.floor(40 / cols)));
  const tiles = motion?.tiles ?? board.flatMap((row, r) => row.map((element, c) => ({ id: `static-${r}-${c}`, element, row: r, col: c, fromRow: r, fromCol: c })));
  return <section className="panel board-panel battlefield-panel">
    <div className="section-heading"><div className="section-label">ПОЛЕ СТИХИЙ · {rows} × {cols}</div><span className="turn-badge" role="status">{phaseLabel}</span></div>
    <div className={`board ${!enabled ? 'inactive' : ''}`} aria-label={`Игровое поле ${rows} × ${cols}`} aria-busy={!!motion}>
      <div className="board-surface" style={{ aspectRatio: `${cols} / ${rows}` }}>
        {tiles.map(tile => <Tile key={tile.id} tile={tile} cols={cols} rows={rows} gap={gap} motion={motion} enabled={enabled} selected={selected} onTile={onTile}/>)}
      </div>
    </div>
    <p className="hint board-help">Нажми две соседние фишки. Первое совпадение и каскады учитываются отдельно.</p>
    {children}
  </section>;
}
