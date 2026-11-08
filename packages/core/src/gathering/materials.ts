import type { Item } from '../types';
import type { CraftingRecipe } from '../crafting';

const material = (id: string, name: string, description: string): Item => ({ id, name, description, groupId: 'resources', stackLimit: 999 });
export const gatheringItems: Item[] = [
  material('silverleaf', 'Серебролист', 'Листья для больших лечебных зелий.'),
  material('oak-wood', 'Дубовая древесина', 'Рукояти инструментов и прочные заготовки.'),
  material('pine-wood', 'Сосновая древесина', 'Лёгкие заготовки для оружия.'),
  material('tree-resin', 'Древесная смола', 'Пропитка для брони и связующее для инструментов.'),
  material('wild-flax', 'Дикий лён', 'Волокна для плетёной брони.'),
  material('reed', 'Тростник', 'Лёгкий каркас плетёной брони.'),
  material('willow-bark', 'Ивовая кора', 'Основа лечебных и очищающих отваров.'),
  material('river-sand', 'Речной песок', 'Промытый песок для получения кварцевого сырья.'),
  material('peat', 'Торф', 'Топливо для обработки минерального сырья.'),
  material('moon-mushroom', 'Лунный гриб', 'Редкий компонент очищающего зелья.'),
  material('copper-ore', 'Медная руда', 'Металл для инструментов и оружия.'),
  material('flint', 'Кремень', 'Острые заготовки для первых инструментов.'),
  material('quartz', 'Кварц', 'Минеральный компонент точных инструментов.'),
  material('crystal-dust', 'Кристаллическая крошка', 'Реагент для алхимии и обработки кристаллов.'),
  material('water-crystal', 'Кристалл воды', 'Цельный образец для лечебных составов.'),
  material('fire-crystal', 'Кристалл огня', 'Цельный образец для огненных свитков.'),
  material('earth-crystal', 'Кристалл земли', 'Цельный образец для укрепления брони.'),
  ...[
    ['woodcutting-axe', 'Топор лесоруба', 'Многоразовый инструмент для заготовки стволов.'],
    ['herbal-sickle', 'Серп травника', 'Многоразовый инструмент для аккуратного сбора растений и коры.'],
    ['mining-pick', 'Рудничная кирка', 'Многоразовый инструмент для рудных жил и дробления жеод.'],
    ['crystal-chisel', 'Кристаллическое зубило', 'Многоразовый инструмент для извлечения цельных кристаллов.'],
  ].map(([id, name, description]): Item => ({ id, name, description, groupId: 'tools', stackLimit: 1 })),
];

const recipe = (id: string, name: string, inputs: [string, number][], output: string, quantity = 1, professionId?: string): CraftingRecipe => ({
  id, name, description: 'Изготовление из материалов ресурсных земель.', kind: 'craft', knownByDefault: true,
  inputs: inputs.map(([itemId, quantity]) => ({ itemId, quantity })), outputs: [{ itemId: output, quantity }], ...(professionId ? { professionId } : {}),
});
export const gatheringRecipes: CraftingRecipe[] = [
  recipe('craft-woodcutting-axe', 'Топор лесоруба', [['oak-wood', 3], ['flint', 2]], 'woodcutting-axe', 1, 'blacksmith'),
  recipe('craft-herbal-sickle', 'Серп травника', [['oak-wood', 2], ['flint', 2]], 'herbal-sickle', 1, 'blacksmith'),
  recipe('craft-mining-pick', 'Рудничная кирка', [['oak-wood', 3], ['flint', 3]], 'mining-pick', 1, 'blacksmith'),
  recipe('craft-crystal-chisel', 'Кристаллическое зубило', [['copper-ore', 3], ['quartz', 2], ['tree-resin', 1]], 'crystal-chisel', 1, 'blacksmith'),
  recipe('weave-forest-armor', 'Плетёная лесная броня', [['wild-flax', 4], ['reed', 3], ['tree-resin', 2]], 'leather-armor'),
  recipe('forge-woodland-sword', 'Меч с сосновой рукоятью', [['iron-ore', 4], ['pine-wood', 2], ['copper-ore', 1]], 'iron-sword'),
  recipe('brew-silverleaf-potion', 'Настой серебролиста', [['silverleaf', 2], ['healing-herb', 2]], 'greater-potion'),
  recipe('brew-willow-potions', 'Ивовый отвар', [['willow-bark', 2], ['healing-herb', 1]], 'potion', 3),
  recipe('brew-moon-cleansing', 'Лунное очищающее зелье', [['moon-mushroom', 2], ['willow-bark', 1]], 'cleansing-potion'),
  recipe('refine-river-quartz', 'Очистка кварцевого сырья', [['river-sand', 4], ['peat', 2]], 'quartz', 2, 'blacksmith'),
  recipe('brew-crystal-potion', 'Кристаллический настой', [['crystal-dust', 2], ['healing-herb', 2]], 'greater-potion'),
  recipe('brew-water-potions', 'Водный эликсир', [['water-crystal', 1], ['silverleaf', 2]], 'greater-potion', 3),
  recipe('scribe-fire-scroll', 'Огненные свитки', [['fire-crystal', 1], ['tree-resin', 2]], 'ember-scroll', 2, 'alchemist'),
  recipe('craft-earth-armor', 'Броня с земляным кристаллом', [['earth-crystal', 1], ['wild-flax', 3], ['tree-resin', 2]], 'leather-armor'),
];
