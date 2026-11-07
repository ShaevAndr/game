import { useState } from 'react';
import type { Action, Battle, Fighter, Skill, SkillChoice } from '@game/core';
import { symbols } from '../../../shared/ui/game-labels';
import { effectValue, targetingLabels } from '../../../shared/ui/effect-labels';

interface Props { battle: Battle; actor: Fighter; skill: Skill; choice: SkillChoice; busy: boolean; enabled: boolean; preferredTargetId: string; onCommand: (action: Action) => void }
export function EffectSkillOption({ battle, actor, skill, choice, busy, enabled, preferredTargetId, onCommand }: Props) {
  const [selectedId, setSelectedId] = useState('');
  const ids = choice.targetIds ?? [];
  const targetId = ids.includes(selectedId) ? selectedId : ids.includes(preferredTargetId) ? preferredTargetId : ids[0] ?? '';
  const kind = choice.targeting?.kind ?? 'enemy_single';
  const multiple = kind === 'allies_all' || kind === 'enemies_all';
  const previews = (choice.effectPreviews ?? []).filter(effect => effect.targetId === targetId || multiple
    || effect.targetId === actor.id && skill.effects?.find(definition => definition.id === effect.effectId)?.recipient === 'caster');
  const damagePreviews = (choice.damagePreviews ?? []).filter(preview => multiple || preview.targetId === targetId);
  const chanceText = (preview: { hitChanceBps?: number; luckAvoidChanceBps?: number }) => preview.hitChanceBps === undefined ? ''
    : ` · попадание ${preview.hitChanceBps / 100}% · уход по удаче ${(preview.luckAvoidChanceBps ?? 0) / 100}%`;
  const level = actor.skillLevels?.[skill.id] ?? 1;
  return <div className="effect-skill-option">
    {(kind === 'ally_single' || kind === 'enemy_single') && <label>Цель: {skill.name}<select value={targetId} disabled={busy || !enabled || !ids.length} aria-label={`Цель навыка ${skill.name}`} onChange={event => setSelectedId(event.target.value)}>
      {!ids.length && <option value="">Нет допустимой цели</option>}
      {ids.map(id => <option key={id} value={id}>{battle.fighters.find(fighter => fighter.id === id)?.name ?? id}{id === actor.id ? ' (ты)' : ''}</option>)}
    </select></label>}
    <button className="skill" disabled={busy || !enabled} title={choice.reason ?? skill.description} onClick={() => onCommand({ type: 'skill', skillId: skill.id, targetId: multiple ? '' : targetId })}>
      <span className={`element-icon ${skill.element}`}>{symbols[skill.element]}</span><span><strong>{skill.name} · ур. {level}</strong>
        <small>{targetingLabels[kind]} · Перезарядка {skill.cooldown} ход.{(actor.cooldowns[skill.id] ?? 0) > 0 ? ` · Осталось ${actor.cooldowns[skill.id]}` : ''}{choice.magnitude !== undefined ? ` · ${choice.magnitude}${skill.effect === 'damage' ? ' до защиты и крита' : ' HP'}` : ''}</small>
        {damagePreviews.map(preview => <small key={preview.targetId}>{chanceText(preview).slice(3)}</small>)}
        {previews.map(effect => <small key={`${effect.effectId}:${effect.targetId}`}>{effect.kind === 'stat_modifier'
          ? `${battle.content.statDefinitions?.find(definition => definition.id === effect.statId)?.name ?? effect.statId} ${effectValue(effect.operation!, effect.magnitude!, effect.unit!)} · ${effect.durationTurns} ход.`
          : effect.kind === 'stun' ? `Пропуск хода · ${effect.durationTurns} ход.` : effect.kind === 'dispel' ? 'Снятие эффектов' : `${effect.kind === 'damage' ? 'Урон до защиты и крита' : 'Лечение'}: ${effect.magnitude}`}{effect.activationChanceBps !== undefined ? ` · срабатывание ${effect.activationChanceBps / 100}%` : ''}{chanceText(effect)}</small>)}
        {choice.reason && <small>{choice.reason}</small>}
      </span><b>{skill.cost}</b>
    </button>
  </div>;
}
