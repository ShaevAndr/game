import { useEffect, useRef, useState } from 'react';
import type { VoxelPosition, WorldView } from '@game/core';
import { createWorldScene } from './create-world-scene';
interface Props { region: NonNullable<WorldView['region']>; position: VoxelPosition; selected: VoxelPosition | null; onSelect: (position: VoxelPosition) => void }
export function WorldViewport({ region, position, selected, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null), scene = useRef<ReturnType<typeof createWorldScene> | null>(null);
  const select = useRef(onSelect); select.current = onSelect;
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setFailed(false);
    try { scene.current = createWorldScene(host.current!, region, p => select.current(p), () => setFailed(true)); }
    catch { setFailed(true); }
    return () => { scene.current?.dispose(); scene.current = null; };
  }, [region.cellId, region.size.x, region.size.y, region.size.z, region.blockSizeMeters, attempt]);
  useEffect(() => { scene.current?.blocks(region); }, [region, attempt]);
  useEffect(() => { scene.current?.position(position); }, [position.x, position.y, position.z, region.cellId, attempt]);
  useEffect(() => { scene.current?.selection(selected); }, [selected, attempt]);
  return <div className="world-viewport-wrap">
    <div className="world-viewport" ref={host} data-testid="world-viewport"/>
    {failed ? <div className="world-render-error" role="alert"><h3>3D-сцена недоступна</h3><p>Проверьте поддержку WebGL 2. Добыча соседних блоков и кнопки движения остаются доступны ниже.</p><button onClick={() => setAttempt(value => value + 1)}>Попробовать снова</button></div>
      : <><div className="world-view-badge"><i/> Общая позиция отряда</div><button className="ghost world-camera" onClick={() => scene.current?.resetCamera()} aria-label="Вернуть камеру к отряду">К отряду ↗</button>
        <span className="world-camera-hint">Тяни — осмотр · Колесо — масштаб · Нажми на блок — выбор</span></>}
  </div>;
}
