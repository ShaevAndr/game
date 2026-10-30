import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Balance, Enemy, seedContent, defaultCombatRules } from '@game/core';
import { MongoDatabase } from '../../../infrastructure/mongo/mongo.service';
import { ContentSettingsRepository } from '../ports/content-settings.repository';

@Injectable()
export class MongoContentSettingsRepository extends ContentSettingsRepository implements OnModuleInit {
  constructor(@Inject(MongoDatabase) private readonly mongo: MongoDatabase) { super(); }

  async onModuleInit() {
    const settings = this.mongo.db.collection('settings');
    await settings.createIndex({ id: 1 }, { unique: true });
    await settings.updateOne({ id: 'balance' }, { $setOnInsert: { id: 'balance', ...seedContent.balance } }, { upsert: true });
    await settings.updateOne({ id: 'balance', progression: { $exists: false } }, { $set: { progression: seedContent.balance.progression } });
    await settings.updateOne({ id: 'balance', 'progression.victoryExperience.bot': { $exists: false } }, { $set: { 'progression.victoryExperience.bot': seedContent.balance.progression.victoryExperience.bot } });
    await settings.updateOne({ id: 'balance', attributes: { $exists: false } }, { $set: { attributes: { skillReferencePower: 8 } } });
    await settings.updateOne({ id: 'balance', 'combat.version': { $ne: 2 } }, { $set: { combat: defaultCombatRules, 'progression.startingSkillPoints': 4, 'progression.statGrowth.maxEnergy': 0, 'characterStats.maxEnergy': 30 } });
    const current = await settings.findOne({ id: 'balance' });
    if (current && current.craftingMaterialsVersion !== 1) {
      const starterItems = [...(current.starterItems ?? [])] as { itemId: string; quantity: number }[];
      for (const [itemId, quantity] of [['iron-ore', 60], ['leather', 40], ['healing-herb', 40]] as const) {
        const existing = starterItems.find(item => item.itemId === itemId);
        if (existing) existing.quantity = Math.max(existing.quantity, quantity);
        else starterItems.push({ itemId, quantity });
      }
      await settings.updateOne({ id: 'balance', craftingMaterialsVersion: { $ne: 1 } }, { $set: { starterItems, craftingMaterialsVersion: 1 } });
    }
    const enemies = this.mongo.db.collection<Enemy>('enemies');
    await enemies.createIndex({ id: 1 }, { unique: true });
    for (const enemy of seedContent.enemies) {
      await enemies.updateOne({ id: enemy.id }, { $setOnInsert: enemy }, { upsert: true });
    }
  }

  async get() {
    const [balance, enemies] = await Promise.all([
      this.mongo.db.collection<Balance & { id: string }>('settings').findOne({ id: 'balance' }, { projection: { _id: 0, id: 0 } }),
      this.mongo.db.collection<Enemy>('enemies').find({}, { projection: { _id: 0 } }).toArray(),
    ]);
    if (!balance) throw new Error('Balance settings are missing');
    return { balance, enemies };
  }
}
