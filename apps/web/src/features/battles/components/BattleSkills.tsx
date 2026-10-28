import { Action, Battle, Fighter, isBattleConsumable, skillPower } from '@game/core';
import { symbols } from '../../../shared/ui/game-labels';

interface Props { battle: Battle; me?: Fighter; myTurn: boolean; busy: boolean; targetId: string; healTarget?: string; onAlly: (id: string) => void; onCommand: (action: Action) => void }
export function BattleSkills({ battle, me, myTurn, busy, targetId, healTarget, onAlly, onCommand }: Props) {
  const modern = battle.combatVersion === 2;
  const consumables = battle.content.items.filter(item => isBattleConsumable(item, battle.content.itemGroups));
  const visible = battle.content.skills.filter(skill => modern
    ? me?.id === battle.activeId && battle.skillChoices?.some(choice => choice.skillId === skill.id)
    : !me || me.skillIds.includes(skill.id));
  const endEnabled = modern ? battle.phase === 'choose' : battle.phase === 'after';
  return <section className="panel skill-panel">
    <div className="section-label">АРСЕНАЛ</div><h2>Навыки</h2>
    <p className="hint">{modern ? !myTurn ? 'Сейчас ход другого участника.' : battle.phase === 'before'
      ? 'Совместите клетки. После всех каскадов появятся навыки только типов прямого совпадения.'
      : 'Энергия уже начислена. Выберите один навык или сохраните энергию и завершите ход.'
      : battle.rule === 'on-match' ? `Усиление от фишек: +${battle.pendingMatch * battle.content.balance.damagePerTile}` : 'Один навык или зелье за ход.'}</p>
    {me && visible.some(skill => skill.effect === 'heal') && <label className="heal-target">Цель лечения<select value={healTarget} onChange={event => onAlly(event.target.value)}>
      {battle.fighters.filter(fighter => fighter.hp > 0 && fighter.team === me.team).map(fighter => <option key={fighter.id} value={fighter.id}>{fighter.name}{fighter.id === me.id ? ' (ты)' : ''}</option>)}
    </select></label>}
    {visible.map(skill => {
      const level = me?.skillLevels?.[skill.id] ?? 1;
      const cooldown = me?.cooldowns[skill.id] ?? 0;
      const choice = battle.skillChoices?.find(choice => choice.skillId === skill.id);
      const enabled = myTurn && !battle.usedSkill && (modern ? battle.phase === 'choose' && !!choice?.enabled
        : (battle.rule !== 'on-match' || battle.phase === 'choose') && (me?.energy[skill.element] ?? 0) >= skill.cost && cooldown === 0);
      return <button key={skill.id} title={choice?.reason ?? skill.description} className="skill" disabled={!enabled || busy}
        onClick={() => onCommand({ type: 'skill', skillId: skill.id, targetId: skill.effect === 'heal' ? healTarget! : targetId })}>
        <span className={`element-icon ${skill.element}`}>{symbols[skill.element]}</span>
        <span><strong>{skill.name} · ур. {level}</strong><small>{skill.effect === 'heal' ? 'Лечение союзника' : 'Урон по цели'} · сила {skillPower(skill, level)}{cooldown > 0 ? ` · КД ${cooldown}` : ''}{choice?.reason ? ` · ${choice.reason}` : ''}</small></span><b>{skill.cost}</b>
      </button>;
    })}
    {me && consumables.map(item => {
      const quantity = me.inventory.filter(stack => stack.itemId === item.id).reduce((total, stack) => total + stack.quantity, 0);
      if (!quantity) return null;
      return <button key={item.id} className="ghost potion"
        disabled={!myTurn || busy || battle.usedSkill || battle.phase !== 'before' || (!modern && battle.rule === 'on-match') || me.hp === me.stats.maxHp}
        onClick={() => onCommand({ type: 'item', itemId: item.id })}>✚ {item.name} · +{item.heal} HP · ×{quantity}</button>;
    })}
    <button className="primary end-turn" disabled={!myTurn || busy || !endEnabled} onClick={() => onCommand({ type: 'end' })}>{modern ? 'Сохранить энергию и завершить ход →' : 'Завершить ход →'}</button>
  </section>;
}
