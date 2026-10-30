import type { ActiveEffect, Fighter, StatDefinition } from '@game/core';
import { effectValue } from '../../../shared/ui/effect-labels';
import '../effects.css';

interface Props { effects: ActiveEffect[]; fighters: Fighter[]; definitions: StatDefinition[] }
export function ActiveEffects({ effects, fighters, definitions }: Props) {
  if (!effects.length) return null;
  return <div className="active-effects" aria-label="Действующие эффекты">{effects.map(effect => {
    const stat = definitions.find(definition => definition.id === effect.statId)?.name ?? effect.statId;
    const polarity = effect.polarity === 'buff' ? 'баф' : effect.polarity === 'debuff' ? 'дебаф' : 'эффект';
    return <details className={`active-effect ${effect.polarity}`} key={effect.instanceId}>
      <summary aria-label={`${effect.name}, ${polarity}, осталось ходов: ${effect.remainingTurns}`} title={`${effect.name}: ${stat} ${effectValue(effect.operation, effect.magnitude * effect.stacks, effect.unit)}`}>
        <span aria-hidden="true">{effect.polarity === 'buff' ? '↑' : effect.polarity === 'debuff' ? '↓' : '◇'}</span><span>{effect.name}</span><b>{effect.remainingTurns}</b>{effect.stacks > 1 && <small>×{effect.stacks}</small>}
      </summary>
      <div className="effect-description"><strong>{stat}: {effectValue(effect.operation, effect.magnitude * effect.stacks, effect.unit)}</strong>
        <span>Источник: {fighters.find(fighter => fighter.id === effect.sourceFighterId)?.name ?? effect.sourceName ?? effect.sourceFighterId} · ур. навыка {effect.sourceRank}</span>
        <span>Осталось собственных ходов: {effect.remainingTurns}</span><span>Стэков: {effect.stacks} / {effect.maxStacks}</span>
        <span>{effect.dispellable ? 'Можно снять подходящим умением' : 'Не снимается очищением'}</span></div>
    </details>;
  })}</div>;
}
