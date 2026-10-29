import { ENERGY_CAP } from '@game/core';

export function SkillEnergy({ value }: { value: number }) {
  return <div className="skill-energy">
    <div><span>⚡ Энергия умений</span><b>{value}<small> / {ENERGY_CAP}</small></b></div>
    <progress aria-label="Общая энергия умений" max={ENERGY_CAP} value={value}/>
  </div>;
}
