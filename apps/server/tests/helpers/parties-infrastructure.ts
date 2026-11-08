import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Account, AccountLogin, Character, PartyAction, PartyCommand, PartyCommandResult, PartyState, SocialState } from '@game/core';
import { Database } from '../../src/infrastructure/database/database.service';
import { PartiesRepository } from '../../src/modules/parties/ports/parties.repository';
import { PartyClock } from '../../src/modules/parties/ports/party-clock';

export async function verifyParties(app: INestApplication, origin: string) {
  const call = async <T>(token: string, path: string, body?: object, expected = body ? 201 : 200): Promise<T> => {
    const response = await fetch(`${origin}/api/v1${path}`, { method: body ? 'POST' : 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value as T;
  };
  const suffix = randomUUID().slice(0, 8);
  const actors = [];
  for (const name of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
    const account = await call<Account>('', '/accounts', { name: `Группа ${suffix} ${name}` });
    const login = await call<AccountLogin>('', '/identity/session', { accountId: account.id });
    await call(login.token, '/parties/actions', { operationId: randomUUID(), expectedPartyId: null, expectedRevision: 0, action: { type: 'leave' } }, 400);
    const hero = await call<Character>(login.token, '/characters', { name: `Спутник ${name}` });
    await call(login.token, '/identity/session/character', { characterId: hero.id });
    actors.push({ account, token: login.token, hero });
  }
  type Actor = typeof actors[number];
  const [a, b, c, d, e, f, g, h] = actors;
  const state = (actor: Actor) => call<PartyState>(actor.token, '/parties');
  const make = async (actor: Actor, action: PartyAction): Promise<PartyCommand> => {
    const value = await state(actor); return { operationId: randomUUID(), expectedPartyId: value.party?.id ?? null, expectedRevision: value.party?.revision ?? 0, action };
  };
  const command = async (actor: Actor, action: PartyAction, status = 201) => call<PartyCommandResult>(actor.token, '/parties/actions', await make(actor, action), status);
  const invite = async (one: Actor, two: Actor) => (await command(one, { type: 'invite', targetPlayerId: two.account.id })).invitationId!;
  const accept = (actor: Actor, id: string, status = 201) => command(actor, { type: 'accept', invitationId: id }, status);
  const clock = app.get(PartyClock), originalNow = clock.now;
  let now = Date.now(); clock.now = () => now;
  try {
    await call('', '/parties', undefined, 401);
    let id = await invite(a, b);
    let incoming = (await state(b)).incoming;
    assert.equal(incoming.length, 1); assert.equal(incoming[0].inviterCharacterName, a.hero.name);
    assert.equal('interactionRevision' in incoming[0], false);
    assert.equal((await state(a)).capacity, 6); assert.equal((await state(b)).party, null);
    await accept(c, id, 403);
    const declining = await make(b, { type: 'decline', invitationId: id });
    await call(b.token, '/parties/actions', declining);
    await call(b.token, '/parties/actions', declining, 200);
    assert.equal((await state(b)).incoming.length, 0); assert.equal((await state(b)).party, null);
    await command(a, { type: 'invite', targetPlayerId: b.account.id }, 409);
    now += 31_000;
    const inviting = await make(a, { type: 'invite', targetPlayerId: b.account.id });
    const invited = await call<PartyCommandResult>(a.token, '/parties/actions', inviting); id = invited.invitationId!;
    const replay = await call<PartyCommandResult>(a.token, '/parties/actions', inviting, 200);
    assert.equal(replay.invitationId, id); assert.equal(replay.replayed, true);
    await call(a.token, '/parties/actions', { ...inviting, action: { type: 'leave' } }, 409);
    assert.equal((await command(a, { type: 'invite', targetPlayerId: b.account.id })).invitationId, id);
    await command(a, { type: 'cancel', invitationId: id });
    assert.equal((await state(b)).incoming.length, 0); await accept(b, id, 409);
    id = await invite(a, b); await accept(b, id);
    assert.equal((await state(a)).party!.members.length, 2);
    assert.equal((await state(b)).incoming.length, 0);
    await command(b, { type: 'invite', targetPlayerId: c.account.id }, 403);
    await command(b, { type: 'transfer', targetPlayerId: a.account.id }, 403);
    await command(b, { type: 'disband' }, 403);
    const cancelledByTransfer = await invite(a, c);
    await command(a, { type: 'transfer', targetPlayerId: b.account.id });
    assert.equal((await state(b)).party!.leaderPlayerId, b.account.id);
    assert.equal((await state(c)).incoming.length, 0); await accept(c, cancelledByTransfer, 409);
    await accept(c, await invite(b, c));
    await command(a, { type: 'kick', targetPlayerId: c.account.id }, 403);
    await command(b, { type: 'kick', targetPlayerId: c.account.id });
    assert.equal((await state(c)).party, null);
    await command(b, { type: 'leave' });
    assert.equal((await state(a)).party!.leaderPlayerId, a.account.id);
    assert.equal((await state(b)).party, null);

    const secondHero = await call<Character>(a.token, '/characters', { name: 'Новый герой лидера' });
    await call(a.token, '/identity/session/character', { characterId: secondHero.id });
    assert.equal((await state(a)).party!.members[0].characterId, a.hero.id, 'session selection alone does not change the party character');
    await command(a, { type: 'change-character' });
    assert.equal((await state(a)).party!.members[0].characterId, secondHero.id);
    const expired = await invite(a, c); now += 120_001;
    assert.equal((await state(c)).incoming.length, 0); await accept(c, expired, 409);

    const blockedInvitation = await invite(a, c);
    const social = async (action: 'block' | 'unblock') => {
      const current = await call<SocialState>(c.token, '/social');
      await call(c.token, '/social/actions', { operationId: randomUUID(), targetPlayerId: a.account.id, action,
        expectedRevision: current.relationships.find(row => row.playerId === a.account.id)?.revision ?? 0 });
    };
    await social('block');
    assert.equal((await state(c)).incoming.length, 0);
    await command(a, { type: 'invite', targetPlayerId: c.account.id }, 403); await accept(c, blockedInvitation, 403);
    await social('unblock');
    assert.equal((await state(c)).incoming.length, 0, 'unblocking must not resurrect the prompt');
    await accept(c, blockedInvitation, 403);
    await accept(c, await invite(a, c));
    for (const actor of [b, d, e]) await accept(actor, await invite(a, actor));
    assert.equal((await state(a)).party!.members.length, 5);
    const invitationF = await invite(a, f), invitationG = await invite(a, g);
    const contenders = await Promise.all([make(f, { type: 'accept', invitationId: invitationF }), make(g, { type: 'accept', invitationId: invitationG })]);
    const lastSeat = await Promise.all([f, g].map((actor, index) => fetch(`${origin}/api/v1/parties/actions`, { method: 'POST', headers: { Authorization: `Bearer ${actor.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(contenders[index]) })));
    assert.deepEqual(lastSeat.map(response => response.status).sort(), [201, 409]);
    assert.equal((await state(a)).party!.members.length, 6);
    assert.equal(new Set((await state(a)).party!.members.map(member => member.playerId)).size, 6);
    assert.equal((await state(f)).incoming.length + (await state(g)).incoming.length, 0);
    await command(a, { type: 'invite', targetPlayerId: h.account.id }, 409);
    await command(a, { type: 'disband' });
    for (const actor of actors) assert.equal((await state(actor)).party, null);

    // Competing groups cannot both recruit the same account.
    const fromD = await invite(d, h), fromE = await invite(e, h);
    const joins = await Promise.all([make(h, { type: 'accept', invitationId: fromD }), make(h, { type: 'accept', invitationId: fromE })]);
    const joined = await Promise.all(joins.map(body => fetch(`${origin}/api/v1/parties/actions`, { method: 'POST', headers: { Authorization: `Bearer ${h.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })));
    assert.deepEqual(joined.map(response => response.status).sort(), [201, 409]);
    assert.equal((await app.get(Database).sql.selectFrom('party_members').select('player_id').where('player_id', '=', h.account.id).execute()).length, 1);
    assert.equal((await state(h)).incoming.length, 0);
    clock.now = originalNow;

    const before = await state(d), failing = await make(d, { type: 'invite', targetPlayerId: g.account.id });
    const repository = app.get(PartiesRepository), complete = repository.complete;
    repository.complete = async () => { throw new Error('simulated party receipt failure'); };
    try { await call(d.token, '/parties/actions', failing, 500); } finally { repository.complete = complete; }
    const after = await state(d);
    assert.deepEqual(after.party, before.party); assert.deepEqual(after.outgoing, before.outgoing);
    assert.equal((await state(g)).incoming.length, 0);
    assert.equal((await app.get(Database).sql.selectFrom('party_operations').selectAll().where('operation_id', '=', failing.operationId).execute()).length, 0);
    const checkpoint = await call<PartyCommandResult>(d.token, '/parties/actions', failing);
    incoming = (await state(g)).incoming;
    assert.equal(incoming.length, 1); assert.equal(incoming[0].id, checkpoint.invitationId);
    return { token: d.token, recipientToken: g.token, party: (await state(d)).party, invitationId: checkpoint.invitationId, command: failing };
  } finally { clock.now = originalNow; }
}
