import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ContentModule } from '../content/content.module';
import { CharactersService } from './application/characters.service';
import { CharactersController } from './http/characters.controller';
import { CharactersRepository } from './ports/characters.repository';
import { PostgresCharactersRepository } from './repositories/postgres-characters.repository';
import { CharacterDevelopmentService } from './application/character-development.service';
import { CharacterDevelopmentController } from './http/character-development.controller';

@Module({
  imports: [DatabaseModule, ContentModule], controllers: [CharactersController, CharacterDevelopmentController],
  providers: [CharactersService, CharacterDevelopmentService, { provide: CharactersRepository, useClass: PostgresCharactersRepository }],
  exports: [CharactersService],
})
export class CharactersModule {}
