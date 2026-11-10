import { worldInputFrameSchema } from '@game/core';
import { useEffect, useRef, useState } from 'react';
import type { VoxelPosition, WorldView, WorldMotion, WorldInputFrame } from '@game/core';
interface Props {
  region: NonNullable<WorldView['region']>; position: VoxelPosition; revision: number; locked: boolean; paused: boolean;
  motion: WorldMotion | null; motionReset: number; movementEnabled: boolean;
  targetHp: number | null; targetMaxHp: number | null; targetInfo: string; feedback: string; cargoInfo: string; error: boolean;
  onSelect: (position: VoxelPosition | null) => void; onHit: (position: VoxelPosition) => void;
  onBuild: (position: VoxelPosition) => void; onMove: (frames: WorldInputFrame[]) => boolean; onInventory: () => void;
}
export function WorldViewport(props: Props) {
  const frame = useRef<HTMLIFrameElement>(null), current = useRef(props); current.current = props;
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const sync = () => frame.current?.contentWindow?.postMessage({ channel: 'game-world', type: 'snapshot', region: current.current.region,
    position: current.current.position, motion: current.current.motion, motionReset: current.current.motionReset, movementEnabled: current.current.movementEnabled, revision: current.current.revision, locked: current.current.locked, paused: current.current.paused, targetInfo: current.current.targetInfo, feedback: current.current.feedback, cargoInfo: current.current.cargoInfo, error: current.current.error, targetHp: current.current.targetHp, targetMaxHp: current.current.targetMaxHp }, location.origin);
  useEffect(() => { sync(); }, [props.region, props.position, props.revision, props.locked, props.paused, props.targetInfo, props.feedback, props.cargoInfo, props.error, props.targetHp, props.targetMaxHp, props.motion, props.motionReset, props.movementEnabled]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.channel !== 'game-world') return;
      const data = event.data, next = current.current;
      if (data.type === 'loaded') { sync(); return; }
      if (data.type === 'ready') { setFailed(false); return; }
      if (data.type === 'failed') { setFailed(true); return; }
      if (data.type === 'inventory') { next.onInventory(); return; }
      if (next.paused) { if (data.type === 'move') frame.current?.contentWindow?.postMessage({ channel: 'game-world', type: 'motion-rejected' }, location.origin); return; }
      if (data.type === 'target' && data.position === null) { next.onSelect(null); return; }
      const p = data.position;
      const valid = p && (['x', 'y', 'z'] as const).every(axis => Number.isInteger(p[axis]) && p[axis] >= 0 && p[axis] < next.region.size[axis]);
      if (data.type === 'target' && valid) next.onSelect(p);
      if (next.locked) { if (data.type === 'move') frame.current?.contentWindow?.postMessage({ channel: 'game-world', type: 'motion-rejected' }, location.origin); return; }
      if (data.type === 'hit' && valid) next.onHit(p);
      if (data.type === 'build' && valid) next.onBuild(p);
      if (data.type === 'move') { const parsed = worldInputFrameSchema.array().min(1).max(4).safeParse(data.frames);
        if (!parsed.success || !next.onMove(parsed.data)) frame.current?.contentWindow?.postMessage({ channel: 'game-world', type: 'motion-rejected' }, location.origin); }
    };
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
  }, []);
  return <div className="world-viewport-wrap" data-testid="world-viewport">
    <iframe key={attempt} ref={frame} src="/world.html" className="world-viewport world-frame" title="Мир от первого лица" allow="fullscreen" onLoad={sync}/>
    {failed && <div className="world-render-error" role="alert"><h3>3D-сцена недоступна</h3><p>Проверьте поддержку WebGL. Выбор блоков и кнопки движения доступны ниже.</p><button onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Попробовать снова</button></div>}
  </div>;
}
