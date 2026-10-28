import { Module } from '@nestjs/common';
import { BattlefieldService } from './application/battlefield.service';

@Module({ providers: [BattlefieldService], exports: [BattlefieldService] })
export class BattlefieldModule {}
