import { useState } from 'react';
import type { Account } from '@game/core';

interface Props { accounts: Account[]; ready: boolean; busy: boolean; error: string; onChoose: (id: string) => void; onCreate: (name: string) => Promise<boolean>; onRefresh: () => void }
export function AccountSelectionScreen({ accounts, ready, busy, error, onChoose, onCreate, onRefresh }: Props) {
  const [name, setName] = useState('');
  return <div className="entry-page"><header className="entry-brand"><span>✦</span> СТИХИИ</header><main className="entry-main">
    <div className="eyebrow">01 / АККАУНТ → 02 / ПЕРСОНАЖ → 03 / ИГРА</div>
    <h1>Выбери аккаунт</h1><p className="entry-intro">У каждого аккаунта свои герои и прогресс.</p>
    {error && <div className="error" role="alert">{error}<button className="ghost" disabled={busy} onClick={onRefresh}>Обновить</button></div>}
    {!ready ? <p role="status">Загрузка аккаунтов…</p> : <div className="account-grid">{accounts.map((account, index) => <button key={account.id} disabled={busy} className="account-card" onClick={() => onChoose(account.id)}>
      <span className="account-emblem" aria-hidden="true">{['✧', '◈', '⬡'][index % 3]}</span><strong>{account.name}</strong><small>Выбрать персонажа →</small>
    </button>)}</div>}
    {ready && accounts.length === 0 && !error && <p className="hint">Пока нет аккаунтов. Создай первый.</p>}
    <form className="panel account-create" onSubmit={event => { event.preventDefault(); void onCreate(name).then(created => { if (created) setName(''); }); }}>
      <h2>Новый аккаунт</h2><div className="inline-form"><input aria-label="Имя аккаунта" placeholder="Имя аккаунта" minLength={2} maxLength={32} required disabled={busy || !ready} value={name} onChange={event => setName(event.target.value)}/><button className="primary" disabled={busy || !ready || name.trim().length < 2}>Создать →</button></div>
    </form>
  </main></div>;
}
