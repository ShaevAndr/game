import { Body, Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import type { AccountRequest } from '../../../shared/http/account-access';
import { PartiesService } from '../application/parties.service';

@Controller('parties')
export class PartiesController {
  constructor(@Inject(PartiesService) private readonly service: PartiesService) {}
  @Get() state(@Req() request: AccountRequest) { return this.service.state(request.identity!); }
  @Post('actions') async command(@Req() request: AccountRequest, @Body() body: unknown, @Res({ passthrough: true }) response: { status: (code: number) => void }) {
    const result = await this.service.command(request.identity!, body);
    response.status(result.replayed ? 200 : 201); return result;
  }
}
