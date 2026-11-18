import type { Fighter } from '@game/core';
import type { BattleScreenProps } from '../model/battle-screen';

interface Props extends Pick<BattleScreenProps, 'battle' | 'characterId' | 'hasCharacter' | 'busy' |
  'canChallenge' | 'challengePending' | 'onChallenge' | 'onJoin' | 'onStart' | 'onCancel'> {
  me?: Fighter;
}

export function BattleLobbyActions({ battle, characterId, hasCharacter, busy, me, canChallenge,
  challengePending, onChallenge, onJoin, onStart, onCancel }: Props) {
  if (battle.status !== 'waiting') return null;
  return <div className="lobby-actions">
        {battle.kind === 'duel' ? !me ? <button className="primary" disabled={busy || !hasCharacter || !canChallenge || challengePending} onClick={onChallenge}>{challengePending ? 'Вызов отправлен' : 'Бросить вызов'}</button>
          : <p role="status">Комната доступна другим игрокам. Ожидаем вызовов.</p> : !me ? <>{(battle.kind === 'bot' ? [] : [0, 1]).filter(team => battle.kind !== 'dungeon' || team === 0).map(team =>
          <button key={team} disabled={!hasCharacter || busy} onClick={() => onJoin(team)}>Вступить в команду {team + 1}</button>)}</>
          : <button className="primary" disabled={busy} onClick={onStart}>Начать бой →</button>}
        {battle.fighters[0]?.characterId === characterId && <button className="ghost" disabled={busy} onClick={onCancel}>Отменить комнату</button>}
        <p className="hint">{battle.kind === 'duel' ? 'Владелец комнаты получает вызов и принимает его или отклоняет. Бой начинается сразу после принятия.' : battle.kind === 'bot' ? 'Играй один: бот получит характеристики и навыки твоего героя и будет ходить автоматически.' : battle.kind === 'dungeon' ? 'Можно играть одному или пригласить ещё двух героев.' : 'Другой игрок открывает приглашение и выбирает своего персонажа.'}</p>
      </div>;
}
