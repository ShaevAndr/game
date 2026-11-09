import { Module } from '@nestjs/common';
import { ExpeditionsModule } from './modules/expeditions/expeditions.module';

@Module({ imports: [ExpeditionsModule] })
export class WorldAppModule {}
