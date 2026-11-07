import { Body, Controller, Delete, Get, Inject, Post, Req } from '@nestjs/common';
import { AccountRequest, bearerToken, PublicAccess } from '../../../shared/http/account-access';
import { IdentityService } from '../application/identity.service';

@Controller()
export class IdentityController {
  constructor(@Inject(IdentityService) private readonly service: IdentityService) {}
  @PublicAccess() @Get('accounts') list() { return this.service.list(); }
  @PublicAccess() @Post('accounts') create(@Body() body: unknown) { return this.service.create(body); }
  @PublicAccess() @Post('identity/session') login(@Body() body: unknown) { return this.service.login(body); }
  @Get('identity/session') current(@Req() request: AccountRequest) { return request.identity; }
  @Post('identity/session/character') select(@Req() request: AccountRequest, @Body() body: unknown) {
    return this.service.selectCharacter(bearerToken(request)!, body);
  }
  @Delete('identity/session') async logout(@Req() request: AccountRequest) {
    await this.service.logout(bearerToken(request)!); return { ok: true };
  }
}
