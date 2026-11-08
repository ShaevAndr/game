import type { InventoryState } from '../inventory';
import type { Item } from '../types';
import { runGatheringMinigame, type GatheringMinigameContext } from './minigame';
import type { GatheringAction, GatheringCatalog, GatheringLoot, GatheringMethod, GatheringResource, GatheringState, GatheringView } from './types';

export const gatheringCargoCapacity = 24;
export const gatheringSteps = 4;
export const initialGatheringState = (): GatheringState => ({ revision: 0, xp: 0, discoveredResourceIds: [], expedition: null });
export const gatheringLevel = (xp: number) => Math.min(100, 1 + Math.floor(xp / 10));
const cargoSize = (cargo: GatheringLoot[]) => cargo.reduce((sum, item) => sum + item.quantity, 0);

export function gatheringMethodBlocker(state: GatheringState, inventory: InventoryState, resource: GatheringResource, method: GatheringMethod): string | undefined {
  if (gatheringLevel(state.xp) < resource.level) return `Нужен уровень собирателя ${resource.level}`;
  const primary = inventory.inventories.find(entry => entry.primary);
  if (method.toolItemId && !inventory.items.some(item => item.itemId === method.toolItemId && item.inventoryId === primary?.id && !item.equippedSlot)) return 'Нужен инструмент в основном рюкзаке';
  if (cargoSize(state.expedition?.cargo ?? []) + method.output.quantity + (method.bonus?.quantity ?? 0) > gatheringCargoCapacity) return 'Недостаточно места в грузе; вернитесь с добычей';
  return undefined;
}

/** Pure transition. Roll and the server minigame entry point are replaceable in tests. */
export function applyGatheringAction(input: GatheringState, action: GatheringAction, catalog: GatheringCatalog, inventory: InventoryState,
  newId: () => string, roll: (maxExclusive: number) => number,
  minigame: (context: GatheringMinigameContext) => boolean = runGatheringMinigame,
): { state: GatheringState; outcome: { type: GatheringAction['type']; success: boolean; loot: GatheringLoot[] }; returned: GatheringLoot[] } {
  const state = structuredClone(input);
  const outcome = { type: action.type, success: true, loot: [] as GatheringLoot[] };
  let returned: GatheringLoot[] = [];
  if (action.type === 'start') {
    if (state.expedition) throw new Error('Сначала вернитесь из текущей вылазки');
    const area = catalog.areas.find(area => area.id === action.areaId);
    const route = area?.routes.find(route => route.id === action.routeId);
    if (!area || !route) throw new Error('Область или маршрут не найдены');
    const sites = Array.from({ length: gatheringSteps }, () => {
      const pool = route.resourceIds.filter(id => id !== route.commonResourceId);
      const choices = [route.commonResourceId];
      while (pool.length && choices.length < 3) choices.push(pool.splice(roll(pool.length), 1)[0]);
      return choices;
    });
    state.expedition = { id: newId(), areaId: area.id, routeId: route.id, step: 0, sites, cargo: [] };
  } else {
    const expedition = state.expedition;
    if (!expedition) throw new Error('Нет активной вылазки');
    if (action.type === 'return') {
      returned = structuredClone(expedition.cargo); outcome.loot = structuredClone(returned);
      state.expedition = null;
    } else {
      if (expedition.step >= expedition.sites.length) throw new Error('Маршрут завершён; вернитесь с добычей');
      if (action.type === 'harvest') {
        if (!expedition.sites[expedition.step].includes(action.resourceId)) throw new Error('Ресурс отсутствует на текущей остановке');
        const resource = catalog.resources.find(resource => resource.id === action.resourceId);
        const method = resource?.methods.find(method => method.id === action.methodId);
        if (!resource || !method) throw new Error('Способ добычи не найден');
        const blocker = gatheringMethodBlocker(state, inventory, resource, method);
        if (blocker) throw new Error(blocker);
        outcome.success = minigame({ resourceId: resource.id, resourceType: resource.type, resourceLevel: resource.level, methodId: method.id });
        if (outcome.success) {
          outcome.loot.push(structuredClone(method.output));
          if (method.bonus && roll(10000) < method.bonus.chanceBps) outcome.loot.push({ itemId: method.bonus.itemId, quantity: method.bonus.quantity });
          for (const loot of outcome.loot) {
            const existing = expedition.cargo.find(item => item.itemId === loot.itemId);
            if (existing) existing.quantity += loot.quantity; else expedition.cargo.push({ ...loot });
          }
          state.xp += resource.level;
        }
      }
      expedition.step += 1;
    }
  }
  for (const id of state.expedition?.sites[state.expedition.step] ?? []) if (!state.discoveredResourceIds.includes(id)) state.discoveredResourceIds.push(id);
  state.revision += 1;
  return { state, outcome, returned };
}

export function gatheringView(state: GatheringState, catalog: GatheringCatalog, inventory: InventoryState, items: Item[]): GatheringView {
  const level = gatheringLevel(state.xp);
  const expedition = state.expedition;
  const resources = (expedition?.sites[expedition.step] ?? []).map(id => {
    const resource = catalog.resources.find(resource => resource.id === id)!;
    return { ...resource, methods: resource.methods.map(method => {
      const reason = gatheringMethodBlocker(state, inventory, resource, method);
      return { ...method, enabled: !reason, ...(reason ? { reason } : {}) };
    }) };
  });
  return {
    revision: state.revision, xp: state.xp, level, nextLevelXp: level < 100 ? level * 10 : null, cargoCapacity: gatheringCargoCapacity,
    areas: structuredClone(catalog.areas), atlas: structuredClone(catalog.resources.filter(resource => state.discoveredResourceIds.includes(resource.id))),
    expedition: expedition ? { id: expedition.id, areaId: expedition.areaId, routeId: expedition.routeId, step: expedition.step, cargo: structuredClone(expedition.cargo), totalSteps: expedition.sites.length, resources } : null,
    itemNames: Object.fromEntries(items.map(item => [item.id, item.name])),
  };
}

export function validateGatheringCatalog(catalog: GatheringCatalog, items: Item[]) {
  const fail = () => { throw new Error('Некорректный каталог добычи'); };
  if (!catalog.areas.length || new Set(catalog.areas.map(area => area.id)).size !== catalog.areas.length || new Set(catalog.resources.map(resource => resource.id)).size !== catalog.resources.length) fail();
  for (const area of catalog.areas) {
    if (!area.routes.length || new Set(area.routes.map(route => route.id)).size !== area.routes.length) fail();
    for (const route of area.routes) if (!route.resourceIds.includes(route.commonResourceId) || new Set(route.resourceIds).size !== route.resourceIds.length || route.resourceIds.some(id => !catalog.resources.some(resource => resource.id === id))) fail();
  }
  for (const resource of catalog.resources) {
    if (!Number.isInteger(resource.level) || resource.level < 1 || resource.level > 100 || !resource.methods.length || new Set(resource.methods.map(method => method.id)).size !== resource.methods.length) fail();
    for (const method of resource.methods) {
      if (method.toolItemId && !items.some(item => item.id === method.toolItemId)) fail();
      for (const output of [method.output, ...(method.bonus ? [method.bonus] : [])]) if (!Number.isSafeInteger(output.quantity) || output.quantity < 1 || output.quantity > gatheringCargoCapacity || !items.some(item => item.id === output.itemId)) fail();
      if (method.bonus && (!Number.isInteger(method.bonus.chanceBps) || method.bonus.chanceBps < 0 || method.bonus.chanceBps > 10000)) fail();
    }
  }
}
