import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { CharacterTemplate, seedContent } from '@game/core';
import { MongoDatabase } from '../../../infrastructure/mongo/mongo.service';
import legacyDescriptions from './legacy-template-descriptions.json';
import { CharacterTemplatesRepository } from '../ports/character-templates.repository';

@Injectable()
export class MongoCharacterTemplatesRepository extends CharacterTemplatesRepository implements OnModuleInit {
  constructor(@Inject(MongoDatabase) private readonly mongo: MongoDatabase) { super(); }
  async onModuleInit() {
    const collection = this.mongo.db.collection<CharacterTemplate>('characterTemplates');
    await collection.createIndex({ id: 1 }, { unique: true });
    for (const value of seedContent.characterTemplates) {
      await collection.updateOne({ id: value.id }, { $setOnInsert: value }, { upsert: true });
      const legacy = legacyDescriptions[value.id as keyof typeof legacyDescriptions];
      if (legacy) await collection.updateOne({ id: value.id, description: legacy }, { $set: { description: value.description } });
    }
  }
  async list(): Promise<CharacterTemplate[]> {
    return this.mongo.db.collection<CharacterTemplate>('characterTemplates').find({}, { projection: { _id: 0 } }).toArray();
  }
}
