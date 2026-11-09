// Presentation only: data and actions are supplied by the sandbox model.
const element = (tag, text, className) => {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node;
};
export function createInventoryUI({ onSelect, onDrop, onRecipe, onClose }) {
  const dialog = document.querySelector('#inventory-dialog'), list = document.querySelector('#inventory-items'), recipes = document.querySelector('#building-recipes');
  const quantities = new Map();
  document.querySelector('#close-inventory').onclick = onClose;
  dialog.addEventListener('cancel', event => { event.preventDefault(); onClose(); });
  return {
    dialog,
    render(snapshot, actor, selectedRecipe, busy) {
      const definitions = new Map(snapshot.catalog.items.map(item => [item.id, item])), items = snapshot.inventory[actor];
      document.querySelector('#inventory-count').textContent = `${items.length} / ${snapshot.capacity} мест`;
      list.replaceChildren(); recipes.replaceChildren();
      if (!items.length) list.append(element('p', 'Рюкзак пуст. Подбери предметы из мира.', 'muted'));
      for (const instance of items) {
        const definition = definitions.get(instance.itemId), card = element('article', undefined, 'inventory-card');
        card.dataset.instance = instance.id; card.dataset.item = instance.itemId;
        const heading = element('div', undefined, 'item-heading');
        heading.append(element('span', definition.icon ?? '◇', 'item-icon'), element('b', definition.name), element('span', `×${instance.quantity}`, 'quantity'));
        card.append(heading);
        if (definition.description) card.append(element('p', definition.description, 'muted'));
        if (['tool', 'weapon'].includes(definition.kind)) {
          const selected = snapshot.selectedItems[actor] === instance.id;
          const button = element('button', selected ? 'В руке ✓' : 'Взять в руку'); button.disabled = busy || selected;
          button.dataset.action = 'select'; button.setAttribute('aria-pressed', String(selected)); button.onclick = () => onSelect(instance.id); card.append(button);
        }
        const controls = element('div', undefined, 'drop-controls'), label = element('label', 'Количество');
        const input = element('input'); input.type = 'number'; input.min = '1'; input.max = String(instance.quantity); input.step = '1';
        input.value = String(Math.min(quantities.get(instance.id) ?? 1, instance.quantity)); input.disabled = busy;
        input.setAttribute('aria-label', `Количество: ${definition.name}`); input.oninput = () => quantities.set(instance.id, Number(input.value));
        label.append(input);
        const drop = element('button', 'Выбросить', 'ghost'); drop.disabled = busy; drop.dataset.action = 'drop';
        drop.onclick = () => {
          const quantity = Number(input.value);
          if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > instance.quantity) { input.setCustomValidity('Укажи целое количество от 1 до размера стека'); input.reportValidity(); return; }
          input.setCustomValidity(''); onDrop(instance.id, quantity);
        };
        controls.append(label, drop); card.append(controls); list.append(card);
      }
      for (const recipe of snapshot.catalog.recipes) {
        const card = element('article', undefined, 'recipe-card'); card.dataset.recipe = recipe.id;
        card.append(element('h3', recipe.name));
        let available = true;
        for (const row of recipe.ingredients) {
          const have = items.filter(item => item.itemId === row.itemId).reduce((sum, item) => sum + item.quantity, 0);
          const line = element('p', `${definitions.get(row.itemId).name}: ${have} / ${row.quantity}`, have >= row.quantity ? 'available' : 'missing');
          card.append(line); available &&= have >= row.quantity;
        }
        const button = element('button', recipe.id === selectedRecipe ? 'Чертёж выбран ✓' : 'Выбрать чертёж');
        button.disabled = busy || !available; button.onclick = () => onRecipe(recipe.id);
        card.append(button, element('p', available ? 'Материалы спишутся только после установки блока через ПКМ.' : 'Собери недостающие материалы.', 'muted'));
        recipes.append(card);
      }
    },
  };
}
