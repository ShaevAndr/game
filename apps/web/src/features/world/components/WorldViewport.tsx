import { worldInputFrameSchema } from '@game/core';
import { useEffect, useRef, useState } from 'react';
import type { VoxelPosition, WorldView, WorldMotion, WorldInputFrame } from '@game/core';
interface Props {
  region: NonNullable<WorldView['region']>; position: VoxelPosition; revision: number; locked: boolean; paused: boolean;
  motion: WorldMotion | null; motionReset: number; movementEnabled: boolean;
  targetHp: number | null; targetMaxHp: number | null; targetInfo: string;
  onSelect: (position: VoxelPosition | null) => void; onHit: (position: VoxelPosition) => void;
  onBuild: (position: VoxelPosition) => void; onFill: (position: VoxelPosition) => void;
  onMove: (frames: WorldInputFrame[]) => boolean; onInventory: () => void;
}
export function WorldViewport(props: Props) {
  const frame = useRef<HTMLIFrameElement>(null), current = useRef(props); current.current = props;
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const sentRegion = useRef<number | undefined>(undefined);
  const sync = (includeRegion = false) => {
    const target = frame.current?.contentWindow;
    if (!target) return;
    const { region, position, motion, motionReset, movementEnabled, revision, locked, paused, targetInfo, targetHp, targetMaxHp } = current.current;
    target.postMessage({ channel: 'game-world', type: 'snapshot',
      ...(includeRegion || sentRegion.current !== region.revision ? { region } : {}),
      position, motion, motionReset, movementEnabled, revision, locked, paused, targetInfo, targetHp, targetMaxHp }, location.origin);
    sentRegion.current = region.revision;
  };
  useEffect(() => { sync(); }, [props.region, props.position, props.revision, props.locked, props.paused, props.targetInfo, props.targetHp, props.targetMaxHp, props.motion, props.motionReset, props.movementEnabled]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.channel !== 'game-world') return;
      const data = event.data, next = current.current;
      if (data.type === 'loaded') { sync(true); return; }
      if (data.type === 'ready') { setFailed(false); return; }
      if (data.type === 'failed') { setFailed(true); return; }
      if (data.type === 'inventory') { if (!next.paused) next.onInventory(); return; }
      if (next.paused) { if (data.type === 'move') frame.current?.contentWindow?.postMessage({ channel: 'game-world', type: 'motion-rejected' }, location.origin); return; }
      if (data.type === 'target' && data.position === null) { next.onSelect(null); return; }
      const p = data.position;
      const valid = p && (['x', 'y', 'z'] as const).every(axis => Number.isInteger(p[axis]) && p[axis] >= 0 && p[axis] < next.region.size[axis]);
      if (data.type === 'target' && valid) next.onSelect(p);
      if (next.locked) { if (data.type === 'move') frame.current?.contentWindow?.postMessage({ channel: 'game-world', type: 'motion-rejected' }, location.origin); return; }
      if (data.type === 'hit' && valid) next.onHit(p);
      if (data.type === 'build' && valid) next.onBuild(p);
      if (data.type === 'fill' && valid) next.onFill(p);
      if (data.type === 'move') { const parsed = worldInputFrameSchema.array().min(1).max(4).safeParse(data.frames);
        if (!parsed.success || !next.onMove(parsed.data)) frame.current?.contentWindow?.postMessage({ channel: 'game-world', type: 'motion-rejected' }, location.origin); }
    };
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
  }, []);
  return <div className="world-viewport-wrap" data-testid="world-viewport">
    <iframe key={attempt} ref={frame} src="/world.html" className="world-viewport world-frame" title="Мир от первого лица" allow="fullscreen" onLoad={() => sync(true)}/>
    {failed && <div className="world-render-error" role="alert"><h3>3D-сцена недоступна</h3><p>Проверьте поддержку WebGL или откройте «Кнопочное управление» под сценой.</p><button onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Попробовать снова</button></div>}
  </div>;
}
