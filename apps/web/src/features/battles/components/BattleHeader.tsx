import type { Fighter } from '@game/core';
import type { BattleScreenProps } from '../model/battle-screen';
import { BattleRewards } from './BattleRewards';
import { BattleLobbyActions } from './BattleLobbyActions';

interface Props extends Omit<BattleScreenProps, 'onCommand' | 'fieldMotion' | 'clockOffset'> {
  me?: Fighter;
  active?: Fighter;
  myTurn: boolean;
  seconds?: number;
  onSurrender: () => void;
}

export function BattleHeader({ battle, characterId, hasCharacter, busy, animating, me, active, myTurn,
  seconds, canChallenge, challengePending, onSurrender, onChallenge, onJoin, onStart, onCancel, onCopy }: Props) {
  return <section className="panel battle-top">
      <div className="section-heading"><div>
        <div className="section-label">АРЕНА СТИХИЙ · ХОД {battle.turn || '—'}</div>
        <h2>{battle.status === 'waiting' ? 'Сбор участников' : battle.status === 'finished' ? battle.winner === null ? 'Бой завершён' : `Победа команды ${battle.winner + 1}` : myTurn ? 'Твой ход' : `Ход: ${active?.name}`}</h2>
        {battle.kind === 'dungeon' && <p>Волна {battle.wave} из {battle.totalWaves}</p>}
      </div><div className="battle-header-actions">
      {battle.status === 'active' && <>
        {seconds !== undefined && !animating && <span className={`turn-timer ${seconds <= 5 ? 'urgent' : ''}`} role="timer" aria-label="Осталось времени на ход">⏱ {seconds} с</span>}
        {me && me.hp > 0 && <button className="ghost surrender-button" disabled={busy} onClick={() => onSurrender()}>Закончить бой</button>}
      </>}
      <button className="ghost" onClick={onCopy}>Скопировать приглашение ↗</button></div></div>
      <BattleRewards battle={battle} characterId={characterId}/>
      <BattleLobbyActions battle={battle} characterId={characterId} hasCharacter={hasCharacter}
        busy={busy} me={me} canChallenge={canChallenge} challengePending={challengePending}
        onChallenge={onChallenge} onJoin={onJoin} onStart={onStart} onCancel={onCancel}/>
    </section>;
}
