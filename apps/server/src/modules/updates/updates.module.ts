import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { UpdatesGateway } from './http/updates.gateway';
@Module({ imports: [IdentityModule], providers: [UpdatesGateway] })
export class UpdatesModule {}
