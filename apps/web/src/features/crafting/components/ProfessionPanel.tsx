import type { ProfessionView } from '../model/types';
export function ProfessionPanel({ professions }: { professions: ProfessionView[] }) {
  return <section className="profession-panel" aria-label="Профессии">{professions.map(profession => <article key={profession.id}>
    <div><strong>{profession.name}</strong><span>Уровень {profession.level}</span></div>
    <progress max={profession.xpToNext || 1} value={profession.xpToNext ? profession.xp : 1} aria-label={`Опыт: ${profession.name}`}/>
    <small>{profession.level === 100 ? 'Максимальный уровень' : `${profession.xp} / ${profession.xpToNext} опыта`}</small>
  </article>)}</section>;
}
