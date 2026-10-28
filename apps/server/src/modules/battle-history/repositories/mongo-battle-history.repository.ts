import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Battle } from '@game/core';
import { MongoDatabase } from '../../../infrastructure/mongo/mongo.service';
import { BattleHistoryRepository } from '../ports/battle-history.repository';

@Injectable()
export class MongoBattleHistoryRepository extends BattleHistoryRepository implements OnModuleInit {
  constructor(@Inject(MongoDatabase) private readonly mongo: MongoDatabase) { super(); }
  async onModuleInit() { await this.mongo.db.collection('battleArchives').createIndex({ id: 1 }, { unique: true }); }
  async archive(battle: Battle) {
    if (battle.status !== 'finished') throw new Error('Only completed battles can be archived');
    await this.mongo.db.collection('battleArchives').updateOne({ id: battle.id }, { $setOnInsert: battle }, { upsert: true });
  }
}
