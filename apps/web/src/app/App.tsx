import { useCallback, useEffect, useState } from 'react';
import { Content } from '@game/core';
import { useNavigation } from './useNavigation';
import { useAsyncAction } from './useAsyncAction';
import { useCharacters } from '../features/characters/model/useCharacters';
import { CharacterPanel } from '../features/characters/components/CharacterPanel';
import { charactersApi } from '../features/characters/api/characters.api';
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
import { EnergyPanel } from '../shared/ui/EnergyPanel';
import { kindNames, ruleNames } from '../shared/ui/game-labels';
import '../features/skills/skill-tree.css';

export function App() {
  const navigation = useNavigation();
  const { roomId, screen } = navigation;
  const { characters, characterId, character, chooseCharacter, updateCharacter, refreshCharacters } = useCharacters();
  const [content, setContent] = useState<Content | null>(null);
  const [error, setError] = useState('');
  const { rooms, refreshRooms } = useRooms(screen === 'arena' && !roomId, setError);
  const { battle, connected, updateBattle, refreshBattle, animating, fieldMotion } = useBattle(roomId, setError);
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
  const heading = screen === 'inventory' ? 'Всё для следующего боя.' : screen === 'skills' ? 'Выбери свой путь.' : battle ? battle.name : roomId ? 'Загрузка боя…' : 'Каждый ход имеет значение.';
  const description = screen === 'inventory' ? 'Снаряжение, запасы и знания твоего героя.' : screen === 'skills' ? 'Развивай четыре стихии и физические навыки героя.'
    : battle ? `${kindNames[battle.kind]} · ${ruleNames[battle.rule]} · ${battle.kind === 'dungeon' ? `Волна ${battle.wave} из ${battle.totalWaves}` : 'Две команды — одно поле'}`
    : 'Четыре стихии. Физическая сила. Защита. Твоя тактика.';

  return <div className="app">
    <header className="topbar">
      <a className="brand" href="#" onClick={() => openRoom('')}><span className="brand-mark">✦</span><span>СТИХИИ<span className="brand-sub">TACTICAL MATCH–3</span></span></a>
      <nav><button onClick={() => openRoom('')} className={screen === 'arena' ? 'nav-active' : ''}>Арена</button><button onClick={openSkills} className={screen === 'skills' ? 'nav-active' : ''}>Навыки</button><button onClick={() => { setError(''); navigation.openInventory(); }} className={screen === 'inventory' ? 'nav-active' : ''}>Инвентарь</button></nav>
      <div className="connection"><i className={(roomId ? connected : !!content) ? 'online' : ''}/>{roomId ? connected ? 'Автообновление' : 'Обновление каждые 5 с' : content ? 'Сервер подключён' : 'Подключение…'}</div>
    </header>
    <main>
      <div className="page-heading"><div><div className="eyebrow">СОБИРАЙ. НАПОЛНЯЙ. ПОБЕЖДАЙ.</div><h1>{heading}</h1><p>{description}</p></div>{roomId && <button className="ghost" onClick={() => openRoom('')}>← Все комнаты</button>}</div>
      {error && <div className="error" role="alert">{error}<button onClick={() => setError('')} aria-label="Закрыть ошибку">×</button></div>}
      <div className={`layout${screen === 'inventory' ? ' inventory-layout' : ''}`}>
        <aside className="sidebar">
          <CharacterPanel compact={screen === 'inventory'} characters={characters} characterId={characterId} character={character} content={content} fighter={fighter} busy={busy} onChoose={chooseCharacter} onSkills={openSkills} onInventory={() => { setError(''); navigation.openInventory(); }}
            onCreate={async (name, templateId) => {
              let created = false;
              await perform(async () => {
                const hero = await charactersApi.create(name, templateId);
                chooseCharacter(hero.id);
                created = true;
                await refreshCharacters();
              });
              return created;
            }}/>
          {screen !== 'inventory' && <EnergyPanel character={character} fighter={fighter} legacy={!!battle && battle.combatVersion !== 2}/>}
        </aside>
        {screen === 'inventory' ? <InventoryPage key={characterId} ownerId={characterId} characters={characters} busy={busy} onError={setError} run={perform} onChanged={refreshCharacters}/> : screen === 'skills' ? <SkillTree character={character} content={content} busy={busy}
          onUpgrade={(skillId, level) => void perform(async () => updateCharacter(await skillsApi.upgrade(characterId, skillId, level)))}
          onLearn={skillId => void perform(async () => updateCharacter(await skillsApi.learn(characterId, skillId)))}/>
          : roomId ? battle ? <BattleScreen key={battle.id} battle={battle} characterId={characterId} hasCharacter={!!character} busy={busy || animating} animating={animating} fieldMotion={fieldMotion}
            onCommand={action => void perform(async () => updateBattle(await battlesApi.command(battle.id, characterId, battle.version, action)))}
            onJoin={team => void perform(async () => updateBattle(await battlesApi.join(battle.id, characterId, team)))}
            onStart={() => void perform(async () => updateBattle(await battlesApi.start(battle.id, characterId, battle.version)))}
            onCopy={() => void perform(async () => { await navigator.clipboard.writeText(location.href); })}/>
            : <section className="panel" role="status">Загрузка боя…</section>
          : <ArenaScreen rooms={rooms} canCreate={!!character} busy={busy} onOpen={openRoom}
            onRefresh={() => void perform(refreshRooms)}
            onCreate={input => void perform(async () => { const room = await arenaApi.create({ ...input, characterId }); openRoom(room.id); })}/>}
      </div>
      <footer><span>СТИХИИ / ТАКТИЧЕСКАЯ АРЕНА</span><span>Состояние боя рассчитывает сервер · Без авторизации</span></footer>
    </main>
  </div>;
}
