import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle, Character, emptyEnergy, joinBattle, newBattle, possibleMove, seedContent, startBattle } from '@game/core';
import { BattlesService } from '../src/battles/battles.module';
import { BattlesGateway } from '../src/battles/battles.gateway';
import { CharactersService } from '../src/characters/characters.module';
import { ContentService } from '../src/content/content.module';
import { Database } from '../src/database/database.module';

const winnerId = '00000000-0000-4000-8000-000000000001', loserId = '00000000-0000-4000-8000-000000000002';
const battleId = '00000000-0000-4000-8000-000000000003';
const hero = (id: string): Character => ({ id, name: id === winnerId ? 'Winner' : 'Loser', level: 1, experience: 0, skillPoints: 2, learnedSkillIds: ['strike'], stats: { ...seedContent.balance.characterStats }, energy: emptyEnergy(), inventory: [], createdAt: new Date().toISOString() });
interface State { characters: Record<string, { data: Character }>; battles: Record<string, { data: Battle; version: number }>; receipts: string[] }
/** Transactional test double: exercises service rollback and command races without a running PostgreSQL. */
function fixture() {
  const winner = hero(winnerId), loser = hero(loserId);
  const battle = newBattle(battleId, 'test', 'duel', 'before', winner, seedContent);
  joinBattle(battle, loser, 1); startBattle(battle); battle.fighters[0].stats.attack = 1000;
  let state: State = { characters: { [winnerId]: { data: winner }, [loserId]: { data: loser } }, battles: { [battleId]: { data: battle, version: 0 } }, receipts: [] };
  let tail = Promise.resolve(), failCharacterWrite = false;
  const locks: string[] = [], published: Battle[] = [];
  const database = {
    sql: { transaction: () => ({ execute: async (callback: (tx: unknown) => Promise<unknown>) => {
      const previous = tail; let release!: () => void; tail = new Promise<void>(resolve => { release = resolve; }); await previous;
      const draft = structuredClone(state);
      const tx = {
        selectFrom: (table: 'battles' | 'characters') => {
          let id = '', locked = false;
          const query = { selectAll: () => query, select: () => query, where: (_column: string, _operator: string, value: string) => { id = value; return query; }, forUpdate: () => { locked = true; return query; }, executeTakeFirst: async () => { assert.ok(locked, `${table} must use FOR UPDATE`); locks.push(`${table}:${id}`); return structuredClone(draft[table][id]); } };
          return query;
        },
        updateTable: (table: 'battles' | 'characters') => {
          let id = '', values: { data: string; version?: number };
          const query = { set: (value: typeof values) => { values = value; return query; }, where: (_column: string, _operator: string, value: string) => { id = value; return query; }, execute: async () => {
            if (table === 'characters' && failCharacterWrite) { failCharacterWrite = false; throw new Error('simulated persistence failure'); }
            if (table === 'characters') draft.characters[id] = { data: JSON.parse(values.data) };
            else draft.battles[id] = { data: JSON.parse(values.data), version: values.version! };
          } }; return query;
        },
        insertInto: (table: string) => {
          assert.equal(table, 'battle_rewards'); let value: { battle_id: string; character_id: string; experience: number };
          const query = { values: (v: typeof value) => { value = v; return query; }, onConflict: () => query, returning: () => query, executeTakeFirst: async () => {
            const key = `${value.battle_id}:${value.character_id}`; if (draft.receipts.includes(key)) return undefined;
            draft.receipts.push(key); return { character_id: value.character_id };
          } }; return query;
        },
      };
      try { const result = await callback(tx); state = draft; return result; } finally { release(); }
    } }) },
  } as unknown as Database;
  const content = { get: async () => structuredClone(seedContent) } as ContentService;
  const gateway = { publish: (b: Battle) => { published.push(structuredClone(b)); } } as unknown as BattlesGateway;
  const service = new BattlesService(database, content, gateway), characters = new CharactersService(database, content);
  const command = () => ({ characterId: winnerId, version: 0, action: { type: 'swap', ...possibleMove(battle.board)!, targetId: loserId } });
  return { service, characters, command, published, locks, state: () => state, failWrite: () => { failCharacterWrite = true; } };
}
test('duplicate concurrent winning commands award experience exactly once', async () => {
  const f = fixture(), results = await Promise.allSettled([f.service.command(battleId, f.command()), f.service.command(battleId, f.command())]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const c = f.state().characters[winnerId].data;
  assert.equal(c.level, 2); assert.equal(c.experience, 0); assert.equal(c.skillPoints, 4); assert.equal(f.state().receipts.length, 1);
  assert.equal(f.state().characters[loserId].data.experience, 0); assert.equal(f.published.length, 1);
  assert.deepEqual(f.published[0].rewards, [{ characterId: winnerId, experience: 100, levelsGained: 1 }]);
});
test('failure while writing the reward rolls back battle, receipt and experience', async () => {
  const f = fixture(); f.failWrite(); await assert.rejects(f.service.command(battleId, f.command()), /persistence failure/);
  assert.equal(f.state().battles[battleId].data.status, 'active'); assert.equal(f.state().receipts.length, 0); assert.equal(f.state().characters[winnerId].data.level, 1); assert.equal(f.published.length, 0);
  await f.service.command(battleId, f.command()); assert.equal(f.state().receipts.length, 1); assert.equal(f.state().characters[winnerId].data.level, 2);
});
test('persisted receipt prevents a second reward even if a finishing snapshot is replayed', async () => {
  const f = fixture(); f.state().receipts.push(`${battleId}:${winnerId}`); await f.service.command(battleId, f.command());
  assert.equal(f.state().characters[winnerId].data.level, 1); assert.equal(f.state().receipts.length, 1); assert.deepEqual(f.state().battles[battleId].data.rewards, []);
});
test('concurrent victories in different instances preserve both rewards', async () => {
  const f = fixture(), otherId = '00000000-0000-4000-8000-000000000004';
  f.state().battles[otherId] = structuredClone(f.state().battles[battleId]); f.state().battles[otherId].data.id = otherId;
  await Promise.all([f.service.command(battleId, f.command()), f.service.command(otherId, f.command())]);
  const c = f.state().characters[winnerId].data; assert.equal(c.level, 2); assert.equal(c.experience, 100); assert.equal(c.skillPoints, 4); assert.equal(f.state().receipts.length, 2);
});
test('concurrent learning cannot spend the same last skill point twice', async () => {
  const f = fixture(); f.state().characters[winnerId].data.skillPoints = 1;
  const results = await Promise.allSettled([f.characters.learn(winnerId, { skillId: 'ember' }), f.characters.learn(winnerId, { skillId: 'pebble' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); const c = f.state().characters[winnerId].data;
  assert.equal(c.skillPoints, 0); assert.equal(c.learnedSkillIds.length, 2); assert.ok(f.locks.every(l => l.startsWith('characters:')));
});
test('learning validates requirements on the server and rolls back failed changes', async () => {
  const f = fixture(); const initial = structuredClone(f.state().characters[winnerId].data);
  await assert.rejects(f.characters.learn(winnerId, { skillId: 'fireball' }), /уровень|Сначала/); assert.deepEqual(f.state().characters[winnerId].data, initial);
  await f.characters.learn(winnerId, { skillId: 'ember' }); await assert.rejects(f.characters.learn(winnerId, { skillId: 'ember' }), /уже изучен/); assert.equal(f.state().characters[winnerId].data.skillPoints, 1);
});
test('starting a lobby freezes the latest learned skills and stats, including legacy rooms', async () => {
  const f = fixture(), room = f.state().battles[battleId].data;
  room.status = 'waiting'; room.activeId = null;
  for (const skill of room.content.skills) Reflect.deleteProperty(skill, 'learning');
  await f.characters.learn(winnerId, { skillId: 'ember' });
  const started = await f.service.start(battleId, { characterId: winnerId, version: 0 });
  assert.equal(started.status, 'active'); const fighter = started.fighters.find(p => p.characterId === winnerId)!;
  assert.deepEqual(fighter.skillIds, ['strike', 'ember']); assert.equal(fighter.stats.attack, 8);
  assert.ok(started.content.balance.progression); assert.equal(f.state().receipts.length, 0);
});
