import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { CharactersModule } from '../characters/characters.module';
import { IdentityService } from './application/identity.service';
import { IdentityRepository } from './ports/identity.repository';
import { PostgresIdentityRepository } from './repositories/postgres-identity.repository';
import { IdentityController } from './http/identity.controller';

@Module({ imports: [DatabaseModule, CharactersModule], controllers: [IdentityController],
  providers: [IdentityService, { provide: IdentityRepository, useClass: PostgresIdentityRepository }], exports: [IdentityService] })
export class IdentityModule {}
