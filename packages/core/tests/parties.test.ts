import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPartyMember, applyPartyManagement, invitationView, PARTY_CAPACITY, type Party, type PartyMember } from '../src';

const member = (id: string): PartyMember => ({ playerId: id, membershipId: `membership-${id}`, characterId: `hero-${id}`, characterName: id, level: 10, joinedAt: 100 });
const party = (): Party => ({ id: 'party', revision: 1, leaderPlayerId: 'one', members: [member('one'), member('two'), member('three')] });

test('party capacity includes the leader and prohibits duplicates and a seventh player without mutation', () => {
  let group = party();
  for (const id of ['four', 'five', 'six']) group = addPartyMember(group, member(id));
  assert.equal(group.members.length, PARTY_CAPACITY);
  assert.throws(() => addPartyMember(group, member('seven')), /6 игроков/);
  assert.equal(group.members.length, 6);
  assert.throws(() => addPartyMember(party(), member('two')), /уже в группе/);
});

test('only the leader can transfer, remove members or disband, and actions preserve their input', () => {
  const group = party(); const before = structuredClone(group);
  for (const action of [{ type: 'transfer', targetPlayerId: 'three' }, { type: 'kick', targetPlayerId: 'three' }, { type: 'disband' }] as const) assert.throws(() => applyPartyManagement(group, 'two', action), /лидеру/);
  const transferred = applyPartyManagement(group, 'one', { type: 'transfer', targetPlayerId: 'two' })!;
  assert.equal(transferred.leaderPlayerId, 'two'); assert.equal(transferred.revision, 2);
  assert.throws(() => applyPartyManagement(transferred, 'one', { type: 'kick', targetPlayerId: 'three' }), /лидеру/);
  const kicked = applyPartyManagement(transferred, 'two', { type: 'kick', targetPlayerId: 'three' })!;
  assert.deepEqual(kicked.members.map(member => member.playerId), ['one', 'two']);
  assert.deepEqual(group, before);
  assert.throws(() => applyPartyManagement(group, 'one', { type: 'kick', targetPlayerId: 'one' }), /Для выхода/);
});

test('leader departure elects the earliest remaining member; the last departure removes the party', () => {
  const remaining = applyPartyManagement(party(), 'one', { type: 'leave' })!;
  assert.equal(remaining.leaderPlayerId, 'two');
  const alone = applyPartyManagement(remaining, 'three', { type: 'leave' })!;
  assert.equal(applyPartyManagement(alone, 'two', { type: 'leave' }), null);
  assert.equal(applyPartyManagement(party(), 'one', { type: 'disband' }), null);
});

test('switching the displayed character preserves membership, join order and leadership', () => {
  const group = party();
  const changed = applyPartyManagement(group, 'two', { type: 'change-character' }, { ...member('two'), characterId: 'different', joinedAt: 999 })!;
  assert.equal(changed.members[1].characterId, 'different'); assert.equal(changed.members[1].joinedAt, 100);
  assert.equal(changed.leaderPlayerId, 'one');
  assert.equal(changed.members[1].membershipId, group.members[1].membershipId);
  assert.throws(() => applyPartyManagement(group, 'two', { type: 'change-character' }, member('three')), /своего/);
});

test('invitation projections never expose admission epochs', () => {
  const view = invitationView({ id: 'invite', partyId: 'party', inviterPlayerId: 'one', inviterCharacterName: 'Герой', targetPlayerId: 'two', createdAt: 1, expiresAt: 120001, resolvedAt: null, status: 'pending', interactionRevision: 5 });
  assert.equal('interactionRevision' in view, false); assert.equal(view.inviterCharacterName, 'Герой');
});
