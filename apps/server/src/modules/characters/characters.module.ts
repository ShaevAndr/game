import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ContentModule } from '../content/content.module';
import { CharactersService } from './application/characters.service';
import { CharactersController } from './http/characters.controller';
import { CharactersRepository } from './ports/characters.repository';
import { PostgresCharactersRepository } from './repositories/postgres-characters.repository';

@Module({
  imports: [DatabaseModule, ContentModule], controllers: [CharactersController],
  providers: [CharactersService, { provide: CharactersRepository, useClass: PostgresCharactersRepository }],
  exports: [CharactersService],
})
export class CharactersModule {}
