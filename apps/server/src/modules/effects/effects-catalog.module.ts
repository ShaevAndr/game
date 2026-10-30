import { Module } from '@nestjs/common';
import { MongoModule } from '../../infrastructure/mongo/mongo.module';
import { ModifierDefinitionsService } from './application/modifier-definitions.service';
import { ModifierDefinitionsRepository } from './ports/modifier-definitions.repository';
import { MongoModifierDefinitionsRepository } from './repositories/mongo-modifier-definitions.repository';
@Module({
  imports: [MongoModule],
  providers: [ModifierDefinitionsService, { provide: ModifierDefinitionsRepository, useClass: MongoModifierDefinitionsRepository }],
  exports: [ModifierDefinitionsService],
})
export class EffectsCatalogModule {}
