import { Body, Controller, Inject, Post } from '@nestjs/common';
import { CharacterCreationService } from '../application/character-creation.service';

@Controller('characters')
export class CharacterCreationController {
  constructor(@Inject(CharacterCreationService) private readonly service: CharacterCreationService) {}
  @Post() create(@Body() body: unknown) { return this.service.create(body); }
}
