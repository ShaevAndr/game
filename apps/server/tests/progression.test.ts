import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle, BattlefieldOptions, createBoard, Character, emptyEnergy, joinBattle, newBattle, possibleMove, seedContent, startBattle } from '@game/core';
import { BattlefieldService } from '../src/modules/battlefield/application/battlefield.service';
import { BattlesService } from '../src/modules/battles/application/battles.service';
import { BattleEvents } from '../src/modules/battles/ports/battle-events';
import { CharactersService } from '../src/modules/characters/application/characters.service';
import { ContentService } from '../src/modules/content/application/content.service';
import { Database } from '../src/infrastructure/database/database.service';
import { PostgresCharactersRepository } from '../src/modules/characters/repositories/postgres-characters.repository';
import { PostgresBattlesRepository } from '../src/modules/battles/repositories/postgres-battles.repository';
import { PostgresRewardsRepository } from '../src/modules/rewards/repositories/postgres-rewards.repository';
import { PostgresBattleArchiveOutbox } from '../src/modules/battle-history/repositories/postgres-battle-archive-outbox';
import { BattleHistoryRepository } from '../src/modules/battle-history/ports/battle-history.repository';
import { BattleHistoryService } from '../src/modules/battle-history/application/battle-history.service';
import { TaskQueue } from '../src/shared/application/task-queue.port';
import { RewardsService } from '../src/modules/rewards/application/rewards.service';
import { SkillsService } from '../src/modules/skills/application/skills.service';
import { SkillsCatalogService } from '../src/modules/skills/application/skills-catalog.service';

