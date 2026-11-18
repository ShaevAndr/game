import { useEffect, useState } from 'react';
import { worldBuildingRecipes, type VoxelPosition } from '@game/core';
import { reachableBlock, sameVoxel, directionFrames, worldTools } from './interaction';
import type { WorldScreenProps } from './world-screen';

export const worldDirections = [{ name: 'На север', icon: '↑', dx: 0, dz: -1, key: 'ArrowUp' }, { name: 'На запад', icon: '←', dx: -1, dz: 0, key: 'ArrowLeft' },
  { name: 'На юг', icon: '↓', dx: 0, dz: 1, key: 'ArrowDown' }, { name: 'На восток', icon: '→', dx: 1, dz: 0, key: 'ArrowRight' }];

export function useWorldControls({ world, playerId, party, partyReady, partyBusy, inventoryOpen, content, onInventory }: WorldScreenProps) {
  const { view } = world, position = view?.location?.position ?? null;
  const [selected, setSelected] = useState<VoxelPosition | null>(null), [toolId, setToolId] = useState<string | null>(null);
  const [menu, setMenu] = useState<'tools' | 'buildings' | null>(null), [recipeId, setRecipeId] = useState(worldBuildingRecipes[0].id);
  const isLeader = (!party || party.leaderPlayerId === playerId) && (!view || view.leaderPlayerId === playerId);
  const controlsLocked = world.busy || world.pending || partyBusy || world.stale || !partyReady || !world.ready;
  const leader = party?.members.find(member => member.playerId === party.leaderPlayerId);
  const itemName = (id: string) => content?.items.find(item => item.id === id)?.name ?? world.inventory?.definitions.find(item => item.id === id)?.name ?? id;
  const selectedBlock = view?.region?.blocks.find(block => sameVoxel(block.position, selected));
  const blockType = view?.region?.palette.find(entry => entry.id === selectedBlock?.blockId);
  const allTools = worldTools(world.inventory), tools = worldTools(world.inventory, blockType?.allowedToolClassIds);
  const tool = allTools.find(entry => entry.id === toolId) ?? null;
  useEffect(() => { if (toolId === null && allTools.length) setToolId(allTools.find(entry => !entry.reserved)?.id ?? allTools[0].id); }, [world.inventory, toolId]);
  const recipe = worldBuildingRecipes.find(entry => entry.id === recipeId)!;
  const primary = world.inventory?.inventories.find(bag => bag.primary);
  const amount = (itemId: string) => world.inventory?.items.filter(item => item.itemId === itemId && item.inventoryId === primary?.id && !item.equippedSlot && !item.actions.some(action => action.reason === 'Инструмент используется командой мира')).reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const canBuild = recipe.ingredients.every(cost => amount(cost.itemId) >= cost.quantity);
  const paused = inventoryOpen || menu !== null;
  const hit = (p: VoxelPosition) => {
    if (controlsLocked || paused || !position || !reachableBlock(position, p, view?.region?.blockSizeMeters)) return;
    const block = view?.region?.blocks.find(entry => sameVoxel(entry.position, p));
    const allowed = view?.region?.palette.find(entry => entry.id === block?.blockId)?.allowedToolClassIds ?? [];
    if (tool && !tool.reserved && allowed.includes(tool.toolClassId)) world.act({ type: 'harvest', position: p, toolInstanceId: tool.id });
  };
  const move = (dx: number, dz: number, jump = false) => { if (view && isLeader && !controlsLocked && !paused) return world.act({ type: 'move', frames: directionFrames(view, dx, dz, jump) }); return false; };
  const reason = !selectedBlock ? 'Выберите блок в сцене или в списке рядом.' : !position || !reachableBlock(position, selectedBlock.position, view?.region?.blockSizeMeters) ? 'Подойдите ближе к выбранному блоку.'
    : !blockType?.allowedToolClassIds.length ? 'Этот блок нельзя добывать.' : !tool ? 'В основном рюкзаке нужен подходящий инструмент.'
      : tool.reserved ? 'Инструмент занят предыдущим действием.' : !blockType.allowedToolClassIds.includes(tool.toolClassId) ? 'Выберите подходящий инструмент.' : '';
  const near = view?.region?.blocks.filter(block => position && reachableBlock(position, block.position, view?.region?.blockSizeMeters)) ?? [];
  const cargoSize = view?.cargo.reduce((sum, entry) => sum + entry.quantity, 0) ?? 0;
  useEffect(() => { setSelected(null); }, [view?.id, view?.region?.cellId]);
  useEffect(() => { if (selected && !selectedBlock) setSelected(null); }, [selected, selectedBlock]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey || target.closest('input,select,textarea,button,[contenteditable="true"],[role="dialog"],dialog')) return;
      if (event.code === 'KeyI' && !paused) { event.preventDefault(); onInventory(); return; }
      if (paused) return;
      const direction = worldDirections.find(entry => entry.key === event.key);
      if (!direction || !view?.region || !isLeader || controlsLocked) return;
      event.preventDefault(); move(direction.dx, direction.dz);
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [view, isLeader, controlsLocked, paused, onInventory, world.act]);

  const movementEnabled = isLeader && !partyBusy && partyReady && world.ready && !world.stale && !world.pending && (!world.busy || world.moving);
  return { movementEnabled, position, selected, setSelected, tool, tools, setToolId, menu, setMenu, recipeId, setRecipeId,
    recipe, canBuild, isLeader, controlsLocked, leader, itemName, selectedBlock, blockType, amount,
    paused, hit, move, reason, near, cargoSize };
}
