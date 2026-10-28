import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Item, ItemGroup, seedContent, defaultItemGroups, itemDefinitionSchema } from '@game/core';
import { MongoDatabase } from '../../../infrastructure/mongo/mongo.service';
import { ItemsRepository } from '../ports/items.repository';

@Injectable()
export class MongoItemsRepository extends ItemsRepository implements OnModuleInit {
  constructor(@Inject(MongoDatabase) private readonly mongo: MongoDatabase) { super(); }
  async onModuleInit() {
    const groups = this.mongo.db.collection<ItemGroup>('itemGroups');
    await groups.createIndex({ id: 1 }, { unique: true });
    for (const group of defaultItemGroups) await groups.updateOne({ id: group.id }, { $setOnInsert: group }, { upsert: true });
    const collection = this.mongo.db.collection<Item>('items');
    await collection.createIndex({ id: 1 }, { unique: true });
    for (const value of seedContent.items) {
      await collection.updateOne({ id: value.id }, { $setOnInsert: value }, { upsert: true });
    }
    await collection.updateMany({ groupId: { $exists: false } }, { $set: { groupId: 'potions' } });
    await collection.updateMany({ stackLimit: { $exists: false } }, { $set: { stackLimit: 99 } });
  }
  async groups(): Promise<ItemGroup[]> { return this.mongo.db.collection<ItemGroup>('itemGroups').find({}, { projection: { _id: 0 } }).toArray(); }
  async list(): Promise<Item[]> {
    return (await this.mongo.db.collection<Item>('items').find({}, { projection: { _id: 0 } }).toArray()).map(item => itemDefinitionSchema.parse(item));
  }
}
