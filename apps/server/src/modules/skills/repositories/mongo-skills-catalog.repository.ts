import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Skill, seedContent, defaultSkillProgression } from '@game/core';
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
    await collection.updateOne({ id: 'strike', cost: 0 }, { $set: { cost: 3, description: seedContent.skills.find(skill => skill.id === 'strike')!.description } });
    await collection.updateOne({ id: 'strike', description: 'Базовая атака за 3 физической энергии. Известна всем персонажам.' }, { $set: { description: seedContent.skills.find(skill => skill.id === 'strike')!.description } });
    for (const skill of seedContent.skills) {
      await collection.updateOne({ id: skill.id, learning: { $exists: false } }, { $set: { learning: skill.learning } });
    }
    await collection.updateMany({ 'learning.stats.maxEnergy': { $gt: 30 } }, { $set: { 'learning.stats.maxEnergy': 30 } });
    await collection.updateMany({ progression: { $exists: false } }, { $set: { progression: defaultSkillProgression } });
    await collection.updateMany({ learning: { $exists: false } }, {
      $set: { learning: { pointCost: 1, level: 1, prerequisites: [], stats: {}, starter: false } },
    });

  }
  async list(): Promise<Skill[]> {
    return this.mongo.db.collection<Skill>('skills').find({}, { projection: { _id: 0 } }).toArray();
  }
}
