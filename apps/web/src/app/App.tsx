import { Modal } from '../shared/ui/Modal';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AccountSession, Content } from '@game/core';
import { useNavigation } from './useNavigation';
import { useAsyncAction } from './useAsyncAction';
import { useCharacters } from '../features/characters/model/useCharacters';
import { AttributesScreen } from '../features/characters/components/AttributesScreen';
import { charactersApi } from '../features/characters/api/characters.api';
import { contentApi } from '../features/content/api/content.api';
import { SkillTree } from '../features/skills/components/SkillTree';
import { skillsApi } from '../features/skills/api/skills.api';
import { useArena } from '../features/arena/model/useArena';
import { useRooms } from '../features/arena/model/useRooms';
import { ArenaScreen } from '../features/arena/components/ArenaScreen';
import { arenaApi } from '../features/arena/api/arena.api';
import { useBattle } from '../features/battles/model/useBattle';
import { BattleScreen } from '../features/battles/components/BattleScreen';
import { battlesApi } from '../features/battles/api/battles.api';
import { InventoryPage } from '../features/inventory/InventoryPage';
import { GatheringPage } from '../features/gathering/GatheringPage';
import { CraftingPage } from '../features/crafting/CraftingPage';
import '../features/skills/skill-tree.css';
import '../features/identity/identity.css';
import { useAccountSession } from '../features/identity/model/useAccountSession';
import { AccountSelectionScreen } from '../features/identity/components/AccountSelectionScreen';
import { CharacterSelectionPage } from '../features/characters/CharacterSelectionPage';
import { ChatPanel } from '../features/chat/ChatPanel';
import { useParty } from '../features/parties/model/useParty';
import { PartyRoster } from '../features/parties/components/PartyRoster';
import { PartyInvitationDialog } from '../features/parties/components/PartyInvitationDialog';
import '../features/parties/parties.css';
const WorldPage = lazy(() => import('../features/world/WorldPage').then(module => ({ default: module.WorldPage })));

export function App() {
  const identity = useAccountSession();
  const party = useParty(identity.session);
  if (!identity.session) return <AccountSelectionScreen accounts={identity.accounts} ready={identity.ready} busy={identity.busy} error={identity.error}
    onChoose={id => void identity.chooseAccount(id)} onCreate={identity.createAccount} onRefresh={() => void identity.refreshAccounts()}/>;
  return <>
    {!identity.session.characterId ? <CharacterSelectionPage key={`characters:${identity.session.account.id}`} account={identity.session.account} busy={identity.busy} error={identity.error}
      onChoose={id => void identity.selectCharacter(id)} onAccount={() => void identity.logout()}/>
      : <GameApp key={`${identity.session.account.id}:${identity.session.characterId}`} session={identity.session} sessionBusy={identity.busy} sessionError={identity.error}
        onCharacters={() => void identity.selectCharacter(null).then(ok => { if (ok) location.hash = ''; })} onAccount={() => void identity.logout().then(ok => { if (ok) location.hash = ''; })} party={party}/>}
    <ChatPanel key={`chat:${identity.session.account.id}`} session={identity.session} enabled={!!identity.session.characterId} party={party.state?.party ?? null} onInvite={party.invite}
      inviteDisabled={!party.state || party.busy || party.pending || !!party.state.party && (party.state.party.leaderPlayerId !== identity.session.account.id || party.state.party.members.length >= party.state.capacity)}/>
    {identity.session.characterId && party.incoming[0] && <PartyInvitationDialog key={party.incoming[0].id} invitation={party.incoming[0]} serverNow={party.serverNow}
      busy={party.busy} pending={party.pending} error={party.error} onRetry={party.retry}
      onRespond={accept => void party.act({ type: accept ? 'accept' : 'decline', invitationId: party.incoming[0].id })}/>}
  </>;
}

