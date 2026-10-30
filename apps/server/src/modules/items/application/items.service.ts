import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ItemsRepository } from '../ports/items.repository';

@Injectable()
export class ItemsService {
  constructor(@Inject(ItemsRepository) private readonly repository: ItemsRepository) {}
  ranks() { return this.repository.ranks(); }
  groups() { return this.repository.groups(); }
  list() { return this.repository.list(); }
  async get(id: string) {
    const value = (await this.list()).find(value => value.id === id);
    if (!value) throw new NotFoundException('Запись каталога не найдена');
    return value;
  }
}
