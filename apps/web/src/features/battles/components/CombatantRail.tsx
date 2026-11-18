import type { Battle } from '@game/core';
import { FighterCard } from './FighterCard';

interface Props {
  battle: Battle;
  alliedTeam: number;
  mineId?: string;
  targetId: string;
  opponent?: boolean;
  onTarget: (id: string) => void;
  onInspect: (id: string) => void;
}

export function CombatantRail({ battle, alliedTeam, mineId, targetId, opponent = false, onTarget, onInspect }: Props) {
  const fighters = battle.fighters.filter(fighter => opponent ? fighter.team !== alliedTeam : fighter.team === alliedTeam);
  return <aside className={`combatant-rail ${opponent ? 'enemies-rail' : 'allies-rail'}`}
    aria-label={opponent ? 'Команда противника' : 'Ваша команда'}>
    <div className="rail-heading"><span>{opponent ? '⚔' : '✦'}</span> {opponent ? 'ПРОТИВНИК' : 'ВАША КОМАНДА'}</div>
    {fighters.map(fighter => <FighterCard key={fighter.id} fighter={fighter} battle={battle}
      mine={fighter.id === mineId} opponent={opponent} selected={fighter.id === targetId}
      onTarget={() => { if (opponent && fighter.hp > 0) onTarget(fighter.id); }}
      onInspect={() => onInspect(fighter.id)}/>)}
    {opponent && !fighters.length && <div className="opponent-pending"><span>⚔</span><p>Ожидаем соперника</p></div>}
  </aside>;
}
