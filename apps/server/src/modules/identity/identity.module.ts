import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { CharactersModule } from '../characters/characters.module';
import { IdentityService } from './application/identity.service';
import { IdentityRepository } from './ports/identity.repository';
import { PostgresIdentityRepository } from './repositories/postgres-identity.repository';
import { IdentityController } from './http/identity.controller';
import { SessionPresence } from './ports/session-presence';
import { RedisSessionPresence } from './repositories/redis-session-presence';

@Module({ imports: [DatabaseModule, CharactersModule], controllers: [IdentityController],
  providers: [IdentityService, { provide: IdentityRepository, useClass: PostgresIdentityRepository },
    { provide: SessionPresence, useClass: RedisSessionPresence }], exports: [IdentityService] })
export class IdentityModule {}
