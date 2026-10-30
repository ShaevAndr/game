import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CraftingService } from '../application/crafting.service';

const id = z.string().uuid();
const contentId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);

@Controller()
export class CraftingController {
  constructor(@Inject(CraftingService) private readonly service: CraftingService) {}

  @Get('crafting/recipes') catalog() { return this.service.catalog(); }

  @Post('characters/:id/crafting/recipes/:recipeId/apply')
  apply(@Param('id') ownerId: string, @Param('recipeId') recipeId: string, @Body() body: unknown) {
    return this.service.apply(id.parse(ownerId), contentId.parse(recipeId), body);
  }

  @Post('characters/:id/crafting/blind')
  blind(@Param('id') ownerId: string, @Body() body: unknown) {
    return this.service.blind(id.parse(ownerId), body);
  }
}
