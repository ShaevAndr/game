import { Character, Fighter, skillEnergy, totalEnergy } from '@game/core';
import { SkillEnergy } from './SkillEnergy';

export function EnergyPanel({ character, fighter }: { character?: Character; fighter?: Fighter }) {
  return <section className="panel legend">
    <div className="section-label">ОБЩАЯ ЭНЕРГИЯ</div>
    <SkillEnergy value={fighter ? skillEnergy(fighter) : character ? totalEnergy(character.energy) : 0}/>
    <p className="hint">Один запас для всех умений. После прямого сокращения выберите навык и цель. Затем каскады пополнят оставшуюся энергию; прямая защита даёт временный бонус.</p>
  </section>;
}
