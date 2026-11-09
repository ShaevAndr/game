import { Module } from '@nestjs/common';
import { UnitOfWork } from '../../shared/application/unit-of-work';
import { WorldDatabase } from './world-database';

@Module({ providers: [WorldDatabase, { provide: UnitOfWork, useExisting: WorldDatabase }], exports: [WorldDatabase, UnitOfWork] })
export class WorldDatabaseModule {}
