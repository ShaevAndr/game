import { Body, Controller, Get, HttpException, Inject, Post, Query, Req, Res } from '@nestjs/common';
import { AccountRequest } from '../../../shared/http/account-access';
import { ChatService } from '../application/chat.service';

@Controller('chat')
export class ChatController {
  constructor(@Inject(ChatService) private readonly service: ChatService) {}
  @Get('feed') feed(@Req() request: AccountRequest, @Query() query: unknown) { return this.service.feed(request.identity!.account.id, query); }
  @Post('messages') async send(@Req() request: AccountRequest, @Body() body: unknown, @Res({ passthrough: true }) response: { status: (code: number) => void; setHeader: (key: string, value: string) => void }) {
    try {
      const result = await this.service.send(request.identity!, body);
      response.status(result.replayed ? 200 : 201);
      return result.message;
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 429) response.setHeader('Retry-After', '10');
      throw error;
    }
  }
}
