import { Controller, Get, Inject } from '@nestjs/common';
import { ContentService } from '../application/content.service';

@Controller('content')
export class ContentController {
  constructor(@Inject(ContentService) private readonly service: ContentService) {}
  @Get() get() { return this.service.get(); }
}
