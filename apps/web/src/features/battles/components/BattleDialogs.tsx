import { useEffect, useRef } from 'react';
import { skillEnergy, type Battle } from '@game/core';
import type { BattleScreenProps } from '../model/battle-screen';
import type { useBattleControls } from '../model/useBattleControls';
import { SkillEnergy } from '../../../shared/ui/SkillEnergy';
import { BattleSkills } from './BattleSkills';
import { FighterDetails } from './FighterDetails';

interface Props {
  battle: Battle;
  controls: ReturnType<typeof useBattleControls>;
  busy: boolean;
  choosing: boolean;
  seconds?: number;
  confirmSurrender: boolean;
  inspectedId?: string;
  onCommand: BattleScreenProps['onCommand'];
  onInspect: (id?: string) => void;
  onConfirmSurrender: (open: boolean) => void;
}

export function BattleDialogs({ battle, controls, busy, choosing, seconds, confirmSurrender,
  inspectedId, onCommand, onInspect: setInspectedId, onConfirmSurrender: setConfirmSurrender }: Props) {
  const { me, myTurn, targetId, healTarget } = controls;
  const dialog = useRef<HTMLDialogElement>(null);
  const surrenderDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (choosing && !dialog.current?.open) dialog.current?.showModal();
    else if (!choosing && dialog.current?.open) dialog.current.close();
  }, [choosing]);
  useEffect(() => {
    const open = confirmSurrender && battle.status === 'active' && !!me && me.hp > 0;
    if (open && !surrenderDialog.current?.open) surrenderDialog.current?.showModal();
    else if (!open && surrenderDialog.current?.open) surrenderDialog.current.close();
  }, [confirmSurrender, battle.status, me?.hp]);
  return <>
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
  </>;
}
