import { Action, Battle, Fighter } from '@game/core';
import { symbols } from '../../../shared/ui/game-labels';

interface Props { battle: Battle; me?: Fighter; myTurn: boolean; busy: boolean; targetId: string; healTarget?: string; onAlly: (id: string) => void; onCommand: (action: Action) => void }

export function BattleSkills({ battle, me, myTurn, busy, targetId, healTarget, onAlly, onCommand }: Props) {
  const potion = battle.content.items.find(item => item.id === 'potion');
  return <section className="panel skill-panel">
    <div className="section-label">АРСЕНАЛ</div><h2>Навыки</h2>
    <p className="hint">{battle.rule === 'on-match' ? `Усиление от фишек: +${battle.pendingMatch * battle.content.balance.damagePerTile}` : 'Один навык или зелье за ход.'}</p>
    {me && <label className="heal-target">Цель лечения<select value={healTarget} onChange={event => onAlly(event.target.value)}>
      {battle.fighters.filter(fighter => fighter.hp > 0 && fighter.team === me.team).map(fighter => <option key={fighter.id} value={fighter.id}>{fighter.name}{fighter.id === me.id ? ' (ты)' : ''}</option>)}
    </select></label>}
    {battle.content.skills.filter(skill => !me || me.skillIds.includes(skill.id)).map(skill => {
      const cooldown = me?.cooldowns[skill.id] ?? 0;
      const enabled = myTurn && !battle.usedSkill && (battle.rule !== 'on-match' || battle.phase === 'choose') && (me?.energy[skill.element] ?? 0) >= skill.cost && cooldown === 0;
      return <button key={skill.id} title={skill.description} className="skill" disabled={!enabled || busy}
        onClick={() => onCommand({ type: 'skill', skillId: skill.id, targetId: skill.effect === 'heal' ? healTarget! : targetId })}>
        <span className={`element-icon ${skill.element}`}>{symbols[skill.element]}</span>
        <span><strong>{skill.name}</strong><small>{skill.effect === 'heal' ? 'Лечение союзника' : 'Урон по цели'} · сила {skill.power}{cooldown > 0 ? ` · КД ${cooldown}` : ''}</small></span><b>{skill.cost}</b>
      </button>;
    })}
    {me && <button className="ghost potion"
      disabled={!myTurn || busy || battle.usedSkill || battle.phase !== 'before' || battle.rule === 'on-match' || me.hp === me.stats.maxHp || !me.inventory.some(item => item.itemId === 'potion' && item.quantity > 0)}
      onClick={() => onCommand({ type: 'item', itemId: 'potion' })}>✚ Выпить зелье · +{potion?.heal ?? 0} HP</button>}
    <button className="primary end-turn" disabled={!myTurn || busy || battle.phase !== 'after'} onClick={() => onCommand({ type: 'end' })}>Завершить ход →</button>
  </section>;
}
