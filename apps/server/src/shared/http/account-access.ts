import { createParamDecorator, ExecutionContext, SetMetadata, UnauthorizedException } from '@nestjs/common';
import type { AccountSession } from '@game/core';

export interface AccountRequest {
  headers: { authorization?: string };
  params?: Record<string, unknown>;
  body?: Record<string, unknown>;
  identity?: AccountSession;
}
export const PUBLIC_ACCESS = 'public-access';
export const OWN_RESOURCES = 'own-resources';
export const PublicAccess = () => SetMetadata(PUBLIC_ACCESS, true);
export interface ResourceAccess { kind: 'character' | 'item' | 'inventory'; from: 'params' | 'body'; key: string }
export const OwnResources = (...rules: ResourceAccess[]) => SetMetadata(OWN_RESOURCES, rules);
export const CurrentAccount = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AccountRequest>();
  if (!request.identity) throw new UnauthorizedException('Выберите аккаунт');
  return request.identity.account;
});
export function bearerToken(request: AccountRequest): string | undefined {
  return /^Bearer ([a-f0-9]{64})$/i.exec(request.headers.authorization ?? '')?.[1];
}
