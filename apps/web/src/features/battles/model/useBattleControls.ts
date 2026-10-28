import { useEffect, useState } from 'react';
import { Action, Battle } from '@game/core';

export function useBattleControls(battle: Battle, characterId: string, busy: boolean, onCommand: (action: Action) => void) {
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const [targetId, setTargetId] = useState('');
  const [allyId, setAllyId] = useState('');
  const me = battle.fighters.find(fighter => fighter.id === characterId);
  const active = battle.fighters.find(fighter => fighter.id === battle.activeId);
  const myTurn = !!me && battle.status === 'active' && battle.activeId === me.id;

  useEffect(() => { setSelected(null); }, [battle.version, characterId]);
  useEffect(() => {
    if (!battle.fighters.some(fighter => fighter.id === targetId && fighter.hp > 0 && fighter.team !== me?.team)) {
      setTargetId(battle.fighters.find(fighter => fighter.hp > 0 && fighter.team !== me?.team)?.id ?? '');
    }
  }, [battle, me?.team, targetId]);

  function tileClick(row: number, col: number) {
    if (!myTurn || battle.phase !== 'before' || busy) return;
    if (!selected) { setSelected({ row, col }); return; }
    if (row === selected.row && col === selected.col) { setSelected(null); return; }
    if (Math.abs(row - selected.row) + Math.abs(col - selected.col) !== 1) { setSelected({ row, col }); return; }
    onCommand({ type: 'swap', from: selected, to: { row, col }, targetId });
    setSelected(null);
  }

  const healTarget = battle.fighters.find(fighter => fighter.id === allyId && fighter.hp > 0 && fighter.team === me?.team)?.id ?? me?.id;
  return { selected, targetId, setTargetId, setAllyId, me, active, myTurn, healTarget, tileClick };
}
