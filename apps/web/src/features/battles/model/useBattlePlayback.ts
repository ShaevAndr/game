import { useEffect, useRef, useState } from 'react';
import { Battle } from '@game/core';
import { FieldMotion, fieldPlayback } from '../../battlefield/model/field-playback';

export function useBattlePlayback(snapshot: Battle | null) {
  const [view, setView] = useState<{ battle: Battle | null; motion?: FieldMotion; playing: boolean }>({ battle: snapshot, playing: false });
  const current = useRef(snapshot);
  const version = useRef(snapshot?.version);
  useEffect(() => {
    if (!snapshot) { current.current = null; version.current = undefined; setView({ battle: null, playing: false }); return; }
    if (current.current?.id !== snapshot.id || version.current === undefined) {
      current.current = snapshot; version.current = snapshot.version;
      setView({ battle: snapshot, playing: false }); return;
    }
    if (snapshot.version <= version.current!) return;
    const previous = current.current!;
    version.current = snapshot.version;
    current.current = snapshot;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let wake: (() => void) | undefined;
    const wait = (ms: number) => new Promise<void>(resolve => { wake = resolve; timer = setTimeout(resolve, ms); });
    const play = async () => {
      let shown = previous;
      setView({ battle: previous, playing: true });
      for (const frame of snapshot.playback ?? []) {
        if (cancelled) return;
        const next = { ...snapshot, ...frame, rewards: undefined, playback: undefined };
        const actor = shown.fighters.find(fighter => fighter.id === shown.activeId);
        if (actor?.npc && shown.phase === 'before' && shown.status === 'active') {
          setView({ battle: shown, playing: true });
          await wait(1000);
          if (cancelled) return;
        }
        for (const report of frame.boardMoves ?? []) {
          for (const field of fieldPlayback(shown.board, report)) {
            setView({ battle: { ...shown, board: field.board }, motion: field.motion, playing: true });
            await wait(field.duration);
            if (cancelled) return;
          }
        }
        shown = next;
        setView({ battle: shown, playing: true });
      }
      if (!cancelled) setView({ battle: snapshot, playing: false });
    };
    void play();
    return () => { cancelled = true; clearTimeout(timer); wake?.(); };
  }, [snapshot?.id, snapshot?.version]);
  const sameRoom = view.battle?.id === snapshot?.id;
  return { battle: sameRoom ? view.battle : snapshot, fieldMotion: sameRoom ? view.motion : undefined, animating: sameRoom && (view.playing || view.battle?.version !== snapshot?.version) };
}
