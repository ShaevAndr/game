import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { WorldJournalService } from './application/world-journal.service';
import { WorldJournalRepository } from './ports/world-journal.repository';
import { PostgresWorldJournalRepository } from './repositories/postgres-world-journal.repository';
@Module({ imports: [DatabaseModule], providers: [WorldJournalService, { provide: WorldJournalRepository, useClass: PostgresWorldJournalRepository }], exports: [WorldJournalService] })
export class WorldJournalModule {}
