import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountSession } from '@game/core';
import { ArenaNotifications } from '../features/arena/components/ArenaNotifications';
import { useArenaActions } from '../features/arena/model/useArenaActions';
import { InventoryPage } from '../features/inventory/InventoryPage';
import { PartyPanel } from '../features/parties/PartyPanel';
import type { useParty } from '../features/parties/model/useParty';
import { useAsyncAction } from '../shared/model/useAsyncAction';
import { ErrorNotice } from '../shared/ui/ErrorNotice';
import { Modal } from '../shared/ui/Modal';
import { GameHeader } from './components/GameHeader';
import { GamePage } from './GamePage';
import { useGameData } from './model/useGameData';
import { useNavigation, type GameScreen } from './useNavigation';

interface Props {
  session: AccountSession;
  sessionBusy: boolean;
  sessionError: string;
  party: ReturnType<typeof useParty>;
  onCharacters: () => void;
  onAccount: () => void;
}

export function GameApp({ session, sessionBusy, sessionError, party, onCharacters, onAccount }: Props) {
  const { screen, roomId, openRoom, openScreen } = useNavigation();
  const [error, setError] = useState('');
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [partyOpen, setPartyOpen] = useState(false);
  const game = useGameData(session.characterId!, setError);
  const { busy, perform } = useAsyncAction(setError, game.recover);
  const onRoom = useCallback((id: string) => { setError(''); openRoom(id); }, [openRoom]);
  const onNavigate = useCallback((next: GameScreen) => {
    setError('');
    if (next === 'inventory' && screen === 'world') setInventoryOpen(true);
    else openScreen(next);
  }, [screen, openScreen]);
  const arenaActions = useArenaActions({ characterId: game.characterId, run: perform, refreshArena: game.refreshArena, onRoom });
  const enteredBattleId = useRef<string | null>(null);
  useEffect(() => {
    const activeId = game.arena?.activeBattleId;
    if (!activeId || enteredBattleId.current === activeId) return;
    enteredBattleId.current = activeId;
    if (activeId !== roomId) onRoom(activeId);
  }, [game.arena?.activeBattleId, roomId, onRoom]);
  useEffect(() => { if (screen !== 'world') setInventoryOpen(false); }, [screen]);

  return <div className={`app${roomId && screen === 'arena' ? ' is-battle' : ''}`}>
    <GameHeader screen={screen} accountName={session.account.name} characterName={game.character?.name}
      partySize={party.state?.party?.members.length} busy={busy || sessionBusy} onNavigate={onNavigate}
      onParty={() => setPartyOpen(true)} onCharacters={onCharacters} onAccount={onAccount}/>
    <main>
      <ErrorNotice message={error || sessionError} onDismiss={() => setError('')}/>
      {(screen !== 'arena' || roomId) && <ArenaNotifications arena={game.arena} roomId={roomId}
        busy={busy} onRoom={onRoom} onAccept={arenaActions.accept} onDismiss={arenaActions.dismiss}/>}
      <div className="screen-content">
        <GamePage screen={screen} roomId={roomId} session={session} game={game} party={party}
          arenaActions={arenaActions} busy={busy} run={perform} inventoryOpen={inventoryOpen}
          onError={setError} onRoom={onRoom} onNavigate={onNavigate}/>
      </div>
      {inventoryOpen && screen === 'world' && <Modal title="Инвентарь" wide onClose={() => setInventoryOpen(false)}>
        <ErrorNotice message={error}/>
        <InventoryPage ownerId={game.characterId} characters={game.characters} busy={busy}
          onError={setError} run={perform} onChanged={game.refreshCharacters}/>
      </Modal>}
      {partyOpen && <PartyPanel party={party} playerId={session.account.id} characterId={game.characterId}
        onClose={() => setPartyOpen(false)}/>}
    </main>
  </div>;
}
