import { Character, Fighter, elementNames, elements } from '@game/core';
import { symbols } from './game-labels';

export function EnergyPanel({ character, fighter }: { character?: Character; fighter?: Fighter }) {
  return <section className="panel legend">
    <div className="section-label">ПЯТЬ ИСТОЧНИКОВ СИЛЫ</div>
    {elements.map(element => <div key={element}>
      <span className={`element-icon ${element}`}>{symbols[element]}</span><span>{elementNames[element]}</span>
      <b>{fighter?.energy[element] ?? character?.energy[element] ?? 0}<small> / {fighter?.stats.maxEnergy ?? character?.stats.maxEnergy ?? 30}</small></b>
    </div>)}
    <p className="hint">Каждая удалённая фишка даёт +1 энергии своей стихии. Энергия расходуется на навыки.</p>
  </section>;
}
