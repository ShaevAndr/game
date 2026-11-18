import type { Action, Battle } from '@game/core';
import type { FieldMotion } from '../../battlefield/model/field-playback';

export interface BattleScreenProps {
  battle: Battle; characterId: string; hasCharacter: boolean; busy: boolean;
  animating?: boolean; fieldMotion?: FieldMotion;
  clockOffset?: number;
  onChallenge?: () => void; challengePending?: boolean; canChallenge?: boolean;
  onCommand: (action: Action) => void; onJoin: (team: number) => void; onStart: () => void; onCopy: () => void; onCancel: () => void;
}
