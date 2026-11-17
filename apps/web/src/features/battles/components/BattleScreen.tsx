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
import { FighterDetails } from './FighterDetails';
import { useTurnTimer } from '../model/useTurnTimer';
import { FighterCard } from './FighterCard';
import { symbols } from '../../../shared/ui/game-labels';
import { tileTypes, tileTypeNames } from '@game/core';
import '../battle.css';

interface Props {
  battle: Battle; characterId: string; hasCharacter: boolean; busy: boolean;
  animating?: boolean; fieldMotion?: FieldMotion;
  clockOffset?: number;
  onChallenge?: () => void; challengePending?: boolean; canChallenge?: boolean;
  onCommand: (action: Action) => void; onJoin: (team: number) => void; onStart: () => void; onCopy: () => void;
}

export function BattleScreen({ battle, characterId, hasCharacter, busy, animating, fieldMotion, clockOffset = 0, onChallenge, challengePending, canChallenge, onCommand, onJoin, onStart, onCopy }: Props) {
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
  const alliedTeam = me?.team ?? 0;
  const allies = battle.fighters.filter(fighter => fighter.team === alliedTeam);
  const opponents = battle.fighters.filter(fighter => fighter.team !== alliedTeam);
  const fighterCard = (fighter: Battle['fighters'][number], opponent: boolean) => <FighterCard key={fighter.id} fighter={fighter} battle={battle}
    mine={fighter.id === me?.id} opponent={opponent} selected={fighter.id === targetId}
    onTarget={() => { if (opponent && fighter.hp > 0) controls.setTargetId(fighter.id); }} onInspect={() => setInspectedId(fighter.id)}/>;
  return <div className="main-column battle-screen">
    <section className="panel battle-top">
      <div className="section-heading"><div>
        <div className="section-label">АРЕНА СТИХИЙ · ХОД {battle.turn || '—'}</div>
        <h2>{battle.status === 'waiting' ? 'Сбор участников' : battle.status === 'finished' ? battle.winner === null ? 'Бой завершён' : `Победа команды ${battle.winner + 1}` : myTurn ? 'Твой ход' : `Ход: ${active?.name}`}</h2>
        {battle.kind === 'dungeon' && <p>Волна {battle.wave} из {battle.totalWaves}</p>}
      </div><div className="battle-header-actions">
      {battle.status === 'active' && <>
        {seconds !== undefined && !animating && <span className={`turn-timer ${seconds <= 5 ? 'urgent' : ''}`} role="timer" aria-label="Осталось времени на ход">⏱ {seconds} с</span>}
        {me && me.hp > 0 && <button className="ghost surrender-button" disabled={busy} onClick={() => setConfirmSurrender(true)}>Закончить бой</button>}
      </>}
      <button className="ghost" onClick={onCopy}>Скопировать приглашение ↗</button></div></div>
      <BattleRewards battle={battle} characterId={characterId}/>
      {battle.status === 'waiting' && <div className="lobby-actions">
        {battle.kind === 'duel' ? !me ? <button className="primary" disabled={busy || !hasCharacter || !canChallenge || challengePending} onClick={onChallenge}>{challengePending ? 'Вызов отправлен' : 'Бросить вызов'}</button>
          : <p role="status">Комната доступна другим игрокам. Ожидаем вызовов.</p> : !me ? <>{(battle.kind === 'bot' ? [] : [0, 1]).filter(team => battle.kind !== 'dungeon' || team === 0).map(team =>
          <button key={team} disabled={!hasCharacter || busy} onClick={() => onJoin(team)}>Вступить в команду {team + 1}</button>)}</>
          : <button className="primary" disabled={busy} onClick={onStart}>Начать бой →</button>}
        <p className="hint">{battle.kind === 'duel' ? 'Владелец комнаты получает вызов и принимает его или отклоняет. Бой начинается сразу после принятия.' : battle.kind === 'bot' ? 'Играй один: бот получит характеристики и навыки твоего героя и будет ходить автоматически.' : battle.kind === 'dungeon' ? 'Можно играть одному или пригласить ещё двух героев.' : 'Другой игрок открывает приглашение и выбирает своего персонажа.'}</p>
      </div>}
    </section>
    <div className="battle-arena">
      <aside className="combatant-rail allies-rail" aria-label="Ваша команда"><div className="rail-heading"><span>✦</span> ВАША КОМАНДА</div>{allies.map(fighter => fighterCard(fighter, false))}</aside>
      <div className="battle-center">
      <div className="arena-crest" aria-hidden="true"><span/>✦<span/></div>
      <BattlefieldBoard board={battle.board} motion={fieldMotion} enabled={myTurn && !busy && battle.phase === 'before'} selected={controls.selected} onTile={controls.tileClick} phaseLabel={phaseLabel}>
        <BattlefieldSummary report={lastMove} actorName={battle.fighters.find(fighter => fighter.id === lastMove?.actorId)?.name}/>
      </BattlefieldBoard>
      <div className="battle-element-key" aria-label="Типы клеток">{tileTypes.map(type => <span key={type}><i className={`element-icon ${type}`}>{symbols[type]}</i>{tileTypeNames[type]}</span>)}</div>
      </div>
      <aside className="combatant-rail enemies-rail" aria-label="Команда противника"><div className="rail-heading"><span>⚔</span> ПРОТИВНИК</div>{opponents.map(fighter => fighterCard(fighter, true))}{!opponents.length && <div className="opponent-pending"><span>⚔</span><p>Ожидаем соперника</p></div>}</aside>
    </div>
    <div className="battle-bottom">
      <BattleSkills battle={battle} me={me} myTurn={myTurn} busy={busy} targetId={targetId} healTarget={healTarget} onAlly={controls.setAllyId} onCommand={onCommand}/>
      <section className="panel journal"><div className="section-label">ЛЕТОПИСЬ СРАЖЕНИЯ</div>
        {[...battle.log].reverse().slice(0, 30).map((line, index) => <div key={`${battle.log.length}-${index}`}><span>{String(battle.log.length - index).padStart(2, '0')}</span>{line}</div>)}
      </section>
    </div>
    {me?.attributes && battle.content.statDefinitions && <details className="panel battle-character-stats"><summary>Параметры в этом бою</summary><CharacterAttributes attributes={me.attributes} definitions={battle.content.statDefinitions}/></details>}
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
  </div>;
}
