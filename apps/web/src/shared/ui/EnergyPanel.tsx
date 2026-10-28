import { Character, Fighter, ENERGY_CAP, elements, tileTypeNames, tileTypes } from '@game/core';
import { symbols } from './game-labels';

export function EnergyPanel({ character, fighter, legacy = false }: { character?: Character; fighter?: Fighter; legacy?: boolean }) {
  const types = legacy ? elements : tileTypes;
  const maxEnergy = legacy ? fighter?.stats.maxEnergy ?? ENERGY_CAP : ENERGY_CAP;
  return <section className="panel legend">
    <div className="section-label">ЭНЕРГИЯ И ЗАЩИТА</div>
    {types.map(type => <div key={type}>
      <span className={`element-icon ${type}`}>{symbols[type]}</span><span>{type === 'defense' ? 'Энергия защиты' : tileTypeNames[type]}</span>
      <b>{fighter?.energy[type] ?? character?.energy[type] ?? 0}<small> / {maxEnergy}</small></b>
    </div>)}
    <p className="hint">{legacy ? 'Совпадения дают энергию по правилам этого боя.' : 'Прямые и вторичные совпадения дают энергию. Прямая защита даёт временный бонус, вторичная — энергию защиты. Навык выбирается после всех сокращений.'}</p>
  </section>;
}
