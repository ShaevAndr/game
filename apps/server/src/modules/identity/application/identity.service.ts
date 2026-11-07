import { ConflictException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Account, AccountLogin, AccountSession } from '@game/core';
import { z } from 'zod';
import { CharactersService } from '../../characters/application/characters.service';
import { IdentityRepository } from '../ports/identity.repository';

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class IdentityService {
  constructor(@Inject(IdentityRepository) private readonly repository: IdentityRepository,
    @Inject(CharactersService) private readonly characters: CharactersService) {}
  list() { return this.repository.list(); }
  async getAccount(id: string) {
    const account = await this.repository.findAccount(id);
    if (!account) throw new NotFoundException('Игрок не найден');
    return account;
  }
  async create(body: unknown) {
    const { name } = z.object({ name: z.string().trim().min(2).max(32) }).strict().parse(body);
    const account: Account = { id: randomUUID(), name, createdAt: new Date().toISOString() };
    const created = await this.repository.create(account);
    if (!created) throw new ConflictException('Аккаунт с таким именем уже существует');
    return created;
  }
  async login(body: unknown): Promise<AccountLogin> {
    const { accountId } = z.object({ accountId: z.string().uuid() }).strict().parse(body);
    const account = await this.repository.findAccount(accountId);
    if (!account) throw new NotFoundException('Аккаунт не найден');
    const token = randomBytes(32).toString('hex'), expiresAt = Date.now() + SESSION_LIFETIME_MS;
    await this.repository.createSession(hash(token), account.id, expiresAt);
    return { account, token, characterId: null, expiresAt };
  }
  async authenticate(token: unknown): Promise<AccountSession> {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new UnauthorizedException('Выберите аккаунт');
    const session = await this.repository.session(hash(token), Date.now());
    if (!session) throw new UnauthorizedException('Сессия завершена. Выберите аккаунт снова');
    return session;
  }
  async selectCharacter(token: string, body: unknown) {
    const { characterId } = z.object({ characterId: z.string().uuid().nullable() }).strict().parse(body);
    const session = await this.authenticate(token);
    if (characterId) await this.characters.assertOwned(session.account.id, characterId);
    await this.repository.selectCharacter(hash(token), characterId, Date.now());
    return this.authenticate(token);
  }
  logout(token: string) { return this.repository.revoke(hash(token)); }
}
