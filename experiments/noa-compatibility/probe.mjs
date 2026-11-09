// Pure rules for the isolated sandbox. Canonical game inventory is not used here.
import defaultCatalog from './catalog.json' with { type: 'json' };
import { projectToNoa, key, intervalMs } from './projection.mjs';
export { projectToNoa, key, intervalMs } from './projection.mjs';
export const actors = { weak: { name: 'Сила 10', strength: 10 }, strong: { name: 'Сила 25', strength: 25 } };
export const capacity = 30;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const positive = n => Number.isSafeInteger(n) && n > 0;
const signature = value => JSON.stringify(value, function (name, child) {
  return child && typeof child === 'object' && !Array.isArray(child)
    ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b))) : child;
});

export function validateCatalog(input) {
  const catalog = structuredClone(input), ids = new Set();
  for (const item of catalog.items) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(item.id) || ids.has(item.id) || typeof item.name !== 'string' || !item.name.trim()
      || !positive(item.stackLimit) || item.stackLimit > 9999) fail('CATALOG', 'Некорректное определение предмета');
    ids.add(item.id);
    if (item.toolClassId && (!positive(item.powerMultiplier) || item.powerMultiplier > 10)) fail('CATALOG', 'Некорректная сила инструмента');
  }
  const items = new Map(catalog.items.map(item => [item.id, item]));
  for (const item of catalog.items) if (item.worldObject) {
    const object = item.worldObject;
    if (!positive(object.maxHp) || object.maxHp > 1000000 || !/^#[a-f\d]{6}$/i.test(object.color)
      || !Array.isArray(object.allowedToolClassIds) || !object.allowedToolClassIds.length || !Array.isArray(object.drops)) fail('CATALOG', 'Некорректный объект мира');
    for (const drop of object.drops) if (!items.has(drop.itemId) || items.get(drop.itemId).worldObject || !positive(drop.min) || !positive(drop.max)
      || drop.min > drop.max || drop.max > 9999 || !Number.isSafeInteger(drop.chanceBps) || drop.chanceBps < 0 || drop.chanceBps > 10000) fail('CATALOG', 'Некорректная таблица добычи');
  }
  const recipeIds = new Set();
  for (const recipe of catalog.recipes) {
    if (recipeIds.has(recipe.id) || !items.get(recipe.blockId)?.worldObject || !recipe.ingredients.length
      || new Set(recipe.ingredients.map(row => row.itemId)).size !== recipe.ingredients.length
      || recipe.ingredients.some(row => !items.has(row.itemId) || items.get(row.itemId).worldObject || !positive(row.quantity))) fail('CATALOG', 'Некорректный рецепт строительства');
    recipeIds.add(recipe.id);
  }
  for (const row of catalog.startingItems) if (!items.has(row.itemId) || items.get(row.itemId).worldObject || !positive(row.quantity)) fail('CATALOG', 'Некорректный стартовый набор');
  return catalog;
}

