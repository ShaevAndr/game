import { Module } from '@nestjs/common';
import { MongoModule } from '../../infrastructure/mongo/mongo.module';
import { RecipesCatalogService } from './application/recipes-catalog.service';
import { RecipesRepository } from './ports/recipes.repository';
import { MongoRecipesRepository } from './repositories/mongo-recipes.repository';

@Module({
  imports: [MongoModule],
  providers: [RecipesCatalogService, { provide: RecipesRepository, useClass: MongoRecipesRepository }],
  exports: [RecipesCatalogService],
})
export class CraftingCatalogModule {}
