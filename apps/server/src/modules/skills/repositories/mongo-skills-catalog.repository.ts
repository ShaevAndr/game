import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Skill, seedContent } from '@game/core';
import { MongoDatabase } from '../../../infrastructure/mongo/mongo.service';
import { SkillsCatalogRepository } from '../ports/skills-catalog.repository';

@Injectable()
export class MongoSkillsCatalogRepository extends SkillsCatalogRepository implements OnModuleInit {
  constructor(@Inject(MongoDatabase) private readonly mongo: MongoDatabase) { super(); }
  async onModuleInit() {
    const collection = this.mongo.db.collection<Skill>('skills');
    await collection.createIndex({ id: 1 }, { unique: true });
    for (const value of seedContent.skills) {
      await collection.updateOne({ id: value.id }, { $setOnInsert: value }, { upsert: true });
    }
    for (const skill of seedContent.skills) {
      await collection.updateOne({ id: skill.id, learning: { $exists: false } }, { $set: { learning: skill.learning } });
    }
    await collection.updateMany({ learning: { $exists: false } }, {
      $set: { learning: { pointCost: 1, level: 1, prerequisites: [], stats: {}, starter: false } },
    });

  }
  async list(): Promise<Skill[]> {
    return this.mongo.db.collection<Skill>('skills').find({}, { projection: { _id: 0 } }).toArray();
  }
}
