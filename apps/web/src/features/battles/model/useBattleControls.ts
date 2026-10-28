import { useEffect, useState } from 'react';
import { Action, Battle } from '@game/core';
import { useFieldSelection } from '../../battlefield/model/useFieldSelection';

export function useBattleControls(battle: Battle, characterId: string, busy: boolean, onCommand: (action: Action) => void) {
  const [targetId, setTargetId] = useState('');
  const [allyId, setAllyId] = useState('');
  const me = battle.fighters.find(fighter => fighter.id === characterId);
  const active = battle.fighters.find(fighter => fighter.id === battle.activeId);
  const myTurn = !!me && battle.status === 'active' && battle.activeId === me.id;

  useEffect(() => {
    if (!battle.fighters.some(fighter => fighter.id === targetId && fighter.hp > 0 && fighter.team !== me?.team)) {
      setTargetId(battle.fighters.find(fighter => fighter.hp > 0 && fighter.team !== me?.team)?.id ?? '');
    }
  }, [battle, me?.team, targetId]);

  const { selected, tileClick } = useFieldSelection(myTurn && battle.phase === 'before' && !busy, battle.version, characterId, (from, to) => onCommand({ type: 'swap', from, to, targetId }));

  const healTarget = battle.fighters.find(fighter => fighter.id === allyId && fighter.hp > 0 && fighter.team === me?.team)?.id ?? me?.id;
  return { selected, targetId, setTargetId, setAllyId, me, active, myTurn, healTarget, tileClick };
}