const winnerId = '00000000-0000-4000-8000-000000000001', loserId = '00000000-0000-4000-8000-000000000002';
const battleId = '00000000-0000-4000-8000-000000000003';
const hero = (id: string): Character => ({ id, name: id === winnerId ? 'Winner' : 'Loser', level: 1, experience: 0, skillPoints: 2, learnedSkillIds: ['strike'], stats: { ...seedContent.balance.characterStats }, energy: emptyEnergy(), inventory: [], createdAt: new Date().toISOString() });
interface State { characters: Record<string, { data: Character }>; battles: Record<string, { data: Battle; version: number }>; receipts: string[]; outbox: Record<string, Battle> }
/** Transactional test double: exercises service rollback and command races without a running PostgreSQL. */
function fixture(kind: 'duel' | 'bot' = 'duel', battlefield: BattlefieldOptions = {}) {
  const winner = hero(winnerId), loser = hero(loserId);
  const battle = newBattle(battleId, 'test', kind, 'before', winner, seedContent, battlefield);
  delete battle.combatVersion; battle.rule = 'before';
  battle.content.skills.find(skill => skill.id === 'strike')!.cost = 0;
  delete battle.content.balance.combat;
  if (!battlefield.elementTypes) { battle.battlefield!.elementTypes = ['fire', 'water', 'earth', 'air', 'physical']; battle.board = createBoard({ size: battle.battlefield!.size, elementTypes: battle.battlefield!.elementTypes }); }
  if (kind === 'duel') joinBattle(battle, loser, 1); startBattle(battle); battle.fighters[0].stats.attack = 1000;
  let state: State = { characters: { [winnerId]: { data: winner }, [loserId]: { data: loser } }, battles: { [battleId]: { data: battle, version: 0 } }, receipts: [], outbox: {} };
  let tail = Promise.resolve(), failCharacterWrite = false, failOutboxWrite = false;
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
          if (table === 'battle_archive_outbox') {
            let value: { id: string; data: string };
            const query = { values: (v: typeof value) => { value = v; return query; }, onConflict: () => query, execute: async () => {
              if (failOutboxWrite) { failOutboxWrite = false; throw new Error('simulated outbox failure'); }
              draft.outbox[value.id] ??= JSON.parse(value.data);
            } }; return query;
          }
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
  // Use the production transaction manager and repository adapters over the transactional SQL double.
  const adapter = new Database();
  Object.defineProperty(adapter, 'sql', { value: database.sql });
  const content = { get: async () => structuredClone(seedContent) } as unknown as ContentService;
  const events = { publish: (b: Battle) => { published.push(structuredClone(b)); } } as BattleEvents;
  const characters = new CharactersService(new PostgresCharactersRepository(adapter), content);
  const skills = new SkillsService(adapter, characters, content, {} as SkillsCatalogService);
  const rewards = new RewardsService(new PostgresRewardsRepository(adapter), characters);
  const history = new BattleHistoryService(new PostgresBattleArchiveOutbox(adapter), {} as BattleHistoryRepository, {} as TaskQueue);
  const service = new BattlesService(adapter, new PostgresBattlesRepository(adapter), characters, content, rewards, history, events, new BattlefieldService());
  const command = () => ({ characterId: winnerId, version: 0, action: { type: 'swap', ...possibleMove(battle.board)!, targetId: battle.fighters[1].id } });
  return { service, characters, skills, command, published, locks, state: () => state, failWrite: () => { failCharacterWrite = true; }, failOutbox: () => { failOutboxWrite = true; } };
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
  const results = await Promise.allSettled([f.skills.learn(winnerId, { skillId: 'ember' }), f.skills.learn(winnerId, { skillId: 'pebble' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); const c = f.state().characters[winnerId].data;
  assert.equal(c.skillPoints, 0); assert.equal(c.learnedSkillIds.length, 2); assert.ok(f.locks.every(l => l.startsWith('characters:')));
});
test('learning validates requirements on the server and rolls back failed changes', async () => {
  const f = fixture(); const initial = structuredClone(f.state().characters[winnerId].data);
  await assert.rejects(f.skills.learn(winnerId, { skillId: 'fireball' }), /уровень|Сначала/); assert.deepEqual(f.state().characters[winnerId].data, initial);
  await f.skills.learn(winnerId, { skillId: 'ember' }); await assert.rejects(f.skills.learn(winnerId, { skillId: 'ember' }), /уже изучен/); assert.equal(f.state().characters[winnerId].data.skillPoints, 1);
});
test('starting a lobby freezes the latest learned skills and stats, including legacy rooms', async () => {
  const f = fixture(), room = f.state().battles[battleId].data;
  room.status = 'waiting'; room.activeId = null;
  for (const skill of room.content.skills) Reflect.deleteProperty(skill, 'learning');
  await f.skills.learn(winnerId, { skillId: 'ember' });
  const started = await f.service.start(battleId, { characterId: winnerId, version: 0 });
  assert.equal(started.status, 'active'); const fighter = started.fighters.find(p => p.characterId === winnerId)!;
  assert.deepEqual(fighter.skillIds, ['strike', 'ember']); assert.equal(fighter.stats.attack, 8);
  assert.ok(started.content.balance.progression); assert.equal(f.state().receipts.length, 0);
  assert.equal(started.combatVersion, 2); assert.equal(started.rule, 'on-match');
  assert.equal(started.battlefield?.elementTypes.length, 6);
});

test('a bot victory grants experience once and never creates an NPC reward', async () => {
  const f = fixture('bot');
  const results = await Promise.allSettled([f.service.command(battleId, f.command()), f.service.command(battleId, f.command())]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(f.state().receipts.length, 1);
  assert.deepEqual(f.state().battles[battleId].data.rewards, [{ characterId: winnerId, experience: 100, levelsGained: 1 }]);
  assert.equal(f.state().characters[winnerId].data.level, 2);
});
test('bot commands return after the automatic NPC turn', async () => {
  const f = fixture('bot'); f.state().battles[battleId].data.fighters[0].stats.attack = 8;
  const battle = await f.service.command(battleId, f.command());
  assert.equal(battle.status, 'active'); assert.equal(battle.activeId, winnerId);
  assert.ok(battle.fighters[0].hp < battle.fighters[0].stats.maxHp);
  assert.equal(f.state().receipts.length, 0);
});
test('starting a bot lobby uses the latest player stats and learned skills', async () => {
  const f = fixture('bot'), room = f.state().battles[battleId].data;
  room.status = 'waiting'; room.activeId = null; room.fighters = room.fighters.filter(f => !f.npc);
  await f.skills.learn(winnerId, { skillId: 'ember' });
  const battle = await f.service.start(battleId, { characterId: winnerId, version: 0 });
  const bot = battle.fighters.find(f => f.npc)!;
  assert.equal(bot.characterId, undefined); assert.equal(battle.fighters.length, 2);
  assert.deepEqual(bot.skillIds, ['strike', 'ember']); assert.equal(bot.stats.attack, 8);
});

test('winning result stages the final version and rewards in the same transaction', async () => {
  const f = fixture();
  const battle = await f.service.command(battleId, f.command());
  assert.deepEqual(f.state().outbox[battleId], battle);
  assert.equal(battle.version, 1);
  assert.equal(Object.keys(f.state().outbox).length, 1);
});

test('outbox persistence failure rolls back the result and all rewards', async () => {
  const f = fixture(); f.failOutbox();
  await assert.rejects(f.service.command(battleId, f.command()), /outbox failure/);
  assert.equal(f.state().battles[battleId].data.status, 'active');
  assert.equal(f.state().receipts.length, 0);
  assert.equal(f.state().characters[winnerId].data.level, 1);
  assert.deepEqual(f.state().outbox, {});
  assert.equal(f.published.length, 0);
  await f.service.command(battleId, f.command());
  assert.equal(f.state().outbox[battleId].status, 'finished');
});

test('battle commands expose direct and generated removals outside the old eight-column bounds', async () => {
  const f = fixture('duel', { size: { rows: 6, cols: 10 }, elementTypes: ['fire', 'water', 'earth'] });
  f.state().battles[battleId].data.board = Array.from({ length: 6 }, (_, row) => Array.from({ length: 10 }, (_, col) => (row + col) % 2 ? 'water' : 'fire'));
  const result = await f.service.command(battleId, { characterId: winnerId, version: 0, action: { type: 'swap', from: { row: 1, col: 8 }, to: { row: 1, col: 9 }, targetId: loserId } });
  assert.equal(result.battlefield?.size.cols, 10);
  const report = result.boardMoves![0];
  assert.equal(report.actorId, winnerId);
  assert.deepEqual(report.direct, { count: 6, byType: { fire: 3, water: 3, earth: 0 } });
  assert.equal(report.total.count, report.direct.count + report.generated.count);
  assert.deepEqual(f.state().battles[battleId].data.boardMoves, result.boardMoves);
});

test('legacy battle snapshots acquire default field configuration without a database migration', async () => {
  const f = fixture();
  delete f.state().battles[battleId].data.battlefield;
  delete f.state().battles[battleId].data.boardMoves;
  const result = await f.service.command(battleId, f.command());
  assert.deepEqual(result.battlefield?.size, { rows: 8, cols: 8 });
  assert.equal(result.battlefield?.elementTypes.length, 5);
  assert.equal(result.boardMoves?.length, 1);
});

test('automatic NPC moves retain the chosen field types and each actor gets its own report', async () => {
  const f = fixture('bot', { size: { rows: 5, cols: 10 }, elementTypes: ['fire', 'water', 'earth'] });
  for (const fighter of f.state().battles[battleId].data.fighters) { fighter.hp = 100000; fighter.stats.maxHp = 100000; fighter.stats.attack = 8; }
  const result = await f.service.command(battleId, f.command());
  assert.deepEqual(result.boardMoves?.map(move => move.actorId), [winnerId, 'bot-opponent']);
  assert.ok(result.board.flat().every(type => ['fire', 'water', 'earth'].includes(type)));
  assert.equal(result.activeId, winnerId);
  const skill = await f.service.command(battleId, { characterId: winnerId, version: result.version, action: { type: 'skill', skillId: 'strike', targetId: 'bot-opponent' } });
  assert.deepEqual(skill.boardMoves, []);
});

test('matched combat only rewards the finishing skill and rejects its duplicate atomically', async () => {
  const f = fixture('duel', { size: { rows: 6, cols: 10 }, elementTypes: ['physical', 'water', 'defense'] });
  const state = f.state().battles[battleId].data;
  state.combatVersion = 2; state.rule = 'on-match'; state.content = structuredClone(seedContent);
  state.board = Array.from({ length: 6 }, (_, row) => Array.from({ length: 10 }, (_, col) => (row + col) % 2 ? 'water' : 'physical'));
  const moved = await f.service.command(battleId, { characterId: winnerId, version: 0, action: { type: 'swap', from: { row: 1, col: 8 }, to: { row: 1, col: 9 } } });
  assert.equal(moved.status, 'active'); assert.equal(moved.phase, 'choose');
  assert.equal(moved.fighters[1].hp, 120); assert.equal(f.state().receipts.length, 0);
  assert.deepEqual(moved.skillChoices, [{ skillId: 'strike', enabled: true }]);
  const action = { characterId: winnerId, version: moved.version, action: { type: 'skill', skillId: 'strike', targetId: loserId } };
  const results = await Promise.allSettled([f.service.command(battleId, action), f.service.command(battleId, action)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const finished = f.state().battles[battleId].data;
  assert.equal(finished.status, 'finished'); assert.deepEqual(finished.boardMoves, []);
  assert.equal(finished.fighters[0].energy.physical, moved.fighters[0].energy.physical - 3);
  assert.equal(f.state().receipts.length, 1); assert.deepEqual(f.state().outbox[battleId], finished);
});