export function createProbe(view, options = {}) {
  const catalog = validateCatalog(options.catalog ?? defaultCatalog), clock = options.clock ?? Date.now;
  const definitions = new Map(catalog.items.map(item => [item.id, item]));
  const source = structuredClone(view), newId = () => crypto.randomUUID();
  const palette = catalog.items.filter(item => item.worldObject).map(item => ({ id: item.id, name: item.name,
    color: item.worldObject.color, allowedToolClassIds: item.worldObject.allowedToolClassIds }));
  function receive(items, itemId, quantity) {
    const definition = definitions.get(itemId);
    if (!definition || definition.worldObject || !positive(quantity)) fail('ITEM', 'Предмет нельзя получить');
    let remaining = quantity;
    for (const stack of items) if (stack.itemId === itemId && stack.quantity < definition.stackLimit) {
      const amount = Math.min(remaining, definition.stackLimit - stack.quantity); stack.quantity += amount; remaining -= amount;
    }
    while (remaining > 0) {
      if (items.length >= capacity) fail('INVENTORY_FULL', 'В рюкзаке нет места для всей находки');
      const amount = Math.min(remaining, definition.stackLimit);
      items.push({ id: newId(), itemId, quantity: amount }); remaining -= amount;
    }
  }
  function initial() {
    const inventory = {}, selectedItems = {}, positions = {};
    for (const actor of Object.keys(actors)) {
      inventory[actor] = [];
      for (const row of catalog.startingItems) receive(inventory[actor], row.itemId, row.quantity);
      selectedItems[actor] = inventory[actor].find(item => definitions.get(item.itemId).toolClassId)?.id ?? null;
      const p = source.location.position; positions[actor] = { x: p.x + .5, y: p.y, z: p.z + .5 };
    }
    return { revision: 0, blocks: source.region.blocks.map(block => {
      const maxHp = definitions.get(block.blockId)?.worldObject?.maxHp;
      if (!maxHp) fail('CATALOG', `Нет определения объекта ${block.blockId}`);
      return { ...block, hp: maxHp, maxHp };
    }), knownAir: [...projectToNoa(source).air], drops: [], inventory, selectedItems, positions, lastHit: {}, rng: 45678123, receipts: {} };
  }
  let state = structuredClone(options.state ?? initial());
  for (const block of state.blocks) if (!definitions.get(block.blockId)?.worldObject || !positive(block.maxHp)
    || !Number.isFinite(block.hp) || block.hp <= 0 || block.hp > block.maxHp) fail('CATALOG', 'Определение сохранённого объекта недоступно или повреждено');
  for (const actor of Object.keys(actors)) {
    const items = state.inventory[actor];
    if (!Array.isArray(items) || items.length > capacity || new Set(items.map(item => item.id)).size !== items.length
      || items.some(item => !definitions.has(item.itemId) || definitions.get(item.itemId).worldObject || !positive(item.quantity)
        || item.quantity > definitions.get(item.itemId).stackLimit)) fail('CATALOG', 'Определение сохранённого предмета недоступно или повреждено');
    if (state.selectedItems[actor] && !items.some(item => item.id === state.selectedItems[actor])) fail('CATALOG', 'Выбранный экземпляр отсутствует');
  }
  const publicCatalog = { items: catalog.items.filter(item => !item.worldObject).map(({ worldObject, ...item }) => item), recipes: catalog.recipes };
  const snapshot = () => structuredClone({ catalog: publicCatalog, view: { ...source, revision: state.revision,
    region: { ...source.region, revision: state.revision, palette, blocks: state.blocks } }, knownAir: state.knownAir,
    drops: state.drops, inventory: state.inventory, selectedItems: state.selectedItems, capacity, intervalMs });
  function execute(command) {
    if (!command || !actors[command.actor] || typeof command.operationId !== 'string' || !command.operationId.length || command.operationId.length > 80) fail('COMMAND', 'Некорректная команда');
    const actor = command.actor, receiptKey = `${actor}:${command.operationId}`, hash = signature(command);
    if (state.receipts[receiptKey]) {
      if (state.receipts[receiptKey] !== hash) fail('OPERATION_CONFLICT', 'ID операции уже использован для другого действия');
      return snapshot();
    }
    const next = structuredClone(state), items = next.inventory[actor], selected = () => items.find(item => item.id === next.selectedItems[actor]);
    const position = command.position, targetKey = position && key(position), block = next.blocks.find(block => key(block.position) === targetKey);
    const inside = p => p && ['x', 'y', 'z'].every(axis => Number.isInteger(p[axis]) && p[axis] >= 0 && p[axis] < source.region.size[axis]);
    if (command.playerPosition) {
      const p = command.playerPosition;
      if (!['x', 'y', 'z'].every(axis => Number.isFinite(p[axis]) && p[axis] >= 0 && p[axis] < source.region.size[axis])) fail('POSITION', 'Позиция за пределами участка');
      next.positions[actor] = { x: p.x, y: p.y, z: p.z };
    }
    const nearby = (p, range) => Math.hypot(p.x - next.positions[actor].x, p.y - next.positions[actor].y, p.z - next.positions[actor].z) <= range;
    const random = () => { let x = next.rng; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; next.rng = x >>> 0; return next.rng / 4294967296; };
    const drop = (itemId, quantity, location, owner = actor) => next.drops.push({ id: newId(), position: { ...location }, itemId, quantity, owner });
    if (command.type === 'select') {
      const instance = items.find(item => item.id === command.instanceId), definition = definitions.get(instance?.itemId);
      if (!instance || !['tool', 'weapon'].includes(definition?.kind)) fail('SELECTION', 'Выбери оружие или инструмент из своего рюкзака');
      next.selectedItems[actor] = instance.id;
    } else if (command.type === 'hit') {
      const definition = definitions.get(block?.blockId)?.worldObject, tool = definitions.get(selected()?.itemId);
      if (!inside(position) || !block || !definition || !definition.allowedToolClassIds.includes(tool?.toolClassId)) fail('WRONG_TOOL', 'Для этого объекта нужен подходящий инструмент');
      if (!nearby(position, 5)) fail('REACH', 'Подойди ближе к объекту');
      const now = clock();
      if (now - (next.lastHit[actor] ?? -Infinity) < intervalMs) fail('COOLDOWN', 'Слишком частые удары');
      next.lastHit[actor] = now;
      block.hp = Math.max(0, block.hp - actors[actor].strength * tool.powerMultiplier);
      if (block.hp === 0) {
        next.blocks = next.blocks.filter(entry => key(entry.position) !== targetKey); next.knownAir.push(targetKey);
        for (const row of definition.drops) if (random() * 10000 < row.chanceBps) {
          const quantity = row.min + Math.floor(random() * (row.max - row.min + 1));
          drop(row.itemId, quantity, { x: position.x + .5, y: position.y + .3, z: position.z + .5 });
        }
      }
    } else if (command.type === 'drop') {
      const instance = items.find(item => item.id === command.instanceId);
      if (!instance || !positive(command.quantity) || command.quantity > instance.quantity) fail('QUANTITY', 'Укажи целое количество от 1 до размера стека');
      const p = next.positions[actor];
      drop(instance.itemId, command.quantity, { x: p.x, y: p.y + .3, z: p.z }, null);
      instance.quantity -= command.quantity;
      next.inventory[actor] = items.filter(item => item.quantity > 0);
      if (instance.quantity === 0 && instance.id === next.selectedItems[actor]) next.selectedItems[actor] = null;
    } else if (command.type === 'pickup') {
      const pile = next.drops.find(drop => drop.id === command.dropId);
      if (!pile || (pile.owner && pile.owner !== actor) || !nearby(pile.position, 2.5)) fail('DROP_UNAVAILABLE', 'Находка недоступна или слишком далеко');
      receive(items, pile.itemId, pile.quantity);
      next.drops = next.drops.filter(drop => drop.id !== pile.id);
    } else if (command.type === 'place') {
      const recipe = catalog.recipes.find(recipe => recipe.id === command.recipeId);
      if (!recipe || !inside(position) || block || !next.knownAir.includes(targetKey) || !nearby(position, 5)) fail('PLACEMENT', 'Здесь нельзя установить выбранную постройку');
      const spawn = source.location.position;
      const occupied = [...Object.values(next.positions), { x: spawn.x + .5, y: spawn.y, z: spawn.z + .5 }];
      if (occupied.some(p => position.x + 1 > p.x - .3 && position.x < p.x + .3 && position.z + 1 > p.z - .3
        && position.z < p.z + .3 && position.y + 1 > p.y && position.y < p.y + 1.8)) fail('OCCUPIED', 'Место занято персонажем или нужно для входа в мир');
      for (const row of recipe.ingredients) if (items.filter(item => item.itemId === row.itemId).reduce((sum, item) => sum + item.quantity, 0) < row.quantity) fail('INGREDIENTS', 'Недостаточно материалов для постройки');
      for (const row of recipe.ingredients) {
        let remaining = row.quantity;
        for (const instance of items) if (instance.itemId === row.itemId) { const amount = Math.min(remaining, instance.quantity); instance.quantity -= amount; remaining -= amount; }
      }
      next.inventory[actor] = items.filter(item => item.quantity > 0);
      if (!next.inventory[actor].some(item => item.id === next.selectedItems[actor])) next.selectedItems[actor] = null;
      const maxHp = definitions.get(recipe.blockId).worldObject.maxHp;
      next.blocks.push({ position: { ...position }, blockId: recipe.blockId, hp: maxHp, maxHp });
      next.knownAir = next.knownAir.filter(id => id !== targetKey);
    } else fail('COMMAND', 'Неизвестное действие');
    next.revision++; next.receipts[receiptKey] = hash; state = next;
    return snapshot();
  }
  function ensureStartingSupply(itemId, quantity, operationId) {
    const receiptKey = `supply:${operationId}`, hash = signature({ itemId, quantity });
    if (state.receipts[receiptKey]) {
      if (state.receipts[receiptKey] !== hash) fail('OPERATION_CONFLICT', 'Параметры стартовой выдачи изменились');
      return;
    }
    if (!positive(quantity)) fail('QUANTITY', 'Некорректная стартовая выдача');
    const next = structuredClone(state);
    for (const actor of Object.keys(actors)) {
      const have = next.inventory[actor].filter(item => item.itemId === itemId).reduce((sum, item) => sum + item.quantity, 0);
      if (have < quantity) receive(next.inventory[actor], itemId, quantity - have);
    }
    next.receipts[receiptKey] = hash; next.revision++; state = next;
  }
  return { snapshot, execute, ensureStartingSupply, exportState: () => structuredClone(state) };
}
