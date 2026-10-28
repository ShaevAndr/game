import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { SkillsService } from '../application/skills.service';

@Controller()
export class SkillsController {
  constructor(@Inject(SkillsService) private readonly service: SkillsService) {}
  @Get('skills') list() { return this.service.list(); }
  @Get('skills/:id') get(@Param('id') id: string) { return this.service.get(id); }
  @Get('characters/:id/skills') owned(@Param('id') id: string) { return this.service.owned(z.string().uuid().parse(id)); }
  @Post('characters/:id/skills/:skillId/upgrade') upgrade(@Param('id') id: string, @Param('skillId') skillId: string, @Body() body: unknown) {
    return this.service.upgrade(z.string().uuid().parse(id), z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).parse(skillId), body);
  }
  @Post('characters/:id/skills') learn(@Param('id') id: string, @Body() body: unknown) {
    return this.service.learn(z.string().uuid().parse(id), body);
  }
}
