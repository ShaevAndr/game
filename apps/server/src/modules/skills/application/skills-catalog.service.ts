import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SkillsCatalogRepository } from '../ports/skills-catalog.repository';

@Injectable()
export class SkillsCatalogService {
  constructor(@Inject(SkillsCatalogRepository) private readonly repository: SkillsCatalogRepository) {}
  list() { return this.repository.list(); }
  async get(id: string) {
    const value = (await this.list()).find(value => value.id === id);
    if (!value) throw new NotFoundException('Запись каталога не найдена');
    return value;
  }
}
