import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { CraftingRecipe, craftingRecipeSchema, seedContent, CraftingProfession, RankProfile, defaultProfessions, defaultRankProfiles, professionSchema, rankProfileSchema } from '@game/core';
import { MongoDatabase } from '../../../infrastructure/mongo/mongo.service';
import { RecipesRepository } from '../ports/recipes.repository';

@Injectable()
export class MongoRecipesRepository extends RecipesRepository implements OnModuleInit {
  constructor(@Inject(MongoDatabase) private readonly mongo: MongoDatabase) { super(); }

  async onModuleInit() {
    for (const [name, values] of [['professions', defaultProfessions], ['rankProfiles', defaultRankProfiles]] as const) {
      const catalog = this.mongo.db.collection<{ id: string }>(name);
      await catalog.createIndex({ id: 1 }, { unique: true });
      for (const value of values) await catalog.updateOne({ id: value.id }, { $setOnInsert: value }, { upsert: true });
    }
    const collection = this.mongo.db.collection<CraftingRecipe>('recipes');
    await collection.createIndex({ id: 1 }, { unique: true });
    for (const recipe of seedContent.recipes ?? []) {
      const outputs = recipe.outputs.map(output => seedContent.items.find(item => item.id === output.itemId)?.equipSlot
        ? { ...output, rankPolicy: { mode: 'profession' as const, profileId: 'standard' } } : output);
      const professionId = defaultProfessions.find(profession => profession.groupIds.includes(seedContent.items.find(item => item.id === recipe.outputs[0]?.itemId)?.groupId ?? ''))?.id;
      const value = { ...recipe, outputs, ...(professionId ? { professionId } : {}) };
      await collection.updateOne({ id: recipe.id }, { $setOnInsert: value }, { upsert: true });
      // One-time compatible backfill for the historical local recipes.
      await collection.updateOne({ id: recipe.id, professionId: { $exists: false } }, { $set: { outputs, ...(professionId ? { professionId } : {}) } });
    }
    await collection.updateMany({ professionId: { $type: 'null' } }, { $unset: { professionId: '' } });
    await collection.updateOne({ id: 'craft-rare-sword' }, { $setOnInsert: {
      id: 'craft-rare-sword', name: 'Ковка редкого меча', description: 'Гарантированно редкий меч с тремя случайными допами.',
      kind: 'craft', knownByDefault: true, professionId: 'blacksmith', requiredLevel: 1,
      inputs: [{ itemId: 'iron-ore', quantity: 12 }], outputs: [{ itemId: 'iron-sword', quantity: 1, rankPolicy: { mode: 'fixed', rankId: 'rare' } }],
    } }, { upsert: true });
  }

  async progression() {
    const professions = await this.mongo.db.collection<CraftingProfession>('professions').find({}, { projection: { _id: 0 } }).toArray();
    const rankProfiles = await this.mongo.db.collection<RankProfile>('rankProfiles').find({}, { projection: { _id: 0 } }).toArray();
    return { professions: professions.map(value => professionSchema.parse(value)), rankProfiles: rankProfiles.map(value => rankProfileSchema.parse(value)) };
  }

  async list(): Promise<CraftingRecipe[]> {
    return (await this.mongo.db.collection<CraftingRecipe>('recipes').find({}, { projection: { _id: 0 } }).toArray())
      .map(recipe => craftingRecipeSchema.parse(recipe));
  }
}
