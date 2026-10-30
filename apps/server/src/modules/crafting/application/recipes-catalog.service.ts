import { Inject, Injectable } from '@nestjs/common';
import { RecipesRepository } from '../ports/recipes.repository';

@Injectable()
export class RecipesCatalogService {
  constructor(@Inject(RecipesRepository) private readonly repository: RecipesRepository) {}
  progression() { return this.repository.progression(); }
  list() { return this.repository.list(); }
}
