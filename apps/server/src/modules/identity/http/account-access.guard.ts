import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { z } from 'zod';
import { AccountRequest, bearerToken, OWN_RESOURCES, PUBLIC_ACCESS, ResourceAccess } from '../../../shared/http/account-access';
import { IdentityService } from '../application/identity.service';
import { CharactersService } from '../../characters/application/characters.service';
import { InventoryService } from '../../inventory/application/inventory.service';

@Injectable()
export class AccountAccessGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector,
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(CharactersService) private readonly characters: CharactersService,
    @Inject(InventoryService) private readonly inventory: InventoryService) {}
  async canActivate(context: ExecutionContext) {
    if (context.getType() !== 'http') return true; // Gateway subscriptions authenticate separately.
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ACCESS, targets)) return true;
    const request = context.switchToHttp().getRequest<AccountRequest>();
    const session = await this.identity.authenticate(bearerToken(request));
    request.identity = session;
    for (const rule of this.reflector.getAllAndMerge<ResourceAccess[]>(OWN_RESOURCES, targets) ?? []) {
      const value = request[rule.from]?.[rule.key];
      if (value === undefined) continue; // The controller validates required fields.
      const id = z.string().uuid().parse(value);
      const characterId = rule.kind === 'character' ? id : rule.kind === 'item'
        ? await this.inventory.ownerOfItem(id) : await this.inventory.ownerOfContainer(id);
      await this.characters.assertOwned(session.account.id, characterId);
    }
    return true;
  }
}
