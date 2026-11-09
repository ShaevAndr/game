import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { AccountSession, Content } from '@game/core';
import { useNavigation } from './useNavigation';
import { useAsyncAction } from './useAsyncAction';
import { useCharacters } from '../features/characters/model/useCharacters';
import { CharacterPanel } from '../features/characters/components/CharacterPanel';
import { contentApi } from '../features/content/api/content.api';
import { SkillTree } from '../features/skills/components/SkillTree';
import { skillsApi } from '../features/skills/api/skills.api';
import { useRooms } from '../features/arena/model/useRooms';
import { ArenaScreen } from '../features/arena/components/ArenaScreen';
import { arenaApi } from '../features/arena/api/arena.api';
import { useBattle } from '../features/battles/model/useBattle';
import { BattleScreen } from '../features/battles/components/BattleScreen';
import { battlesApi } from '../features/battles/api/battles.api';
import { InventoryPage } from '../features/inventory/InventoryPage';
import { EquipmentPage } from '../features/equipment/EquipmentPage';
import { GatheringPage } from '../features/gathering/GatheringPage';
import { CraftingPage } from '../features/crafting/CraftingPage';
import { EnergyPanel } from '../shared/ui/EnergyPanel';
import { kindNames, ruleNames } from '../shared/ui/game-labels';
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
        onCharacters={() => void identity.selectCharacter(null)} onAccount={() => void identity.logout()} party={party}/>}
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
  const [content, setContent] = useState<Content | null>(null);
  const [error, setError] = useState('');
  const { rooms, refreshRooms } = useRooms(screen === 'arena' && !roomId, setError);
  const { battle, connected, clockOffset, updateBattle, refreshBattle, animating, fieldMotion } = useBattle(roomId, setError);
  const recover = useCallback(async () => {
    await Promise.allSettled([refreshCharacters(), refreshBattle(), refreshRooms()]);
  }, [refreshCharacters, refreshBattle, refreshRooms]);
  const { busy, perform } = useAsyncAction(setError, recover);
  const fighter = battle?.fighters.find(value => value.id === characterId);

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

  const openRoom = (id: string) => { setError(''); navigation.openRoom(id); };
  const openSkills = () => { setError(''); navigation.openSkills(); };
  const openGathering = () => { setError(''); navigation.openGathering(); };
  const openWorld = () => { setError(''); navigation.openWorld(); };
  const openCrafting = () => { setError(''); navigation.openCrafting(); };
  const openInventory = () => { setError(''); navigation.openInventory(); };
  const openEquipment = () => { setError(''); navigation.openEquipment(); };
  const workshop = ['inventory', 'equipment', 'crafting', 'gathering', 'world'].includes(screen);
  const heading = screen === 'world' ? 'Оставь свой след.' : screen === 'gathering' ? 'Отправляйся за находками.' : screen === 'equipment' ? 'Подготовь героя к бою.' : screen === 'inventory' ? 'Всё для следующего боя.' : screen === 'crafting' ? 'Кузница героя.' : screen === 'skills' ? 'Выбери свой путь.' : battle ? battle.name : roomId ? 'Загрузка боя…' : 'Каждый ход имеет значение.';
  const description = screen === 'world' ? 'Исследуй мир вместе с группой. Прокладывай путь и возвращайся с добычей.' : screen === 'gathering' ? 'Исследуй леса, топи и нагорья. Собирай материалы для своего ремесла.' : screen === 'equipment' ? 'Выбери слот, надень снаряжение и проверь бонусы.' : screen === 'inventory' ? 'Снаряжение, запасы и знания твоего героя.' : screen === 'crafting' ? 'Выбери известный рецепт и собери необходимые предметы.' : screen === 'skills' ? 'Развивай четыре стихии и физические навыки героя.'
    : battle ? `${kindNames[battle.kind]} · ${ruleNames[battle.rule]} · ${battle.kind === 'dungeon' ? `Волна ${battle.wave} из ${battle.totalWaves}` : 'Две команды — одно поле'}`
    : 'Четыре стихии. Физическая сила. Защита. Твоя тактика.';

  return <div className="app">
    <header className="topbar">
      <a className="brand" href="#" onClick={() => openRoom('')}><span className="brand-mark">✦</span><span>СТИХИИ<span className="brand-sub">TACTICAL MATCH–3</span></span></a>
      <nav aria-label="Основная навигация"><button onClick={() => openRoom('')} className={screen === 'arena' ? 'nav-active' : ''}>Арена</button><button onClick={openSkills} className={screen === 'skills' ? 'nav-active' : ''}>Навыки</button><button onClick={openEquipment} className={screen === 'equipment' ? 'nav-active' : ''}>Экипировка</button><button onClick={openWorld} className={screen === 'world' ? 'nav-active' : ''}>Мир</button><button onClick={openGathering} className={screen === 'gathering' ? 'nav-active' : ''}>Вылазки</button><button onClick={openCrafting} className={screen === 'crafting' ? 'nav-active' : ''}>Крафт</button><button onClick={openInventory} className={screen === 'inventory' ? 'nav-active' : ''}>Инвентарь</button></nav>
      <div className="account-controls"><span>{session.account.name}</span><button className="ghost" disabled={busy || sessionBusy} onClick={onCharacters}>Персонажи</button><button className="ghost" disabled={busy || sessionBusy} onClick={onAccount}>Сменить аккаунт</button></div>
      <div className="connection"><i className={(roomId ? connected : !!content) ? 'online' : ''}/>{roomId ? connected ? 'Автообновление' : 'Обновление каждые 5 с' : content ? 'Сервер подключён' : 'Подключение…'}</div>
    </header>
    <main>
      <div className="page-heading"><div><div className="eyebrow">СОБИРАЙ. НАПОЛНЯЙ. ПОБЕЖДАЙ.</div><h1>{heading}</h1><p>{description}</p></div>{roomId && <button className="ghost" onClick={() => openRoom('')}>← Все комнаты</button>}</div>
      {(error || sessionError) && <div className="error" role="alert">{error || sessionError}<button onClick={() => setError('')} aria-label="Закрыть ошибку">×</button></div>}
      <div className={`layout${workshop ? ` ${screen}-layout` : ''}`}>
        <aside className="sidebar">
          <CharacterPanel compact={workshop} character={character} content={content} fighter={fighter} busy={busy || sessionBusy} onCharacters={onCharacters} onSkills={openSkills} onInventory={openInventory} onEquipment={openEquipment}/>
          <PartyRoster state={party.state} playerId={session.account.id} characterId={characterId} busy={party.busy} pending={party.pending} error={party.error} message={party.message}
            onAction={action => void party.act(action)} onRetry={party.retry} onRefresh={party.refresh}/>
          {!workshop && <EnergyPanel character={character} fighter={fighter}/>}
        </aside>
        {screen === 'inventory' ? <InventoryPage key={characterId} ownerId={characterId} characters={characters} busy={busy} onError={setError} run={perform} onChanged={refreshCharacters}/>
          : screen === 'equipment' ? <EquipmentPage key={characterId} ownerId={characterId} character={character} busy={busy} onError={setError} run={perform} onChanged={refreshCharacters} onInventory={openInventory}/>
          : screen === 'world' ? <Suspense fallback={<section className="panel" role="status">Загрузка мира…</section>}><WorldPage key={characterId} playerId={session.account.id} characterId={characterId} party={party.state?.party ?? null} partyReady={!!party.state} partyBusy={party.busy || party.pending} content={content} onChanged={refreshCharacters} onInventory={openInventory} onCrafting={openCrafting} onGathering={openGathering}/></Suspense>
          : screen === 'gathering' ? <GatheringPage key={characterId} ownerId={characterId} busy={busy} onError={setError} run={perform} onChanged={refreshCharacters} onCrafting={openCrafting} onInventory={openInventory}/>
          : screen === 'crafting' ? <CraftingPage key={characterId} ownerId={characterId} busy={busy} onError={setError} run={perform} onChanged={refreshCharacters}/>
          : screen === 'skills' ? <SkillTree character={character} content={content} busy={busy}
          onUpgrade={(skillId, level) => void perform(async () => updateCharacter(await skillsApi.upgrade(characterId, skillId, level)))}
          onLearn={skillId => void perform(async () => updateCharacter(await skillsApi.learn(characterId, skillId)))}/>
          : roomId ? battle ? <BattleScreen key={battle.id} battle={battle} characterId={characterId} hasCharacter={!!character} busy={busy || animating} animating={animating} fieldMotion={fieldMotion} clockOffset={clockOffset}
            onCommand={action => void perform(async () => updateBattle(await battlesApi.command(battle.id, characterId, battle.version, action)))}
            onJoin={team => void perform(async () => updateBattle(await battlesApi.join(battle.id, characterId, team)))}
            onStart={() => void perform(async () => updateBattle(await battlesApi.start(battle.id, characterId, battle.version)))}
            onCopy={() => void perform(async () => { await navigator.clipboard.writeText(location.href); })}/>
            : <section className="panel" role="status">Загрузка боя…</section>
          : <ArenaScreen rooms={rooms} canCreate={!!character} busy={busy} onOpen={openRoom}
            onRefresh={() => void perform(refreshRooms)}
            onCreate={input => void perform(async () => { const room = await arenaApi.create({ ...input, characterId }); openRoom(room.id); })}/>}
      </div>
      <footer><span>СТИХИИ / ТАКТИЧЕСКАЯ АРЕНА</span><span>Состояние боя рассчитывает сервер</span></footer>
    </main>
  </div>;
}
