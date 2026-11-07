import type { Account, AccountSession } from '@game/core';

export abstract class IdentityRepository {
  abstract list(): Promise<Account[]>;
  abstract create(account: Account): Promise<Account | undefined>;
  abstract findAccount(id: string): Promise<Account | undefined>;
  abstract createSession(tokenHash: string, accountId: string, expiresAt: number): Promise<void>;
  abstract session(tokenHash: string, now: number): Promise<AccountSession | undefined>;
  abstract selectCharacter(tokenHash: string, characterId: string | null, now: number): Promise<void>;
  abstract revoke(tokenHash: string): Promise<void>;
}
