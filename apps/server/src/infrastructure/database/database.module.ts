import { Module } from '@nestjs/common';
import { UnitOfWork } from '../../shared/application/unit-of-work';
import { Database } from './database.service';

@Module({ providers: [Database, { provide: UnitOfWork, useExisting: Database }], exports: [Database, UnitOfWork] })
export class DatabaseModule {}
