import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Account, Character, createCharacter, demoAccounts, seedContent } from '@game/core';
import { IdentityService } from '../src/modules/identity/application/identity.service';
import { IdentityRepository } from '../src/modules/identity/ports/identity.repository';
import { CharactersService } from '../src/modules/characters/application/characters.service';
import { CharactersRepository } from '../src/modules/characters/ports/characters.repository';
import { ContentService } from '../src/modules/content/application/content.service';
import { SessionPresence } from '../src/modules/identity/ports/session-presence';

function fixture() {
  const accounts: Account[] = structuredClone(demoAccounts);
  const sessions = new Map<string, { accountId: string; characterId: string | null; expiresAt: number }>();
  const heroes: Character[] = accounts.map((account, index) => ({ ...createCharacter(`00000000-0000-4000-8000-00000000000${index + 1}`, 'Герой', seedContent), accountId: account.id }));
  const repository: IdentityRepository = {
    async list() { return structuredClone(accounts); },
    async create(value) { if (accounts.some(account => account.name.toLowerCase() === value.name.toLowerCase())) return undefined; accounts.push(value); return value; },
    async findAccount(id) { return accounts.find(account => account.id === id); },
    async createSession(tokenHash, accountId, expiresAt) { sessions.set(tokenHash, { accountId, characterId: null, expiresAt }); },
    async session(tokenHash, now) {
      const session = sessions.get(tokenHash);
      return session && session.expiresAt > now ? { account: accounts.find(account => account.id === session.accountId)!, characterId: session.characterId, expiresAt: session.expiresAt } : undefined;
    },
    async selectCharacter(tokenHash, characterId) { sessions.get(tokenHash)!.characterId = characterId; },
    async revoke(tokenHash) { sessions.delete(tokenHash); },
  };
  const characters = new CharactersService({ find: async (id: string) => heroes.find(hero => hero.id === id) } as CharactersRepository, {} as ContentService);
  const leases = new Map<string, { characterId: string; expiresAt: number }>();
  const presence: SessionPresence = {
    async refresh(key, characterId, expiresAt) {
      if (characterId) leases.set(key, { characterId, expiresAt });
      else leases.delete(key);
    },
    async onlineCharacterIds(now) { return [...new Set([...leases.values()].filter(lease => lease.expiresAt > now).map(lease => lease.characterId))]; },
  };
  return { service: new IdentityService(repository, characters, presence), accounts, heroes, sessions, leases };
}

test('presence expires without requests, is renewed by REST and respects the session expiry', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const f = fixture(), login = await f.service.login({ accountId: f.accounts[0].id });
  assert.deepEqual(await f.service.onlineCharacterIds(), []);
  await f.service.selectCharacter(login.token, { characterId: f.heroes[0].id });
  assert.deepEqual(await f.service.onlineCharacterIds(), [f.heroes[0].id]);
  now += 30_000;
  assert.deepEqual(await f.service.onlineCharacterIds(), []);
  await f.service.authenticate(login.token);
  assert.deepEqual(await f.service.onlineCharacterIds(), [f.heroes[0].id]);
  const key = createHash('sha256').update(login.token).digest('hex');
  f.sessions.get(key)!.expiresAt = now + 1000;
  await f.service.authenticate(login.token);
  now += 1000;
  assert.deepEqual(await f.service.onlineCharacterIds(), []);
});

test('leaving a hero or logging out clears only that session presence', async () => {
  const f = fixture(), one = await f.service.login({ accountId: f.accounts[0].id }), two = await f.service.login({ accountId: f.accounts[0].id });
  const characterId = f.heroes[0].id;
  await f.service.selectCharacter(one.token, { characterId });
  await f.service.selectCharacter(two.token, { characterId });
  await f.service.logout(one.token);
  assert.deepEqual(await f.service.onlineCharacterIds(), [characterId]);
  await f.service.selectCharacter(two.token, { characterId: null });
  assert.deepEqual(await f.service.onlineCharacterIds(), []);
});

test('account selection issues an opaque session, stores its hash and starts at the character picker', async () => {
  const f = fixture(), login = await f.service.login({ accountId: f.accounts[0].id });
  assert.match(login.token, /^[a-f0-9]{64}$/); assert.equal(login.characterId, null);
  assert.ok(!f.sessions.has(login.token));
  const key = createHash('sha256').update(login.token).digest('hex');
  assert.equal(f.sessions.get(key)?.accountId, login.account.id);
  assert.deepEqual(await f.service.authenticate(login.token), { account: login.account, characterId: null, expiresAt: login.expiresAt });
});

test('a session selects only an owned hero; a failed selection leaves the previous hero intact', async () => {
  const f = fixture(), login = await f.service.login({ accountId: f.accounts[0].id });
  await f.service.selectCharacter(login.token, { characterId: f.heroes[0].id });
  await assert.rejects(f.service.selectCharacter(login.token, { characterId: f.heroes[1].id }), /не принадлежит/);
  assert.equal((await f.service.authenticate(login.token)).characterId, f.heroes[0].id);
  assert.equal((await f.service.selectCharacter(login.token, { characterId: null })).characterId, null);
});

test('sessions for different tabs are independent and revocation or expiration invalidates the token', async () => {
  const f = fixture(), one = await f.service.login({ accountId: f.accounts[0].id }), two = await f.service.login({ accountId: f.accounts[0].id });
  await f.service.selectCharacter(one.token, { characterId: f.heroes[0].id });
  assert.equal((await f.service.authenticate(two.token)).characterId, null);
  await f.service.logout(one.token);
  await assert.rejects(f.service.authenticate(one.token), /Сессия завершена/);
  const key = createHash('sha256').update(two.token).digest('hex'); f.sessions.get(key)!.expiresAt = Date.now() - 1;
  await assert.rejects(f.service.authenticate(two.token), /Сессия завершена/);
  await assert.rejects(f.service.authenticate(f.accounts[0].id), /Выберите аккаунт/);
});

test('account names are trimmed, unique and do not accept a caller-supplied owner ID', async () => {
  const f = fixture();
  const account = await f.service.create({ name: '  Новый игрок  ' });
  assert.equal(account.name, 'Новый игрок');
  await assert.rejects(f.service.create({ name: 'новый игрок' }), /уже существует/);
  await assert.rejects(f.service.create({ name: 'Игрок', id: f.accounts[0].id }));
});
