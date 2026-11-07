import { Inject, Injectable } from '@nestjs/common';
import type { Account, AccountSession } from '@game/core';
import { Database } from '../../../infrastructure/database/database.service';
import { IdentityRepository } from '../ports/identity.repository';

const account = (row: { id: string; name: string; created_at: Date }): Account => ({ id: row.id, name: row.name, createdAt: row.created_at.toISOString() });

@Injectable()
export class PostgresIdentityRepository extends IdentityRepository {
  constructor(@Inject(Database) private readonly database: Database) { super(); }
  async list() { return (await this.database.sql.selectFrom('accounts').selectAll().orderBy('created_at').orderBy('id').execute()).map(account); }
  async create(value: Account) {
    const row = await this.database.sql.insertInto('accounts').values({ id: value.id, name: value.name, created_at: new Date(value.createdAt) })
      .onConflict(conflict => conflict.doNothing()).returningAll().executeTakeFirst();
    return row && account(row);
  }
  async findAccount(id: string) {
    const row = await this.database.sql.selectFrom('accounts').selectAll().where('id', '=', id).executeTakeFirst();
    return row && account(row);
  }
  async createSession(tokenHash: string, accountId: string, expiresAt: number) {
    await this.database.sql.insertInto('account_sessions').values({ token_hash: tokenHash, account_id: accountId, character_id: null, expires_at: new Date(expiresAt) }).execute();
  }
  async session(tokenHash: string, now: number): Promise<AccountSession | undefined> {
    const row = await this.database.sql.selectFrom('account_sessions').innerJoin('accounts', 'accounts.id', 'account_sessions.account_id')
      .select(['accounts.id', 'accounts.name', 'accounts.created_at', 'account_sessions.character_id', 'account_sessions.expires_at'])
      .where('token_hash', '=', tokenHash).where('expires_at', '>', new Date(now)).executeTakeFirst();
    return row && { account: account(row), characterId: row.character_id, expiresAt: row.expires_at.getTime() };
  }
  async selectCharacter(tokenHash: string, characterId: string | null, now: number) {
    await this.database.sql.updateTable('account_sessions').set({ character_id: characterId })
      .where('token_hash', '=', tokenHash).where('expires_at', '>', new Date(now)).execute();
  }
  async revoke(tokenHash: string) { await this.database.sql.deleteFrom('account_sessions').where('token_hash', '=', tokenHash).execute(); }
}
