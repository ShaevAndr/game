import { Body, Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import { AccountRequest } from '../../../shared/http/account-access';
import { SocialService } from '../application/social.service';

@Controller('social')
export class SocialController {
  constructor(@Inject(SocialService) private readonly service: SocialService) {}
  @Get() state(@Req() request: AccountRequest) { return this.service.state(request.identity!.account.id); }
  @Post('actions') async command(@Req() request: AccountRequest, @Body() body: unknown, @Res({ passthrough: true }) response: { status: (code: number) => void }) {
    const result = await this.service.command(request.identity!.account.id, body);
    response.status(result.replayed ? 200 : 201); return result;
  }
}
