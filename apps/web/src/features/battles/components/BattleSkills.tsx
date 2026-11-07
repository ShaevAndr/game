import { Action, Battle, Fighter, consumableEffects, isBattleConsumable, skillPower } from '@game/core';
import { symbols } from '../../../shared/ui/game-labels';
import { EffectSkillOption } from './EffectSkillOption';
import '../effects.css';

interface Props { battle: Battle; me?: Fighter; myTurn: boolean; busy: boolean; targetId: string; healTarget?: string; onAlly: (id: string) => void; onEnemy?: (id: string) => void; onCommand: (action: Action) => void; choiceOnly?: boolean }
export function BattleSkills({ battle, me, myTurn, busy, targetId, healTarget, onAlly, onEnemy, onCommand, choiceOnly = false }: Props) {
  const consumables = battle.content.items.filter(item => isBattleConsumable(item, battle.content.itemGroups));
  const visible = battle.content.skills.filter(skill => choiceOnly
    ? me?.id === battle.activeId && battle.skillChoices?.some(choice => choice.skillId === skill.id)
    : me?.skillIds.includes(skill.id));
  const endEnabled = battle.phase === 'choose';
  return <section className="panel skill-panel">
    <div className="section-label">{choiceOnly ? 'ПОСЛЕ ХОДА' : 'АРСЕНАЛ'}</div><h2 id={choiceOnly ? 'battle-skills-title' : undefined}>{choiceOnly ? 'Выберите умение' : 'Умения и предметы'}</h2>
    <p className="hint">{!myTurn ? 'Сейчас ход другого участника.' : battle.phase === 'before'
      ? 'Совместите клетки. После прямого сокращения выберите навык и цель, затем пройдут каскады.'
      : `Начислена энергия прямого сокращения. Сила навыка ×${((battle.matchPowerBps ?? 10000) / 10000).toLocaleString('ru-RU')}. После навыка или пропуска каскады дадут оставшуюся энергию.`}</p>
    {battle.effectsVersion !== 1 && choiceOnly && me && visible.some(skill => skill.effect === 'damage') && <label className="heal-target">Цель атаки<select value={targetId} onChange={event => onEnemy?.(event.target.value)}>
      {battle.fighters.filter(fighter => fighter.hp > 0 && fighter.team !== me.team).map(fighter => <option key={fighter.id} value={fighter.id}>{fighter.name} · {fighter.hp} HP</option>)}
    </select></label>}
    {battle.effectsVersion !== 1 && me && visible.some(skill => skill.effect === 'heal') && <label className="heal-target">Цель лечения<select value={healTarget} onChange={event => onAlly(event.target.value)}>
      {battle.fighters.filter(fighter => fighter.hp > 0 && fighter.team === me.team).map(fighter => <option key={fighter.id} value={fighter.id}>{fighter.name}{fighter.id === me.id ? ' (ты)' : ''}</option>)}
    </select></label>}
    {visible.map(skill => {
      const level = me?.skillLevels?.[skill.id] ?? 1;
      const cooldown = me?.cooldowns[skill.id] ?? 0;
      const choice = battle.skillChoices?.find(choice => choice.skillId === skill.id);
      if (!choiceOnly) return <div key={skill.id} className="skill arsenal-skill">
        <span className={`element-icon ${skill.element}`}>{symbols[skill.element]}</span>
        <span><strong>{skill.name} · ур. {level}</strong><small>{skill.description}</small>
          <small>{!skill.effects?.length && <>Сила {skillPower(skill, level)} · </>}Энергия {skill.cost} · Перезарядка {skill.cooldown} ход.</small>
          {cooldown > 0 && <small>Осталось собственных ходов: {cooldown}</small>}
        </span>
      </div>;
      const enabled = myTurn && !battle.usedSkill && battle.phase === 'choose' && !!choice?.enabled;
      if (battle.effectsVersion === 1 && me && choice) return <EffectSkillOption key={`${skill.id}:${battle.turn}`} battle={battle} actor={me} skill={skill} choice={choice} busy={busy} enabled={enabled} preferredTargetId={skill.effect === 'heal' || choice.targeting?.kind === 'ally_single' ? healTarget ?? me.id : targetId} onCommand={onCommand}/>;
      return <button key={skill.id} title={choice?.reason ?? skill.description} className="skill" disabled={!enabled || busy}
        onClick={() => onCommand({ type: 'skill', skillId: skill.id, targetId: skill.effect === 'heal' ? healTarget! : targetId })}>
        <span className={`element-icon ${skill.element}`}>{symbols[skill.element]}</span>
        <span><strong>{skill.name} · ур. {level}</strong><small>{skill.effect === 'heal' ? 'Лечение союзника' : 'Урон по цели'} · {choice?.magnitude !== undefined ? `${choice.magnitude}${skill.effect === 'damage' ? ' до защиты и крита' : ' HP'}` : `сила ${skillPower(skill, level)}`}{cooldown > 0 ? ` · КД ${cooldown}` : ''}{choice?.reason ? ` · ${choice.reason}` : ''}</small></span><b>{skill.cost}</b>
      </button>;
    })}
    {!choiceOnly && me && <div className="belt-heading">Боевой пояс · {me.inventory.reduce((sum, stack) => sum + stack.quantity, 0)} / 10</div>}
    {!choiceOnly && me && me.inventory.map((stack, index) => {
      const item = consumables.find(item => item.id === stack.itemId);
      if (!item || !stack.quantity) return null;
      return <button key={stack.instanceId ?? index} className="ghost potion"
        disabled={!myTurn || busy || battle.usedSkill || battle.phase !== 'before' || me.hp === me.stats.maxHp && (stack.effects ?? consumableEffects(item)).every(effect => effect.kind === 'heal')}
        onClick={() => onCommand({ type: 'item', itemId: item.id, ...(stack.instanceId ? { instanceId: stack.instanceId } : {}) })}>✚ {item.name} · {item.description} · ×{stack.quantity}</button>;
    })}
    {choiceOnly && <button className="primary end-turn" disabled={!myTurn || busy || !endEnabled} onClick={() => onCommand({ type: 'end' })}>Сохранить энергию и завершить ход →</button>}
  </section>;
}
