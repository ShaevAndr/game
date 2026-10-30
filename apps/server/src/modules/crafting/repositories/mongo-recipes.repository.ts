import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { CraftingRecipe, craftingRecipeSchema, seedContent } from '@game/core';
import { MongoDatabase } from '../../../infrastructure/mongo/mongo.service';
import { RecipesRepository } from '../ports/recipes.repository';

@Injectable()
export class MongoRecipesRepository extends RecipesRepository implements OnModuleInit {
  constructor(@Inject(MongoDatabase) private readonly mongo: MongoDatabase) { super(); }

  async onModuleInit() {
    const collection = this.mongo.db.collection<CraftingRecipe>('recipes');
    await collection.createIndex({ id: 1 }, { unique: true });
    for (const recipe of seedContent.recipes ?? []) {
      await collection.updateOne({ id: recipe.id }, { $setOnInsert: recipe }, { upsert: true });
    }
  }

  async list(): Promise<CraftingRecipe[]> {
    return (await this.mongo.db.collection<CraftingRecipe>('recipes').find({}, { projection: { _id: 0 } }).toArray())
      .map(recipe => craftingRecipeSchema.parse(recipe));
  }
}
