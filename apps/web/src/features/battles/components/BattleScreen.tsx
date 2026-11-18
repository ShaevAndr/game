import { useEffect, useState } from 'react';
import { tileTypes, tileTypeNames } from '@game/core';
import { useBattleControls } from '../model/useBattleControls';
import type { BattleScreenProps } from '../model/battle-screen';
import { useTurnTimer } from '../model/useTurnTimer';
import { BattlefieldBoard } from '../../battlefield/components/BattlefieldBoard';
import { BattlefieldSummary } from '../../battlefield/components/BattlefieldSummary';
import { CharacterAttributes } from '../../characters/components/CharacterAttributes';
import { symbols } from '../../../shared/ui/game-labels';
import { BattleHeader } from './BattleHeader';
import { BattleDialogs } from './BattleDialogs';
import { BattleJournal } from './BattleJournal';
import { CombatantRail } from './CombatantRail';
import { BattleSkills } from './BattleSkills';
import '../battle.css';

export function BattleScreen(props: BattleScreenProps) {
  const { battle, characterId, busy, animating, fieldMotion, clockOffset = 0, onCommand } = props;
  const controls = useBattleControls(battle, characterId, busy, onCommand);
  const { me, active, myTurn, targetId, healTarget } = controls;
  const [inspectedId, setInspectedId] = useState<string>();
  const [confirmSurrender, setConfirmSurrender] = useState(false);
  const seconds = useTurnTimer(battle.status === 'active' ? battle.turnDeadlineAt : undefined, clockOffset);
  const choosing = battle.combatVersion === 1 && myTurn && battle.phase === 'choose' && !animating && !confirmSurrender;
  useEffect(() => { setConfirmSurrender(false); }, [characterId]);
  const rail = { battle, alliedTeam: me?.team ?? 0, mineId: me?.id, targetId,
    onTarget: controls.setTargetId, onInspect: setInspectedId };
  const lastMove = [...(battle.boardMoves ?? [])].reverse().find(move => move.actorId === characterId) ?? battle.boardMoves?.[battle.boardMoves.length - 1];
  const phaseLabel = animating ? fieldMotion ? fieldMotion.stage === 'remove' ? 'Фишки исчезают…' : fieldMotion.stage === 'fall' ? 'Фишки падают…' : 'Перестановка…' : active?.npc ? 'Бот готовит ход…' : 'Ход выполняется…' : battle.status === 'active' ? battle.phase === 'choose' ? 'Выбери навык' : 'Переставь соседние фишки' : 'Общее поле';
  return <div className="main-column battle-screen">
    <BattleHeader {...props} me={me} active={active} myTurn={myTurn} seconds={seconds}
      onSurrender={() => setConfirmSurrender(true)}/>
    <div className="battle-arena">
      <CombatantRail {...rail}/>
      <div className="battle-center">
      <div className="arena-crest" aria-hidden="true"><span/>✦<span/></div>
      <BattlefieldBoard board={battle.board} motion={fieldMotion} enabled={myTurn && !busy && battle.phase === 'before'} selected={controls.selected} onTile={controls.tileClick} phaseLabel={phaseLabel}>
        <BattlefieldSummary report={lastMove} actorName={battle.fighters.find(fighter => fighter.id === lastMove?.actorId)?.name}/>
      </BattlefieldBoard>
      <div className="battle-element-key" aria-label="Типы клеток">{tileTypes.map(type => <span key={type}><i className={`element-icon ${type}`}>{symbols[type]}</i>{tileTypeNames[type]}</span>)}</div>
      </div>
      <CombatantRail {...rail} opponent/>
    </div>
    <div className="battle-bottom">
      <BattleSkills battle={battle} me={me} myTurn={myTurn} busy={busy} targetId={targetId} healTarget={healTarget} onAlly={controls.setAllyId} onCommand={onCommand}/>
      <BattleJournal log={battle.log}/>
    </div>
    {me?.attributes && battle.content.statDefinitions && <details className="panel battle-character-stats"><summary>Параметры в этом бою</summary><CharacterAttributes attributes={me.attributes} definitions={battle.content.statDefinitions}/></details>}
    <BattleDialogs battle={battle} controls={controls} busy={busy} choosing={choosing} seconds={seconds}
      confirmSurrender={confirmSurrender} inspectedId={inspectedId} onCommand={onCommand}
      onInspect={setInspectedId} onConfirmSurrender={setConfirmSurrender}/>
  </div>;
}
