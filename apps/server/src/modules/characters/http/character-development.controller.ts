import { Body, Controller, Inject, Param, Post } from '@nestjs/common';
import { OwnResources } from '../../../shared/http/account-access';
import { z } from 'zod';
import { CharacterDevelopmentService } from '../application/character-development.service';

@OwnResources({ kind: 'character', from: 'params', key: 'id' })
@Controller('characters')
export class CharacterDevelopmentController {
  constructor(@Inject(CharacterDevelopmentService) private readonly service: CharacterDevelopmentService) {}
  @Post(':id/attributes') allocate(@Param('id') id: string, @Body() body: unknown) { return this.service.allocate(z.string().uuid().parse(id), body); }
}
