import { skillEnergy, type Battle, type Fighter } from '@game/core';
import { SkillEnergy } from '../../../shared/ui/SkillEnergy';
import { ActiveEffects } from './ActiveEffects';

interface Props {
  fighter: Fighter; battle: Battle; mine: boolean; opponent: boolean; selected: boolean;
  onTarget: () => void; onInspect: () => void;
}

export function FighterCard({ fighter, battle, mine, opponent, selected, onTarget, onInspect }: Props) {
  const acting = fighter.id === battle.activeId;
  const shield = (fighter.activeEffects ?? []).reduce((sum, effect) => sum + (effect.kind === 'shield' ? effect.remainingShield ?? 0 : 0), 0);
  return <article className={`combatant-card ${opponent ? 'opponent' : 'ally'} ${acting ? 'is-acting' : ''} ${selected ? 'is-target' : ''} ${fighter.hp === 0 ? 'is-defeated' : ''}`}>
    <div className="combatant-state">{fighter.hp === 0 ? 'ВЫБЫЛ ИЗ БОЯ' : acting ? 'СЕЙЧАС ХОДИТ' : selected ? 'ВЫБРАННАЯ ЦЕЛЬ' : mine ? 'ВАШ ГЕРОЙ' : fighter.npc ? 'ПРОТИВНИК · БОТ' : 'УЧАСТНИК'}</div>
    <button className="combatant-target" aria-label={opponent ? `Выбрать цель: ${fighter.name}` : fighter.name}
      aria-pressed={opponent ? selected : undefined} disabled={opponent && fighter.hp <= 0} onClick={onTarget}>
      <div className={`fighter-portrait ${opponent ? 'portrait-knight' : 'portrait-ranger'}`} aria-hidden="true"><span>{opponent ? '⚔' : '✦'}</span></div>
      <div className="combatant-identity"><strong>{fighter.name}</strong><small>Команда {fighter.team + 1}{mine ? ' · вы' : ''}{fighter.combatLevel ? ` · ур. ${fighter.combatLevel}` : ''}</small></div>
      <div className="combatant-health"><span>Здоровье</span><b>{fighter.hp}<small> / {fighter.stats.maxHp}</small></b></div>
      <div className="hp-track"><i style={{ width: `${100 * fighter.hp / fighter.stats.maxHp}%` }}/></div>
    </button>
    <SkillEnergy value={skillEnergy(fighter)}/>
    {((fighter.guardDefense ?? 0) > 0 || shield > 0) && <div className="combatant-protection">
      {(fighter.guardDefense ?? 0) > 0 && <span title="До следующего собственного хода">⛨ Защита +{fighter.guardDefense}</span>}
      {shield > 0 && <span>◈ Щит {shield} HP</span>}
    </div>}
    <ActiveEffects effects={fighter.activeEffects ?? []} fighters={battle.fighters} definitions={battle.content.statDefinitions ?? []}/>
    <button className="ghost inspect-fighter" onClick={onInspect}>Посмотреть персонажа ↗</button>
  </article>;
}
