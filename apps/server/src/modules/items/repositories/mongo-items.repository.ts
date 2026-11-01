import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Item, ItemGroup, ItemRank, defaultItemRanks, itemRankSchema, seedContent, defaultItemGroups, itemDefinitionSchema } from '@game/core';
import { MongoDatabase } from '../../../infrastructure/mongo/mongo.service';
import { ItemsRepository } from '../ports/items.repository';
import { defaultItemScalingProfiles, itemScalingProfileSchema, type ItemScalingProfile } from '@game/core';

@Injectable()
export class MongoItemsRepository extends ItemsRepository implements OnModuleInit {
  constructor(@Inject(MongoDatabase) private readonly mongo: MongoDatabase) { super(); }
  async onModuleInit() {
    const profiles = this.mongo.db.collection<ItemScalingProfile>('itemScalingProfiles');
    await profiles.createIndex({ id: 1 }, { unique: true });
    for (const profile of defaultItemScalingProfiles) await profiles.updateOne({ id: profile.id }, { $setOnInsert: profile }, { upsert: true });
    const ranks = this.mongo.db.collection<ItemRank>('itemRanks');
    await ranks.createIndex({ id: 1 }, { unique: true });
    for (const rank of defaultItemRanks) await ranks.updateOne({ id: rank.id }, { $setOnInsert: rank }, { upsert: true });
    const groups = this.mongo.db.collection<ItemGroup>('itemGroups');
    await groups.createIndex({ id: 1 }, { unique: true });
    for (const group of defaultItemGroups) await groups.updateOne({ id: group.id }, { $setOnInsert: group }, { upsert: true });
    const collection = this.mongo.db.collection<Item>('items');
    await collection.createIndex({ id: 1 }, { unique: true });
    for (const value of seedContent.items) {
      await collection.updateOne({ id: value.id }, { $setOnInsert: { ...value, itemLevel: value.itemLevel ?? 1, version: value.version ?? 1 } }, { upsert: true });
    }
  }
  async scalingProfiles(): Promise<ItemScalingProfile[]> {
    return (await this.mongo.db.collection<ItemScalingProfile>('itemScalingProfiles').find({}, { projection: { _id: 0 } }).toArray()).map(value => itemScalingProfileSchema.parse(value));
  }
  async ranks(): Promise<ItemRank[]> {
    return (await this.mongo.db.collection<ItemRank>('itemRanks').find({}, { projection: { _id: 0 } }).sort({ order: 1 }).toArray()).map(rank => itemRankSchema.parse(rank));
  }
  async groups(): Promise<ItemGroup[]> { return this.mongo.db.collection<ItemGroup>('itemGroups').find({}, { projection: { _id: 0 } }).toArray(); }
  async list(): Promise<Item[]> {
    return (await this.mongo.db.collection<Item>('items').find({}, { projection: { _id: 0 } }).toArray()).map(item => itemDefinitionSchema.parse(item));
  }
}
