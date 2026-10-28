import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Item, seedContent } from '@game/core';
import { MongoDatabase } from '../../../infrastructure/mongo/mongo.service';
import { ItemsRepository } from '../ports/items.repository';

@Injectable()
export class MongoItemsRepository extends ItemsRepository implements OnModuleInit {
  constructor(@Inject(MongoDatabase) private readonly mongo: MongoDatabase) { super(); }
  async onModuleInit() {
    const collection = this.mongo.db.collection<Item>('items');
    await collection.createIndex({ id: 1 }, { unique: true });
    for (const value of seedContent.items) {
      await collection.updateOne({ id: value.id }, { $setOnInsert: value }, { upsert: true });
    }
  }
  async list(): Promise<Item[]> {
    return this.mongo.db.collection<Item>('items').find({}, { projection: { _id: 0 } }).toArray();
  }
}
