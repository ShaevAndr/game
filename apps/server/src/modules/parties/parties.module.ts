import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { CharactersModule } from '../characters/characters.module';
import { IdentityModule } from '../identity/identity.module';
import { SocialModule } from '../social/social.module';
import { PartiesService } from './application/parties.service';
import { PartiesController } from './http/parties.controller';
import { PartiesRepository } from './ports/parties.repository';
import { PartyClock } from './ports/party-clock';
import { PostgresPartiesRepository } from './repositories/postgres-parties.repository';
import { SystemPartyClock } from './repositories/system-party-clock';
import { WorldJournalModule } from '../world-journal/world-journal.module';

@Module({ imports: [DatabaseModule, CharactersModule, IdentityModule, SocialModule, WorldJournalModule], controllers: [PartiesController],
  providers: [PartiesService, { provide: PartiesRepository, useClass: PostgresPartiesRepository }, { provide: PartyClock, useClass: SystemPartyClock }], exports: [PartiesService] })
export class PartiesModule {}
