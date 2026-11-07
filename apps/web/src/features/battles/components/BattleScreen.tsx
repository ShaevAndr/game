import { useEffect, useRef, useState } from 'react';
import { Action, Battle, skillEnergy } from '@game/core';
import { useBattleControls } from '../model/useBattleControls';
import { BattleRewards } from './BattleRewards';
import { BattlefieldBoard } from '../../battlefield/components/BattlefieldBoard';
import { BattlefieldSummary } from '../../battlefield/components/BattlefieldSummary';
import { BattleSkills } from './BattleSkills';
import { SkillEnergy } from '../../../shared/ui/SkillEnergy';
import { FieldMotion } from '../../battlefield/model/field-playback';
import { CharacterAttributes } from '../../characters/components/CharacterAttributes';
import { ActiveEffects } from './ActiveEffects';
import { FighterDetails } from './FighterDetails';
import { useTurnTimer } from '../model/useTurnTimer';

interface Props {
  battle: Battle; characterId: string; hasCharacter: boolean; busy: boolean;
  animating?: boolean; fieldMotion?: FieldMotion;
  clockOffset?: number;
  onCommand: (action: Action) => void; onJoin: (team: number) => void; onStart: () => void; onCopy: () => void;
}

export function BattleScreen({ battle, characterId, hasCharacter, busy, animating, fieldMotion, clockOffset = 0, onCommand, onJoin, onStart, onCopy }: Props) {
  const controls = useBattleControls(battle, characterId, busy, onCommand);
  const { me, active, myTurn, targetId, healTarget } = controls;
  const dialog = useRef<HTMLDialogElement>(null);
  const surrenderDialog = useRef<HTMLDialogElement>(null);
  const [inspectedId, setInspectedId] = useState<string>();
  const [confirmSurrender, setConfirmSurrender] = useState(false);
  const seconds = useTurnTimer(battle.status === 'active' ? battle.turnDeadlineAt : undefined, clockOffset);
  const choosing = battle.combatVersion === 1 && myTurn && battle.phase === 'choose' && !animating && !confirmSurrender;
  useEffect(() => {
    if (choosing && !dialog.current?.open) dialog.current?.showModal();
    else if (!choosing && dialog.current?.open) dialog.current.close();
  }, [choosing]);
  useEffect(() => { setConfirmSurrender(false); }, [characterId]);
  useEffect(() => {
    const open = confirmSurrender && battle.status === 'active' && !!me && me.hp > 0;
    if (open && !surrenderDialog.current?.open) surrenderDialog.current?.showModal();
    else if (!open && surrenderDialog.current?.open) surrenderDialog.current.close();
  }, [confirmSurrender, battle.status, me?.hp]);
  const lastMove = [...(battle.boardMoves ?? [])].reverse().find(move => move.actorId === characterId) ?? battle.boardMoves?.[battle.boardMoves.length - 1];
  const phaseLabel = animating ? fieldMotion ? fieldMotion.stage === 'remove' ? 'Фишки исчезают…' : fieldMotion.stage === 'fall' ? 'Фишки падают…' : 'Перестановка…' : active?.npc ? 'Бот готовит ход…' : 'Ход выполняется…' : battle.status === 'active' ? battle.phase === 'choose' ? 'Выбери навык' : 'Переставь соседние фишки' : 'Общее поле';
  return <div className="main-column">
    <section className="panel battle-top">
      <div className="section-heading"><div>
        <div className="section-label">БОЕВОЙ ИНСТАНС · ХОД {battle.turn || '—'}</div>
        <h2>{battle.status === 'waiting' ? 'Сбор участников' : battle.status === 'finished' ? battle.winner === null ? 'Бой завершён' : `Победа команды ${battle.winner + 1}` : myTurn ? 'Твой ход' : `Ход: ${active?.name}`}</h2>
      </div><button className="ghost" onClick={onCopy}>Скопировать приглашение ↗</button></div>
      <BattleRewards battle={battle} characterId={characterId}/>
      {battle.status === 'active' && <div className="battle-turn-controls">
        {seconds !== undefined && !animating && <span className={`turn-timer ${seconds <= 5 ? 'urgent' : ''}`} role="timer" aria-label="Осталось времени на ход">⏱ {seconds} с</span>}
        {me && me.hp > 0 && <button className="ghost surrender-button" disabled={busy} onClick={() => setConfirmSurrender(true)}>Закончить бой</button>}
      </div>}
      <div className="fighters">{battle.fighters.map(fighter => <div className="fighter-card" key={fighter.id}><button
        onClick={() => { if (fighter.team !== me?.team && fighter.hp > 0) controls.setTargetId(fighter.id); }}
        className={`fighter ${fighter.id === battle.activeId ? 'acting' : ''} ${fighter.id === targetId ? 'target' : ''} ${fighter.hp === 0 ? 'dead' : ''}`}>
        <div><span>{fighter.npc ? '⬡' : '◈'} {fighter.name}</span><small>Команда {fighter.team + 1}{fighter.id === me?.id ? ' · ты' : ''}{fighter.id === targetId ? ' · цель' : ''}</small>{(fighter.guardDefense ?? 0) > 0 && <small className="guard-status">⛨ Защита +{fighter.guardDefense} до своего хода</small>}</div>
        <b>{fighter.hp}<small> / {fighter.stats.maxHp}</small></b><div className="hp-track"><i style={{ width: `${100 * fighter.hp / fighter.stats.maxHp}%` }}/></div>
        {battle.combatVersion === 1 && <SkillEnergy value={skillEnergy(fighter)}/>}
      </button><button className="ghost inspect-fighter" onClick={() => setInspectedId(fighter.id)}>Посмотреть персонажа</button><ActiveEffects effects={fighter.activeEffects ?? []} fighters={battle.fighters} definitions={battle.content.statDefinitions ?? []}/></div>)}</div>
      {me?.attributes && battle.content.statDefinitions && <details className="battle-character-stats"><summary>Параметры в этом бою</summary><CharacterAttributes attributes={me.attributes} definitions={battle.content.statDefinitions}/></details>}
      {battle.status === 'waiting' && <div className="lobby-actions">
        {!me ? <>{(battle.kind === 'bot' ? [] : [0, 1]).filter(team => battle.kind !== 'dungeon' || team === 0).map(team =>
          <button key={team} disabled={!hasCharacter || busy} onClick={() => onJoin(team)}>Вступить в команду {team + 1}</button>)}</>
          : <button className="primary" disabled={busy} onClick={onStart}>Начать бой →</button>}
        <p className="hint">{battle.kind === 'bot' ? 'Играй один: бот получит характеристики и навыки твоего героя и будет ходить автоматически.' : battle.kind === 'dungeon' ? 'Можно играть одному или пригласить ещё двух героев.' : 'Другой игрок открывает приглашение и выбирает своего персонажа.'}</p>
      </div>}
    </section>
    <div className="combat-grid">
      <BattlefieldBoard board={battle.board} motion={fieldMotion} enabled={myTurn && !busy && battle.phase === 'before'} selected={controls.selected} onTile={controls.tileClick} phaseLabel={phaseLabel}>
        <BattlefieldSummary report={lastMove} actorName={battle.fighters.find(fighter => fighter.id === lastMove?.actorId)?.name}/>
      </BattlefieldBoard>
      <BattleSkills battle={battle} me={me} myTurn={myTurn} busy={busy} targetId={targetId} healTarget={healTarget} onAlly={controls.setAllyId} onCommand={onCommand}/>
    </div>
    <dialog ref={dialog} className="battle-skills-dialog" aria-labelledby="battle-skills-title" onCancel={event => event.preventDefault()}>
      {choosing && <>
        <div className="battle-choice-toolbar"><span role="timer">⏱ {seconds ?? '—'} с</span><button className="ghost" disabled={busy} onClick={() => { dialog.current?.close(); setConfirmSurrender(true); }}>Закончить бой</button></div>
        <div className="battle-inspect-list">{battle.fighters.map(fighter => <button key={fighter.id} className="ghost" onClick={() => setInspectedId(fighter.id)}>Посмотреть: {fighter.name}</button>)}</div>
        {me && <SkillEnergy value={skillEnergy(me)}/>}
        <BattleSkills battle={battle} me={me} myTurn={myTurn} busy={busy} targetId={targetId} healTarget={healTarget} onAlly={controls.setAllyId} onEnemy={controls.setTargetId} onCommand={onCommand} choiceOnly/>
      </>}
    </dialog>
    <dialog ref={surrenderDialog} className="fighter-details-dialog surrender-confirm" aria-labelledby="surrender-title" onCancel={() => setConfirmSurrender(false)} onClose={() => setConfirmSurrender(false)}>
      <h2 id="surrender-title">Закончить бой?</h2>
      <p>Сдаться и закончить бой для этого персонажа? Союзники смогут продолжить без него.</p>
      <button disabled={busy} onClick={() => onCommand({ type: 'surrender' })}>Сдаться</button><button className="ghost" onClick={() => setConfirmSurrender(false)}>Продолжить бой</button>
    </dialog>
    <FighterDetails battle={battle} fighter={battle.fighters.find(fighter => fighter.id === inspectedId)} onClose={() => setInspectedId(undefined)}/>
    <section className="panel journal"><div className="section-label">ЖУРНАЛ БОЯ</div>
      {[...battle.log].reverse().slice(0, 30).map((line, index) => <div key={`${battle.log.length}-${index}`}><span>{String(battle.log.length - index).padStart(2, '0')}</span>{line}</div>)}
    </section>
  </div>;
}
