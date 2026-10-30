import { Inject, Injectable } from '@nestjs/common';
import { statDefinitionsSchema } from '@game/core';
import { CharacteristicsRepository } from '../ports/characteristics.repository';

@Injectable()
export class CharacteristicsCatalogService {
  constructor(@Inject(CharacteristicsRepository) private readonly repository: CharacteristicsRepository) {}
  async list() { return statDefinitionsSchema.parse(await this.repository.list()); }
}
