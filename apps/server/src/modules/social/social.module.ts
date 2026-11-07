import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { IdentityModule } from '../identity/identity.module';
import { SocialService } from './application/social.service';
import { SocialRepository } from './ports/social.repository';
import { PostgresSocialRepository } from './repositories/postgres-social.repository';
import { SocialController } from './http/social.controller';

@Module({ imports: [DatabaseModule, IdentityModule], controllers: [SocialController],
  providers: [SocialService, { provide: SocialRepository, useClass: PostgresSocialRepository }], exports: [SocialService] })
export class SocialModule {}
