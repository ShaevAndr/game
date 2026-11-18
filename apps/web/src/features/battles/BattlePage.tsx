import { useEffect } from 'react';
import type { ArenaState } from '@game/core';
import type { ActionRunner } from '../../shared/model/useAsyncAction';
import { arenaApi } from '../arena/api/arena.api';
import { battlesApi } from './api/battles.api';
import { BattleScreen } from './components/BattleScreen';
import { useBattle } from './model/useBattle';

interface Props {
  roomId: string;
  characterId: string;
  hasCharacter: boolean;
  arena: ArenaState | null;
  busy: boolean;
  run: ActionRunner;
  onError: (message: string) => void;
  onRoom: (id: string) => void;
  onChallenge: (id: string) => void;
  onChanged: () => Promise<void>;
  refreshArena: () => Promise<void>;
}

export function BattlePage({ roomId, characterId, hasCharacter, arena, busy, run, onError, onRoom, onChallenge, onChanged, refreshArena }: Props) {
  const { battle, clockOffset, updateBattle, refreshBattle, animating, fieldMotion, missingRoomId } = useBattle(roomId, onError);
  useEffect(() => {
    if (missingRoomId !== roomId) return;
    onRoom('');
    onError('Комната больше недоступна. Возможно, создатель отменил её.');
  }, [roomId, missingRoomId, onRoom, onError]);
  useEffect(() => {
    if (battle?.status === 'finished') void onChanged().catch(error => onError(error.message));
  }, [battle?.id, battle?.status, onChanged, onError]);
  useEffect(() => {
    if (battle?.status === 'waiting' && battle.kind === 'duel') onRoom('');
  }, [battle?.id, battle?.status, battle?.kind, onRoom]);

  const cancel = () => void run(async () => {
    await arenaApi.cancel(roomId, characterId);
    onRoom('');
    await refreshArena();
  }, refreshBattle);

  return <>
    <div className="page-heading">
      <h1>{battle?.name ?? 'Загрузка боя…'}</h1>
      <button className="ghost" onClick={() => onRoom('')}>← Все комнаты</button>
    </div>
    {battle ? <BattleScreen
      key={battle.id} battle={battle} characterId={characterId} hasCharacter={hasCharacter}
      busy={busy || animating} animating={animating} fieldMotion={fieldMotion} clockOffset={clockOffset}
      canChallenge={!!arena && !arena.activeBattleId}
      challengePending={arena?.outgoing.some(offer => offer.battleId === battle.id)}
      onChallenge={() => onChallenge(battle.id)}
      onCommand={action => void run(async () => {
        updateBattle(await battlesApi.command(battle.id, characterId, battle.version, action));
      }, refreshBattle)}
      onJoin={team => void run(async () => updateBattle(await battlesApi.join(battle.id, characterId, team)), refreshBattle)}
      onStart={() => void run(async () => updateBattle(await battlesApi.start(battle.id, characterId, battle.version)), refreshBattle)}
      onCancel={cancel}
      onCopy={() => void run(async () => navigator.clipboard.writeText(location.href), refreshBattle)}
    /> : <section className="panel" role="status">Загрузка боя…</section>}
  </>;
}
