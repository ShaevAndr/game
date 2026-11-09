import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

@Injectable()
export class ServiceTokenGuard implements CanActivate {
  private readonly token: Buffer;
  constructor() {
    const configured = process.env.WORLD_SERVICE_TOKEN;
    if (!configured || Buffer.byteLength(configured) < 32) throw new Error('WORLD_SERVICE_TOKEN must contain at least 32 bytes');
    this.token = Buffer.from(`Bearer ${configured}`);
  }
  canActivate(context: ExecutionContext): boolean {
    const header = context.switchToHttp().getRequest<Request>().headers.authorization;
    const supplied = Buffer.from(header ?? '');
    if (supplied.length !== this.token.length || !timingSafeEqual(supplied, this.token)) throw new UnauthorizedException('Требуется ключ внутреннего сервиса');
    return true;
  }
}
