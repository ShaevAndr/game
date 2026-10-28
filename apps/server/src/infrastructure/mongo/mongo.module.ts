import { Module } from '@nestjs/common';
import { MongoDatabase } from './mongo.service';

@Module({ providers: [MongoDatabase], exports: [MongoDatabase] })
export class MongoModule {}
