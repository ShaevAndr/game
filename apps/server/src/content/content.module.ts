import { Controller, Get, Global, Inject, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MongoClient } from 'mongodb';
import { CharacterTemplate, Content, Enemy, Item, Skill, seedContent, contentSchema } from '@game/core';

@Injectable()
export class ContentService implements OnModuleInit, OnModuleDestroy {
  private readonly client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://localhost:27017', { serverSelectionTimeoutMS: 10000 });
  private readonly db = this.client.db(process.env.MONGO_DB ?? 'elemental_tactics');
  async onModuleInit() {
    await this.client.connect();
    await this.db.collection('settings').createIndex({ id: 1 }, { unique: true });
    await this.db.collection('settings').updateOne({ id: 'balance' }, { $setOnInsert: { id: 'balance', ...seedContent.balance } }, { upsert: true });
    // Add new fields to existing databases without overwriting edited balance or skills.
    await this.db.collection('settings').updateOne({ id: 'balance', progression: { $exists: false } }, { $set: { progression: seedContent.balance.progression } });
    await this.db.collection('settings').updateOne({ id: 'balance', 'progression.victoryExperience.bot': { $exists: false } }, { $set: { 'progression.victoryExperience.bot': seedContent.balance.progression.victoryExperience.bot } });
    for (const key of ['skills', 'items', 'enemies', 'characterTemplates'] as const) {
      const collection = this.db.collection(key); await collection.createIndex({ id: 1 }, { unique: true });
      for (const value of seedContent[key]) await collection.updateOne({ id: value.id }, { $setOnInsert: value }, { upsert: true });
    }
    for (const skill of seedContent.skills) await this.db.collection('skills').updateOne({ id: skill.id, learning: { $exists: false } }, { $set: { learning: skill.learning } });
    await this.db.collection('skills').updateMany({ learning: { $exists: false } }, { $set: { learning: { pointCost: 1, level: 1, prerequisites: [], stats: {}, starter: false } } });
    await this.get();
  }
  async get(): Promise<Content> {
    const [skills, items, enemies, characterTemplates] = await Promise.all([
      this.db.collection<Skill>('skills').find({}, { projection: { _id: 0 } }).toArray(),
      this.db.collection<Item>('items').find({}, { projection: { _id: 0 } }).toArray(),
      this.db.collection<Enemy>('enemies').find({}, { projection: { _id: 0 } }).toArray(),
      this.db.collection<CharacterTemplate>('characterTemplates').find({}, { projection: { _id: 0 } }).toArray(),
    ]);
    const balance = await this.db.collection('settings').findOne({ id: 'balance' }, { projection: { _id: 0, id: 0 } });
    return contentSchema.parse({ skills, items, enemies, characterTemplates, balance });
  }
  async onModuleDestroy() { await this.client.close(); }
}
@Controller('content')
class ContentController {
  constructor(@Inject(ContentService) private readonly content: ContentService) {}
  @Get() get() { return this.content.get(); }
}
@Global()
@Module({ controllers: [ContentController], providers: [ContentService], exports: [ContentService] })
export class ContentModule {}
