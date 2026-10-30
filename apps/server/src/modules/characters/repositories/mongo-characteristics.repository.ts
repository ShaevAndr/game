import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { defaultStatDefinitions, StatDefinition } from '@game/core';
import { MongoDatabase } from '../../../infrastructure/mongo/mongo.service';
import { CharacteristicsRepository } from '../ports/characteristics.repository';

@Injectable()
export class MongoCharacteristicsRepository extends CharacteristicsRepository implements OnModuleInit {
  constructor(@Inject(MongoDatabase) private readonly mongo: MongoDatabase) { super(); }
  async onModuleInit() {
    const collection = this.mongo.db.collection<StatDefinition>('statDefinitions');
    await collection.createIndex({ id: 1 }, { unique: true });
    for (const definition of defaultStatDefinitions) await collection.updateOne({ id: definition.id }, { $setOnInsert: definition }, { upsert: true });
  }
  list() { return this.mongo.db.collection<StatDefinition>('statDefinitions').find({}, { projection: { _id: 0 } }).toArray(); }
}
