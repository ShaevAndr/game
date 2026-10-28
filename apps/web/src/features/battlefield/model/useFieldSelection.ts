import { useEffect, useState } from 'react';
import { Cell } from '@game/core';

export function useFieldSelection(enabled: boolean, version: number, resetKey: string, onSwap: (from: Cell, to: Cell) => void) {
  const [selected, setSelected] = useState<Cell | null>(null);
  useEffect(() => { setSelected(null); }, [version, resetKey]);
  function tileClick(row: number, col: number) {
    if (!enabled) return;
    const next = { row, col };
    if (!selected) { setSelected(next); return; }
    if (row === selected.row && col === selected.col) { setSelected(null); return; }
    if (Math.abs(row - selected.row) + Math.abs(col - selected.col) !== 1) { setSelected(next); return; }
    onSwap(selected, next); setSelected(null);
  }
  return { selected, tileClick };
}
