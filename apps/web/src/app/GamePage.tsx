import { lazy, Suspense } from 'react';
import type { AccountSession } from '@game/core';
import { ArenaPage } from '../features/arena/ArenaPage';
import type { useArenaActions } from '../features/arena/model/useArenaActions';
import { BattlePage } from '../features/battles/BattlePage';
import { AttributesPage } from '../features/characters/AttributesPage';
import { CraftingPage } from '../features/crafting/CraftingPage';
import { GatheringPage } from '../features/gathering/GatheringPage';
import { InventoryPage } from '../features/inventory/InventoryPage';
import type { useParty } from '../features/parties/model/useParty';
import { SkillsPage } from '../features/skills/SkillsPage';
import type { ActionRunner } from '../shared/model/useAsyncAction';
import type { useGameData } from './model/useGameData';
import type { GameScreen } from './useNavigation';

const WorldPage = lazy(() => import('../features/world/WorldPage').then(module => ({ default: module.WorldPage })));

interface Props {
  screen: GameScreen;
  roomId: string;
  session: AccountSession;
  game: ReturnType<typeof useGameData>;
  party: ReturnType<typeof useParty>;
  arenaActions: ReturnType<typeof useArenaActions>;
  busy: boolean;
  run: ActionRunner;
  inventoryOpen: boolean;
  onError: (message: string) => void;
  onRoom: (id: string) => void;
  onNavigate: (screen: GameScreen) => void;
}

/** Routes compose pages; feature loading and commands belong to each page. */
export function GamePage({ screen, roomId, session, game, party, arenaActions, busy, run, inventoryOpen, onError, onRoom, onNavigate }: Props) {
  const { characterId, character, characters, content, arena, refreshCharacters, updateCharacter, refreshArena } = game;
  const actions = { busy, run, onError, onChanged: refreshCharacters };
  switch (screen) {
    case 'inventory':
      return <InventoryPage ownerId={characterId} characters={characters} {...actions}/>;
    case 'attributes':
      return <AttributesPage character={character} content={content} busy={busy} run={run} onCharacter={updateCharacter}/>;
    case 'skills':
      return <SkillsPage character={character} content={content} busy={busy} run={run} onCharacter={updateCharacter}/>;
    case 'crafting':
      return <CraftingPage ownerId={characterId} {...actions}/>;
    case 'gathering':
      return <GatheringPage ownerId={characterId} {...actions}
        onCrafting={() => onNavigate('crafting')} onInventory={() => onNavigate('inventory')}/>;
    case 'world':
      return <Suspense fallback={<section className="panel" role="status">Загрузка мира…</section>}>
        <WorldPage playerId={session.account.id} characterId={characterId}
          party={party.state?.party ?? null} partyReady={!!party.state} partyBusy={party.busy || party.pending}
          inventoryOpen={inventoryOpen} content={content} onChanged={refreshCharacters}
          onInventory={() => onNavigate('inventory')} onCrafting={() => onNavigate('crafting')}
          onGathering={() => onNavigate('gathering')}/>
      </Suspense>;
    case 'arena':
      return roomId ? <BattlePage key={roomId}
        roomId={roomId} characterId={characterId} hasCharacter={!!character} arena={arena}
        {...actions} onRoom={onRoom} onChallenge={arenaActions.challenge} refreshArena={refreshArena}/>
        : <ArenaPage characterId={characterId} hasCharacter={!!character} arena={arena}
          actions={arenaActions} busy={busy} run={run} onError={onError} onRoom={onRoom} refreshArena={refreshArena}/>;
  }
}
