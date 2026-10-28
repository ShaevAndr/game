import { Module } from '@nestjs/common';
import { MongoModule } from '../../infrastructure/mongo/mongo.module';
import { CharacterTemplatesService } from './application/character-templates.service';
import { CharacterTemplatesRepository } from './ports/character-templates.repository';
import { MongoCharacterTemplatesRepository } from './repositories/mongo-character-templates.repository';

@Module({
  imports: [MongoModule],
  providers: [CharacterTemplatesService, { provide: CharacterTemplatesRepository, useClass: MongoCharacterTemplatesRepository }],
  exports: [CharacterTemplatesService],
})
export class CharacterTemplatesModule {}