function GameApp({ session, sessionBusy, sessionError, onCharacters, onAccount, party }: { session: AccountSession; sessionBusy: boolean; sessionError: string; onCharacters: () => void; onAccount: () => void; party: ReturnType<typeof useParty> }) {
  const navigation = useNavigation();
  const { roomId, screen } = navigation;
  const { characters, characterId, character, updateCharacter, refreshCharacters } = useCharacters(session.characterId!);
  const [worldInventoryOpen, setWorldInventoryOpen] = useState(false);
  const [partyOpen, setPartyOpen] = useState(false);
  const [content, setContent] = useState<Content | null>(null);
  const [error, setError] = useState('');
  const { arena, refreshArena } = useArena(characterId, setError);
  const enteredBattleId = useRef<string | null>(null);
  useEffect(() => {
    const activeId = arena?.activeBattleId;
    if (!activeId || enteredBattleId.current === activeId) return;
    enteredBattleId.current = activeId;
    if (activeId !== roomId) { setError(''); navigation.openRoom(activeId); }
  }, [arena?.activeBattleId, roomId, navigation.openRoom]);
  const { rooms, loading: roomsLoading, refreshRooms } = useRooms(screen === 'arena' && !roomId, setError);
  const { battle, clockOffset, updateBattle, refreshBattle, animating, fieldMotion, missingRoomId } = useBattle(roomId, setError);
  useEffect(() => {
    if (roomId && missingRoomId === roomId) {
      navigation.openRoom(''); setError('Комната больше недоступна. Возможно, создатель отменил её.');
    }
  }, [roomId, missingRoomId, navigation.openRoom]);
  const recover = useCallback(async () => {
    await Promise.allSettled([refreshCharacters(), refreshBattle(), refreshRooms(), refreshArena()]);
  }, [refreshCharacters, refreshBattle, refreshRooms, refreshArena]);
  const { busy, perform } = useAsyncAction(setError, recover);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([refreshCharacters(), contentApi.get()]).then(([, catalog]) => {
      if (!cancelled) setContent(catalog);
    }).catch(reason => { if (!cancelled) setError(`${reason.message}. Проверьте, что сервер и базы запущены.`); });
    return () => { cancelled = true; };
  }, [refreshCharacters]);

  useEffect(() => {
    if (battle?.status === 'finished') void refreshCharacters().catch(reason => setError(reason.message));
  }, [battle?.id, battle?.status, refreshCharacters]);

  useEffect(() => {
    if (battle?.status === 'waiting' && battle.kind === 'duel') navigation.openRoom('');
  }, [battle?.id, battle?.status, battle?.kind, navigation.openRoom]);

  const openRoom = (id: string) => { setError(''); navigation.openRoom(id); };
  const cancelRoom = (id: string) => void perform(async () => {
    await arenaApi.cancel(id, characterId);
    if (roomId === id) openRoom('');
    await Promise.all([refreshRooms(), refreshArena()]);
  });
  const openSkills = () => { setError(''); navigation.openSkills(); };
  const openGathering = () => { setError(''); navigation.openGathering(); };
  const openWorld = () => { setError(''); navigation.openWorld(); };
  const openCrafting = () => { setError(''); navigation.openCrafting(); };
  const openInventory = () => { setError(''); if (screen === 'world') setWorldInventoryOpen(true); else navigation.openInventory(); };
  useEffect(() => { if (screen !== 'world') setWorldInventoryOpen(false); }, [screen]);
  const openAttributes = () => { setError(''); navigation.openAttributes(); };
  const lobby = screen === 'arena' && !roomId;

  return <div className={`app${roomId && screen === 'arena' ? ' is-battle' : ''}`}>
    <header className="topbar">
      <a className="brand" href="#" onClick={() => openRoom('')}><span className="brand-mark">✦</span><span>СТИХИИ<span className="brand-sub">TACTICAL MATCH–3</span></span></a>
      <nav aria-label="Основная навигация"><button onClick={() => openRoom('')} className={screen === 'arena' ? 'nav-active' : ''}>Арена</button><button onClick={openSkills} className={screen === 'skills' ? 'nav-active' : ''}>Навыки</button><button onClick={openAttributes} className={screen === 'attributes' ? 'nav-active' : ''}>Характеристики</button><button onClick={openWorld} className={screen === 'world' ? 'nav-active' : ''}>Мир</button><button onClick={openGathering} className={screen === 'gathering' ? 'nav-active' : ''}>Вылазки</button><button onClick={openCrafting} className={screen === 'crafting' ? 'nav-active' : ''}>Крафт</button><button onClick={openInventory} className={screen === 'inventory' ? 'nav-active' : ''}>Инвентарь</button></nav>
      <div className="account-controls"><span title={`Аккаунт: ${session.account.name}`}>{character?.name ?? session.account.name}</span><button className="ghost" onClick={() => setPartyOpen(true)}>Группа{party.state?.party ? ` · ${party.state.party.members.length}` : ''}</button><button className="ghost" disabled={busy || sessionBusy} onClick={onCharacters}>Персонажи</button><button className="ghost" disabled={busy || sessionBusy} onClick={onAccount}>Сменить аккаунт</button></div>
    </header>
    <main>
      {roomId && <div className="page-heading"><h1>{battle?.name ?? 'Загрузка боя…'}</h1><button className="ghost" onClick={() => openRoom('')}>← Все комнаты</button></div>}
      {(error || sessionError) && <div className="error" role="alert">{error || sessionError}<button onClick={() => setError('')} aria-label="Закрыть ошибку">×</button></div>}
      {!lobby && arena && (arena.incoming.length > 0 || arena.activeBattleId && arena.activeBattleId !== roomId) && <section className="arena-notifications" aria-label="Уведомления арены">
        {arena.activeBattleId && arena.activeBattleId !== roomId && <div className="arena-offer" role="status"><strong>Бой начался</strong><button className="primary" onClick={() => openRoom(arena.activeBattleId!)}>Перейти в бой</button></div>}
        {arena.incoming.map(offer => <div className="arena-offer" key={offer.id} role="status"><span><strong>{offer.challengerName} бросает тебе вызов</strong><small>{offer.roomName}</small></span>
          <div><button className="primary" disabled={busy} onClick={() => void perform(async () => { const started = await arenaApi.accept(offer, characterId); updateBattle(started); openRoom(started.id); await refreshArena(); })}>Принять</button>
            <button className="ghost" disabled={busy} onClick={() => void perform(async () => { await arenaApi.dismiss(offer, characterId); await refreshArena(); })}>Отклонить</button></div></div>)}
      </section>}
      <div className="screen-content">
        {screen === 'inventory' ? <InventoryPage key={characterId} ownerId={characterId} characters={characters} busy={busy} onError={setError} run={perform} onChanged={refreshCharacters}/>
          : screen === 'attributes' ? <AttributesScreen character={character} content={content} busy={busy}
            onAllocate={(allocations, revision) => void perform(async () => updateCharacter(await charactersApi.allocate(characterId, allocations, revision)))}/>
          : screen === 'world' ? <Suspense fallback={<section className="panel" role="status">Загрузка мира…</section>}><WorldPage key={characterId} playerId={session.account.id} characterId={characterId} party={party.state?.party ?? null} partyReady={!!party.state} partyBusy={party.busy || party.pending} inventoryOpen={worldInventoryOpen} content={content} onChanged={refreshCharacters} onInventory={openInventory} onCrafting={openCrafting} onGathering={openGathering}/></Suspense>
          : screen === 'gathering' ? <GatheringPage key={characterId} ownerId={characterId} busy={busy} onError={setError} run={perform} onChanged={refreshCharacters} onCrafting={openCrafting} onInventory={openInventory}/>
          : screen === 'crafting' ? <CraftingPage key={characterId} ownerId={characterId} busy={busy} onError={setError} run={perform} onChanged={refreshCharacters}/>
          : screen === 'skills' ? <SkillTree character={character} content={content} busy={busy}
          onUpgrade={(skillId, level) => void perform(async () => updateCharacter(await skillsApi.upgrade(characterId, skillId, level)))}
          onLearn={skillId => void perform(async () => updateCharacter(await skillsApi.learn(characterId, skillId)))}/>
          : roomId ? battle ? <BattleScreen key={battle.id} battle={battle} characterId={characterId} hasCharacter={!!character} busy={busy || animating} animating={animating} fieldMotion={fieldMotion} clockOffset={clockOffset}
            canChallenge={!!arena && !arena.activeBattleId} challengePending={arena?.outgoing.some(offer => offer.battleId === battle.id)}
            onChallenge={() => void perform(async () => { await arenaApi.challenge(battle.id, characterId); await refreshArena(); })}
            onCommand={action => void perform(async () => updateBattle(await battlesApi.command(battle.id, characterId, battle.version, action)))}
            onJoin={team => void perform(async () => updateBattle(await battlesApi.join(battle.id, characterId, team)))}
            onStart={() => void perform(async () => updateBattle(await battlesApi.start(battle.id, characterId, battle.version)))}
            onCancel={() => cancelRoom(battle.id)}
            onCopy={() => void perform(async () => { await navigator.clipboard.writeText(location.href); })}/>
            : <section className="panel" role="status">Загрузка боя…</section>
          : <ArenaScreen characterId={characterId} arena={arena}
            onAccept={offer => void perform(async () => { const started = await arenaApi.accept(offer, characterId); updateBattle(started); openRoom(started.id); await refreshArena(); })}
            onChallenge={id => void perform(async () => { await arenaApi.challenge(id, characterId); await refreshArena(); })}
            onDismiss={offer => void perform(async () => { await arenaApi.dismiss(offer, characterId); await refreshArena(); })}
            rooms={rooms} loading={roomsLoading} canCreate={!!character && !!arena && !arena.activeBattleId} busy={busy} onOpen={openRoom} onCancel={cancelRoom}
            onRefresh={() => void perform(refreshRooms)}
            onCreate={async input => { let created = false; await perform(async () => { const room = await arenaApi.create({ ...input, characterId }); created = true; if (room.kind === 'duel') await Promise.all([refreshRooms(), refreshArena()]); else openRoom(room.id); }); return created; }}/>}
      </div>
      {worldInventoryOpen && screen === 'world' && <Modal title="Инвентарь" wide onClose={() => setWorldInventoryOpen(false)}>{error && <p className="error" role="alert">{error}</p>}<InventoryPage key={characterId} ownerId={characterId} characters={characters} busy={busy} onError={setError} run={perform} onChanged={refreshCharacters}/></Modal>}
      {partyOpen && <Modal title="Группа" onClose={() => setPartyOpen(false)}><PartyRoster state={party.state} playerId={session.account.id} characterId={characterId} busy={party.busy} pending={party.pending} error={party.error} message={party.message}
        onAction={action => void party.act(action)} onRetry={party.retry} onRefresh={party.refresh}/></Modal>}
    </main>
  </div>;
}
