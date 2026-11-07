import type { Account, Character, Content } from '@game/core';
import { CharacterCreation } from './CharacterCreation';

interface Props { account: Account; characters: Character[]; content: Content | null; loading: boolean; busy: boolean; error: string; onChoose: (id: string) => void; onAccount: () => void; onRefresh: () => void; onCreate: (name: string, templateId?: string) => Promise<boolean> }
export function CharacterSelectionScreen({ account, characters, content, loading, busy, error, onChoose, onAccount, onRefresh, onCreate }: Props) {
  return <div className="entry-page"><header className="entry-brand"><span>✦</span> СТИХИИ<button className="ghost" disabled={busy} onClick={onAccount}>Сменить аккаунт</button></header><main className="entry-main">
    <div className="eyebrow">01 / {account.name} → 02 / ПЕРСОНАЖ → 03 / ИГРА</div>
    <h1>Выбери своего героя</h1><p className="entry-intro">Персонажи аккаунта «{account.name}»</p>
    {error && <div className="error" role="alert">{error}<button className="ghost" disabled={busy} onClick={onRefresh}>Повторить</button></div>}
    {loading ? <p role="status">Загрузка персонажей…</p> : <div className="character-grid">{characters.map(hero => <button key={hero.id} className="character-choice-card" disabled={busy} onClick={() => onChoose(hero.id)}>
      <div className="character-choice-top"><span className="avatar" aria-hidden="true">{hero.name[0].toUpperCase()}</span><span className="character-level">УРОВЕНЬ {hero.level}</span></div>
      <h2>{hero.name}</h2><p>{content?.characterTemplates.find(template => template.id === hero.templateId)?.name ?? 'Странник'}</p>
      <div className="character-choice-points"><span>Навыки <b>{hero.skillPoints}</b></span><span>Характеристики <b>{hero.attributePoints ?? 0}</b></span></div>
      <strong className="character-play">Играть →</strong>
    </button>)}</div>}
    {!loading && characters.length === 0 && !error && <p className="empty">У этого аккаунта пока нет героев. Создай первого персонажа.</p>}
    <section className="panel character-selection-create"><h2>Создать персонажа</h2><CharacterCreation content={content} busy={busy || loading} onCreate={onCreate}/></section>
  </main></div>;
}
