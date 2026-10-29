import { Character, Fighter, ENERGY_CAP, elements, tileTypeNames, skillEnergy, totalEnergy } from '@game/core';
import { symbols } from './game-labels';
import { SkillEnergy } from './SkillEnergy';

export function EnergyPanel({ character, fighter, legacy = false }: { character?: Character; fighter?: Fighter; legacy?: boolean }) {
  return <section className="panel legend">
    <div className="section-label">{legacy ? 'ЭНЕРГИЯ' : 'ОБЩАЯ ЭНЕРГИЯ'}</div>
    {legacy ? elements.map(type => <div key={type}>
      <span className={`element-icon ${type}`}>{symbols[type]}</span><span>{tileTypeNames[type]}</span>
      <b>{fighter?.energy[type] ?? character?.energy[type] ?? 0}<small> / {fighter?.stats.maxEnergy ?? ENERGY_CAP}</small></b>
    </div>) : <SkillEnergy value={fighter ? skillEnergy(fighter) : character ? totalEnergy(character.energy) : 0}/>}
    <p className="hint">{legacy ? 'Совпадения дают энергию по правилам этого боя.' : 'Один запас для всех умений. Совпадения любых типов пополняют энергию; прямая защита даёт временный бонус. После каскадов выберите навык в окне умений.'}</p>
  </section>;
}
