import { Inject, Injectable } from '@nestjs/common';
import { ModifierDefinitionsRepository } from '../ports/modifier-definitions.repository';
@Injectable()
export class ModifierDefinitionsService {
  constructor(@Inject(ModifierDefinitionsRepository) private readonly repository: ModifierDefinitionsRepository) {}
  list() { return this.repository.list(); }
}
