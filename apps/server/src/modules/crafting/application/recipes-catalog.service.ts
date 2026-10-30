import { Inject, Injectable } from '@nestjs/common';
import { RecipesRepository } from '../ports/recipes.repository';

@Injectable()
export class RecipesCatalogService {
  constructor(@Inject(RecipesRepository) private readonly repository: RecipesRepository) {}
  list() { return this.repository.list(); }
}
