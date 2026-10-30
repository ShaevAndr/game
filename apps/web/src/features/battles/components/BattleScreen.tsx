import { useEffect, useRef } from 'react';
import { Action, Battle, skillEnergy } from '@game/core';
import { useBattleControls } from '../model/useBattleControls';
import { BattleRewards } from './BattleRewards';
import { BattlefieldBoard } from '../../battlefield/components/BattlefieldBoard';
import { BattlefieldSummary } from '../../battlefield/components/BattlefieldSummary';
import { BattleSkills } from './BattleSkills';
import { SkillEnergy } from '../../../shared/ui/SkillEnergy';
import { FieldMotion } from '../../battlefield/model/field-playback';
import { CharacterAttributes } from '../../characters/components/CharacterAttributes';

interface Props {
  battle: Battle; characterId: string; hasCharacter: boolean; busy: boolean;
  animating?: boolean; fieldMotion?: FieldMotion;
  onCommand: (action: Action) => void; onJoin: (team: number) => void; onStart: () => void; onCopy: () => void;
}

export function BattleScreen({ battle, characterId, hasCharacter, busy, animating, fieldMotion, onCommand, onJoin, onStart, onCopy }: Props) {
  const controls = useBattleControls(battle, characterId, busy, onCommand);
  const { me, active, myTurn, targetId, healTarget } = controls;
  const dialog = useRef<HTMLDialogElement>(null);
  const choosing = battle.combatVersion === 2 && myTurn && battle.phase === 'choose' && !animating;
  useEffect(() => {
    if (choosing && !dialog.current?.open) dialog.current?.showModal();
    else if (!choosing && dialog.current?.open) dialog.current.close();
  }, [choosing]);
  const lastMove = [...(battle.boardMoves ?? [])].reverse().find(move => move.actorId === characterId) ?? battle.boardMoves?.[battle.boardMoves.length - 1];
  const phaseLabel = animating ? fieldMotion ? fieldMotion.stage === 'remove' ? 'Фишки исчезают…' : fieldMotion.stage === 'fall' ? 'Фишки падают…' : 'Перестановка…' : active?.npc ? 'Бот готовит ход…' : 'Ход выполняется…' : battle.status === 'active' ? battle.phase === 'choose' ? 'Выбери навык' : battle.phase === 'after' ? 'Заверши ход' : 'Собери три в ряд' : 'Общее поле';
  return <div className="main-column">
    <section className="panel battle-top">
      <div className="section-heading"><div>
        <div className="section-label">БОЕВОЙ ИНСТАНС · ХОД {battle.turn || '—'}</div>
        <h2>{battle.status === 'waiting' ? 'Сбор участников' : battle.status === 'finished' ? `Победа команды ${(battle.winner ?? 0) + 1}` : myTurn ? 'Твой ход' : `Ход: ${active?.name}`}</h2>
      </div><button className="ghost" onClick={onCopy}>Скопировать приглашение ↗</button></div>
      <BattleRewards battle={battle} characterId={characterId}/>
      <div className="fighters">{battle.fighters.map(fighter => <button key={fighter.id}
        onClick={() => { if (fighter.team !== me?.team && fighter.hp > 0) controls.setTargetId(fighter.id); }}
        className={`fighter ${fighter.id === battle.activeId ? 'acting' : ''} ${fighter.id === targetId ? 'target' : ''} ${fighter.hp === 0 ? 'dead' : ''}`}>
        <div><span>{fighter.npc ? '⬡' : '◈'} {fighter.name}</span><small>Команда {fighter.team + 1}{fighter.id === me?.id ? ' · ты' : ''}{fighter.id === targetId ? ' · цель' : ''}</small>{(fighter.guardDefense ?? 0) > 0 && <small className="guard-status">⛨ Защита +{fighter.guardDefense} до своего хода</small>}</div>
        <b>{fighter.hp}<small> / {fighter.stats.maxHp}</small></b><div className="hp-track"><i style={{ width: `${100 * fighter.hp / fighter.stats.maxHp}%` }}/></div>
        {battle.combatVersion === 2 && <SkillEnergy value={skillEnergy(fighter)}/>}
      </button>)}</div>
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
        {me && <SkillEnergy value={skillEnergy(me)}/>}
        <BattleSkills battle={battle} me={me} myTurn={myTurn} busy={busy} targetId={targetId} healTarget={healTarget} onAlly={controls.setAllyId} onEnemy={controls.setTargetId} onCommand={onCommand} choiceOnly/>
      </>}
    </dialog>
    <section className="panel journal"><div className="section-label">ЖУРНАЛ БОЯ</div>
      {[...battle.log].reverse().slice(0, 30).map((line, index) => <div key={`${battle.log.length}-${index}`}><span>{String(battle.log.length - index).padStart(2, '0')}</span>{line}</div>)}
    </section>
  </div>;
}
