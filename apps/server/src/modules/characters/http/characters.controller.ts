import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CharactersService } from '../application/characters.service';

@Controller('characters')
export class CharactersController {
  constructor(@Inject(CharactersService) private readonly service: CharactersService) {}
  @Get() list() { return this.service.list(); }
  @Get(':id') get(@Param('id') id: string) { return this.service.get(z.string().uuid().parse(id)); }
  @Post() create(@Body() body: unknown) { return this.service.create(body); }
}
