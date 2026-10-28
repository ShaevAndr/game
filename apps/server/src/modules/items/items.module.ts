import { Module } from '@nestjs/common';
import { MongoModule } from '../../infrastructure/mongo/mongo.module';
import { ItemsService } from './application/items.service';
import { ItemsRepository } from './ports/items.repository';
import { MongoItemsRepository } from './repositories/mongo-items.repository';
import { ItemsController } from './http/items.controller';

@Module({
  imports: [MongoModule], controllers: [ItemsController],
  providers: [ItemsService, { provide: ItemsRepository, useClass: MongoItemsRepository }],
  exports: [ItemsService],
})
export class ItemsModule {}
