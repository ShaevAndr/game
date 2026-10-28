import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CharacterTemplatesRepository } from '../ports/character-templates.repository';

@Injectable()
export class CharacterTemplatesService {
  constructor(@Inject(CharacterTemplatesRepository) private readonly repository: CharacterTemplatesRepository) {}
  list() { return this.repository.list(); }
  async get(id: string) {
    const value = (await this.list()).find(value => value.id === id);
    if (!value) throw new NotFoundException('Запись каталога не найдена');
    return value;
  }
}
