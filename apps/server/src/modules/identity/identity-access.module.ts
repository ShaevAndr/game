import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { IdentityModule } from './identity.module';
import { CharactersModule } from '../characters/characters.module';
import { InventoryModule } from '../inventory/inventory.module';
import { AccountAccessGuard } from './http/account-access.guard';

@Module({ imports: [IdentityModule, CharactersModule, InventoryModule],
  providers: [{ provide: APP_GUARD, useClass: AccountAccessGuard }] })
export class IdentityAccessModule {}
