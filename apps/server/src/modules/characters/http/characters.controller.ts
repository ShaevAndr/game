import { Controller, Get, Inject, Param } from '@nestjs/common';
import { Account } from '@game/core';
import { CurrentAccount, OwnResources } from '../../../shared/http/account-access';
import { z } from 'zod';
import { CharactersService } from '../application/characters.service';

@OwnResources({ kind: 'character', from: 'params', key: 'id' })
@Controller('characters')
export class CharactersController {
  constructor(@Inject(CharactersService) private readonly service: CharactersService) {}
  @Get() list(@CurrentAccount() account: Account) { return this.service.list(account.id); }
  @Get(':id') get(@Param('id') id: string) { return this.service.get(z.string().uuid().parse(id)); }
}
