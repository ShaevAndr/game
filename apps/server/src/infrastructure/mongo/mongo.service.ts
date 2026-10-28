import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { MongoClient } from 'mongodb';

@Injectable()
export class MongoDatabase implements OnModuleInit, OnApplicationShutdown {
  private readonly client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://localhost:27017', { serverSelectionTimeoutMS: 10000 });
  readonly db = this.client.db(process.env.MONGO_DB ?? 'elemental_tactics');
  async onModuleInit() { await this.client.connect(); }
  async onApplicationShutdown() { await this.client.close(); }
}
