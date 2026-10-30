import { Module } from '@nestjs/common';
import { MongoModule } from '../../infrastructure/mongo/mongo.module';
import { CharacteristicsCatalogService } from './application/characteristics-catalog.service';
import { CharacteristicsRepository } from './ports/characteristics.repository';
import { MongoCharacteristicsRepository } from './repositories/mongo-characteristics.repository';

@Module({ imports: [MongoModule], providers: [CharacteristicsCatalogService, { provide: CharacteristicsRepository, useClass: MongoCharacteristicsRepository }], exports: [CharacteristicsCatalogService] })
export class CharacteristicsCatalogModule {}
