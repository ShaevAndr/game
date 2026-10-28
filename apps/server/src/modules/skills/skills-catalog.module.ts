import { Module } from '@nestjs/common';
import { MongoModule } from '../../infrastructure/mongo/mongo.module';
import { SkillsCatalogService } from './application/skills-catalog.service';
import { SkillsCatalogRepository } from './ports/skills-catalog.repository';
import { MongoSkillsCatalogRepository } from './repositories/mongo-skills-catalog.repository';

@Module({
  imports: [MongoModule],
  providers: [SkillsCatalogService, { provide: SkillsCatalogRepository, useClass: MongoSkillsCatalogRepository }],
  exports: [SkillsCatalogService],
})
export class SkillsCatalogModule {}
