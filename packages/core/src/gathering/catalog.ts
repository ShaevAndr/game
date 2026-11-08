import type { GatheringCatalog, GatheringMethod, GatheringResource, ResourceType } from './types';

const method = (id: string, name: string, itemId: string, quantity: number, toolItemId?: string): GatheringMethod =>
  ({ id, name, output: { itemId, quantity }, ...(toolItemId ? { toolItemId } : {}) });
const resource = (id: string, name: string, type: ResourceType, level: number, hint: string, methods: GatheringMethod[]): GatheringResource =>
  ({ id, name, type, level, hint, methods });

export const gatheringCatalog: GatheringCatalog = {
  areas: [
    { id: 'forest', name: 'Шепчущий лес', description: 'Лекарственные поляны, старые деревья и смоляные склоны.', routes: [
      { id: 'forest-edge', name: 'Лесная опушка', description: 'Травы и лён среди поваленных дубов. Подходит для первых вылазок.', commonResourceId: 'herb-patch', resourceIds: ['herb-patch', 'flax-patch', 'fallen-oak', 'silverleaf-patch'] },
      { id: 'pine-slope', name: 'Сосновый склон', description: 'Смоляные сосны и каменистые обнажения.', commonResourceId: 'fallen-oak', resourceIds: ['fallen-oak', 'pine-tree', 'resin-tree', 'flint-outcrop'] },
    ] },
    { id: 'marsh', name: 'Лунные топи', description: 'Тростниковые берега, целебная кора и светящиеся грибы.', routes: [
      { id: 'reed-bank', name: 'Тростниковый берег', description: 'Мирный сбор у воды и промывка речного песка.', commonResourceId: 'reed-bed', resourceIds: ['reed-bed', 'willow-tree', 'river-placer', 'herb-patch'] },
      { id: 'moon-bog', name: 'Грибная низина', description: 'Торф, лунные грибы и водные кристаллы.', commonResourceId: 'peat-bank', resourceIds: ['peat-bank', 'moon-mushrooms', 'water-geode', 'reed-bed'] },
    ] },
    { id: 'highlands', name: 'Медные высоты', description: 'Рудные жилы и кристаллические полости среди скал.', routes: [
      { id: 'stone-ravine', name: 'Каменный овраг', description: 'Кремень доступен руками; для богатых жил пригодится кирка.', commonResourceId: 'flint-outcrop', resourceIds: ['flint-outcrop', 'iron-vein', 'copper-vein', 'quartz-vein'] },
      { id: 'crystal-fault', name: 'Кристаллический разлом', description: 'Кварц и редкие кристаллы огня и земли.', commonResourceId: 'loose-iron', resourceIds: ['loose-iron', 'quartz-vein', 'fire-geode', 'earth-geode'] },
    ] },
  ],
  resources: [
    resource('herb-patch', 'Лекарственная поляна', 'plant', 1, 'Ищите влажную землю возле ручьёв.', [method('pick', 'Собрать листья', 'healing-herb', 3)]),
    resource('flax-patch', 'Дикий лён', 'plant', 1, 'Растёт на солнечной опушке.', [method('pick', 'Собрать волокна', 'wild-flax', 3)]),
    resource('fallen-oak', 'Поваленный дуб', 'tree', 1, 'Ветви и сухая древесина лежат под старыми дубами.', [method('branches', 'Собрать сухую древесину', 'oak-wood', 3), method('cut', 'Заготовить ствол', 'oak-wood', 6, 'woodcutting-axe')]),
    resource('silverleaf-patch', 'Серебролист', 'plant', 2, 'Серебристые листья видны у лесных ключей.', [method('cut', 'Срезать листья серпом', 'silverleaf', 3, 'herbal-sickle')]),
    resource('pine-tree', 'Смоляная сосна', 'tree', 2, 'Сосны предпочитают сухие склоны.', [method('cut', 'Заготовить древесину', 'pine-wood', 5, 'woodcutting-axe'), method('tap', 'Снять смолу', 'tree-resin', 2)]),
    resource('resin-tree', 'Старое смоляное дерево', 'tree', 1, 'Янтарные капли выступают на треснувшей коре.', [method('tap', 'Собрать смолу', 'tree-resin', 2)]),
    resource('flint-outcrop', 'Кремнистое обнажение', 'mineral', 1, 'Острые тёмные камни лежат у скальных осыпей.', [method('pick', 'Подобрать кремень', 'flint', 3)]),
    resource('reed-bed', 'Заросли тростника', 'plant', 1, 'Длинные стебли растут у тихой воды.', [method('pick', 'Собрать стебли', 'reed', 3)]),
    resource('willow-tree', 'Болотная ива', 'tree', 2, 'Молодая кора полезна алхимикам.', [method('bark', 'Срезать кору', 'willow-bark', 3, 'herbal-sickle')]),
    resource('river-placer', 'Речная россыпь', 'mineral', 1, 'Блеск в песке заметен на внутреннем изгибе ручья.', [
      { ...method('wash', 'Промыть песок', 'river-sand', 3), bonus: { itemId: 'copper-ore', quantity: 1, chanceBps: 2500 } },
    ]),
    resource('peat-bank', 'Торфяной берег', 'mineral', 1, 'Тёмный рыхлый торф встречается под мхом.', [method('pick', 'Собрать сухой торф', 'peat', 3)]),
    resource('moon-mushrooms', 'Лунные грибы', 'plant', 2, 'Слабое голубое свечение выдаёт грибницу.', [method('cut', 'Срезать грибы', 'moon-mushroom', 3, 'herbal-sickle')]),
    resource('water-geode', 'Водная жеода', 'crystal', 2, 'Кристаллы прячутся в мокрых полостях породы.', [method('crush', 'Раздробить на крошку', 'crystal-dust', 4, 'mining-pick'), method('extract', 'Извлечь целый кристалл', 'water-crystal', 1, 'crystal-chisel')]),
    resource('iron-vein', 'Железная жила', 'mineral', 2, 'Рыжие прожилки отмечают богатую руду.', [method('mine', 'Разработать жилу', 'iron-ore', 5, 'mining-pick')]),
    resource('copper-vein', 'Медная жила', 'mineral', 2, 'Зелёный налёт на камне указывает на медь.', [method('mine', 'Добыть медную руду', 'copper-ore', 4, 'mining-pick')]),
    resource('quartz-vein', 'Кварцевая жила', 'mineral', 2, 'Белые грани выступают из светлой породы.', [method('mine', 'Добыть кварц', 'quartz', 3, 'mining-pick')]),
    resource('loose-iron', 'Рудная осыпь', 'mineral', 1, 'Отдельные куски руды можно подобрать без кирки.', [method('pick', 'Собрать куски руды', 'iron-ore', 2)]),
    resource('fire-geode', 'Огненная жеода', 'crystal', 3, 'Тёплые трещины скрывают багровые кристаллы.', [method('crush', 'Раздробить на крошку', 'crystal-dust', 4, 'mining-pick'), method('extract', 'Извлечь целый кристалл', 'fire-crystal', 1, 'crystal-chisel')]),
    resource('earth-geode', 'Земляная жеода', 'crystal', 3, 'Тяжёлые зелёные грани растут в глубоких разломах.', [method('crush', 'Раздробить на крошку', 'crystal-dust', 4, 'mining-pick'), method('extract', 'Извлечь целый кристалл', 'earth-crystal', 1, 'crystal-chisel')]),
  ],
};
