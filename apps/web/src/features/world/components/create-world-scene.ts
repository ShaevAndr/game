import { AmbientLight, BoxGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, EdgesGeometry, Group, HemisphereLight,
  InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, Raycaster, RingGeometry, Scene, Vector2, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { VoxelPosition, WorldView } from '@game/core';
type Region = NonNullable<WorldView['region']>;
export function createWorldScene(host: HTMLDivElement, region: Region, onSelect: (position: VoxelPosition) => void, onLost: () => void) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setClearColor('#101d25', 0);
  const canvas = renderer.domElement; canvas.tabIndex = 0; canvas.setAttribute('aria-label', '3D-участок. Перетащите для поворота, нажмите на блок для выбора.');
  host.append(canvas);
  const scene = new Scene(), scale = region.blockSizeMeters, size = Math.max(region.size.x, region.size.z, region.size.y) * scale;
  const camera = new PerspectiveCamera(43, 1, scale * .05, size * 15);
  const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.enablePan = true;
  controls.minDistance = scale * 3; controls.maxDistance = size * 3; controls.minPolarAngle = .15; controls.maxPolarAngle = Math.PI * .49;
  scene.add(new AmbientLight('#bdc9db', .65), new HemisphereLight('#d9f0ff', '#393b28', 2.3));
  const sun = new DirectionalLight('#fff0c9', 3); sun.position.set(size, size * 1.8, size * .5); scene.add(sun);
  const geometry = new BoxGeometry(scale * .985, scale * .985, scale * .985);
  const material = new MeshStandardMaterial({ roughness: 1, metalness: 0, flatShading: true });
  let blocks: Region['blocks'] = [], terrain: InstancedMesh | undefined;
  const outlineGeometry = new EdgesGeometry(geometry);
  const outlineMaterial = new LineBasicMaterial({ color: '#ffe1a0', depthTest: false });
  const outline = new LineSegments(outlineGeometry, outlineMaterial); outline.scale.setScalar(1.03); outline.visible = false; outline.renderOrder = 5; scene.add(outline);
  const party = new Group();
  const markerGeometry = new CylinderGeometry(scale * .19, scale * .26, scale * .85, 8);
  const markerMaterial = new MeshStandardMaterial({ color: '#e8efc1', roughness: .8, depthTest: false });
  const marker = new Mesh(markerGeometry, markerMaterial); marker.position.y = scale * .48; marker.renderOrder = 3;
  const flagGeometry = new ConeGeometry(scale * .18, scale * .3, 4), flagMaterial = new MeshStandardMaterial({ color: '#eeb771', emissive: '#4d2b10', depthTest: false });
  const flag = new Mesh(flagGeometry, flagMaterial); flag.position.y = scale * 1.25; flag.rotation.z = Math.PI; flag.renderOrder = 3;
  const ringGeometry = new RingGeometry(scale * .37, scale * .46, 24), ringMaterial = new MeshBasicMaterial({ color: '#e9f4ad', depthTest: false });
  const ring = new Mesh(ringGeometry, ringMaterial); ring.rotation.x = -Math.PI / 2; ring.position.y = scale * .05; ring.renderOrder = 3;
  party.add(marker, flag, ring); scene.add(party);
  let origin = new Vector3(), initialized = false, frame = 0, disposed = false;
  const render = () => {
    frame = 0; if (disposed) return;
    controls.update(); renderer.render(scene, camera);
  };
  const invalidate = () => { if (!frame && !disposed) frame = requestAnimationFrame(render); };
  controls.addEventListener('change', invalidate);
  const resize = () => {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    const previousFit = Math.max(1, 1.3 / camera.aspect);
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    if (initialized) camera.position.sub(controls.target).multiplyScalar(Math.max(1, 1.3 / camera.aspect) / previousFit).add(controls.target);
    controls.update(); invalidate();
  };
  const observer = new ResizeObserver(resize); observer.observe(host);
  const raycaster = new Raycaster(), pointer = new Vector2(); let down: { x: number; y: number; id: number } | null = null;
  const select = (event: PointerEvent) => {
    const start = down; down = null;
    if (!start || start.id !== event.pointerId || Math.hypot(start.x - event.clientX, start.y - event.clientY) > 7 || !terrain) return;
    const rect = canvas.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(terrain, false)[0];
    if (hit?.instanceId !== undefined && blocks[hit.instanceId]) onSelect({ ...blocks[hit.instanceId].position });
  };
  const start = (event: PointerEvent) => { if (event.isPrimary && event.button === 0) down = { x: event.clientX, y: event.clientY, id: event.pointerId }; else down = null; };
  const cancel = () => { down = null; };
  const lost = (event: Event) => { event.preventDefault(); onLost(); };
  canvas.addEventListener('pointerdown', start); canvas.addEventListener('pointerup', select); canvas.addEventListener('pointercancel', cancel);
  canvas.addEventListener('webglcontextlost', lost);
  const resetCamera = () => { controls.target.copy(origin).add(new Vector3(0, scale, 0));
    camera.position.copy(controls.target).add(new Vector3(size * .68, size * .72, size * .88).multiplyScalar(Math.max(1, 1.3 / camera.aspect))); controls.update(); invalidate(); };
  return {
    resetCamera,
    blocks(next: Region) {
      blocks = next.blocks;
      if (terrain) { scene.remove(terrain); terrain.dispose(); }
      terrain = new InstancedMesh(geometry, material, blocks.length);
      const matrix = new Matrix4(), palette = new Map(next.palette.map(entry => [entry.id, entry.color]));
      blocks.forEach((block, index) => {
        const p = block.position; matrix.makeTranslation((p.x + .5) * scale, (p.y + .5) * scale, (p.z + .5) * scale);
        terrain!.setMatrixAt(index, matrix); terrain!.setColorAt(index, new Color(palette.get(block.blockId) ?? '#849083'));
      });
      terrain.instanceMatrix.needsUpdate = true; if (terrain.instanceColor) terrain.instanceColor.needsUpdate = true;
      terrain.computeBoundingSphere(); scene.add(terrain); invalidate();
    },
    position(p: VoxelPosition) {
      const next = new Vector3((p.x + .5) * scale, p.y * scale, (p.z + .5) * scale);
      const delta = next.clone().sub(origin); origin = next; party.position.copy(next);
      if (!initialized) { initialized = true; resetCamera(); } else { camera.position.add(delta); controls.target.add(delta); controls.update(); }
      invalidate();
    },
    selection(p: VoxelPosition | null) {
      outline.visible = !!p; if (p) outline.position.set((p.x + .5) * scale, (p.y + .5) * scale, (p.z + .5) * scale); invalidate();
    },
    dispose() {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect(); controls.removeEventListener('change', invalidate); controls.dispose();
      canvas.removeEventListener('pointerdown', start); canvas.removeEventListener('pointerup', select); canvas.removeEventListener('pointercancel', cancel); canvas.removeEventListener('webglcontextlost', lost);
      terrain?.dispose(); geometry.dispose(); material.dispose(); outlineGeometry.dispose(); outlineMaterial.dispose();
      markerGeometry.dispose(); markerMaterial.dispose(); flagGeometry.dispose(); flagMaterial.dispose();
      ringGeometry.dispose(); ringMaterial.dispose();
      renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    },
  };
}
