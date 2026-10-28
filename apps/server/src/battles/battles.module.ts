import { BadRequestException, Body, ConflictException, Controller, Get, Inject, Injectable, Module, NotFoundException, Param, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Battle, addLog, applyAction, characterFighter, commandSchema, createBattleSchema, gainExperience, joinBattle, joinBattleSchema, newBattle, normalizeCharacter, runNpcTurns, startBattle, victoryRecipients } from '@game/core';
import { z } from 'zod';
import { sql, Transaction } from 'kysely';
import { Database, Tables } from '../database/database.module';
import { ContentService } from '../content/content.module';
import { BattlesGateway } from './battles.gateway';

@Injectable()
export class BattlesService {
  constructor(@Inject(Database) private readonly db: Database, @Inject(ContentService) private readonly content: ContentService, @Inject(BattlesGateway) private readonly gateway: BattlesGateway) {}
  async list() {
    return (await this.db.sql.selectFrom('battles').select('data').orderBy(sql`data->>'createdAt'`, 'desc').limit(100).execute()).map(r => r.data);
  }
  async get(id: string) { const row = await this.db.sql.selectFrom('battles').select('data').where('id', '=', id).executeTakeFirst(); if (!row) throw new NotFoundException('Бой не найден'); return row.data; }
  async create(body: unknown) {
    const input = createBattleSchema.parse(body);
    const row = await this.db.sql.selectFrom('characters').select('data').where('id', '=', input.characterId).executeTakeFirst();
    if (!row) throw new NotFoundException('Персонаж не найден');
    const content = await this.content.get();
    const battle = newBattle(randomUUID(), input.name, input.kind, input.rule, normalizeCharacter(row.data, content), content);
    await this.db.sql.insertInto('battles').values({ id: battle.id, version: 0, data: JSON.stringify(battle) }).execute(); this.gateway.publish(battle); return battle;
  }
  async mutate(id: string, expected: number | undefined, change: (battle: Battle, tx: Transaction<Tables>) => void | Promise<void>) {
    const battle = await this.db.sql.transaction().execute(async tx => {
      const row = await tx.selectFrom('battles').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!row) throw new NotFoundException('Бой не найден');
      if (expected !== undefined && expected !== row.version) throw new ConflictException('Состояние изменилось. Повторите действие.');
      const state = row.data;
      const wasFinished = state.status === 'finished';
      try { await change(state, tx); runNpcTurns(state); } catch (error) { if (error instanceof NotFoundException) throw error; throw new BadRequestException(error instanceof Error ? error.message : 'Недопустимое действие'); }
      if (!wasFinished && state.status === 'finished') {
        const content = await this.content.get();
        const config = state.content.balance.progression ?? content.balance.progression;
        const experience = config.victoryExperience[state.kind] ?? config.victoryExperience.duel;
        state.rewards = [];
        // Lock characters in a stable order, including when two battles finish together.
        for (const characterId of victoryRecipients(state)) {
          const characterRow = await tx.selectFrom('characters').select('data').where('id', '=', characterId).forUpdate().executeTakeFirst();
          if (!characterRow) throw new NotFoundException('Персонаж победившей команды не найден');
          const receipt = await tx.insertInto('battle_rewards').values({ battle_id: state.id, character_id: characterId, experience })
            .onConflict(c => c.columns(['battle_id', 'character_id']).doNothing()).returning('character_id').executeTakeFirst();
          if (!receipt) continue;
          const character = normalizeCharacter(characterRow.data, content);
          const levelsGained = gainExperience(character, experience, config);
          await tx.updateTable('characters').set({ data: JSON.stringify(character) }).where('id', '=', characterId).execute();
          state.rewards.push({ characterId, experience, levelsGained });
          addLog(state, `${character.name}: +${experience} опыта${levelsGained ? `, новый уровень ${character.level}, +${levelsGained * config.skillPointsPerLevel} очков навыков` : ''}`);
        }
      }
      state.version = row.version + 1;
      await tx.updateTable('battles').set({ data: JSON.stringify(state), version: state.version }).where('id', '=', id).execute();
      return state;
    });
    this.gateway.publish(battle); return battle;
  }
  async join(id: string, body: unknown) {
    const input = joinBattleSchema.parse(body);
    const row = await this.db.sql.selectFrom('characters').select('data').where('id', '=', input.characterId).executeTakeFirst();
    if (!row) throw new NotFoundException('Персонаж не найден');
    const content = await this.content.get();
    return this.mutate(id, undefined, state => joinBattle(state, normalizeCharacter(row.data, content), input.team));
  }
  start(id: string, body: unknown) {
    const { characterId, version } = z.object({ characterId: z.string().uuid(), version: z.number().int().nonnegative() }).strict().parse(body);
    return this.mutate(id, version, async (state, tx) => {
      if (!state.fighters.some(f => f.characterId === characterId)) throw new BadRequestException('Выберите участника боя');
      if (state.status !== 'waiting') throw new BadRequestException('Бой уже начался');
      // Freeze the latest learned skills and stats when leaving the lobby, not while fighting.
      state.content = await this.content.get();
      state.totalWaves = state.kind === 'dungeon' ? state.content.balance.dungeonWaves.length : 1;
      for (const fighter of [...state.fighters].sort((a, b) => a.id.localeCompare(b.id))) {
        const row = await tx.selectFrom('characters').select('data').where('id', '=', fighter.id).forUpdate().executeTakeFirst();
        if (!row) throw new NotFoundException('Персонаж не найден');
        state.fighters[state.fighters.findIndex(f => f.id === fighter.id)] = characterFighter(normalizeCharacter(row.data, state.content), fighter.team, state.content);
      }
      startBattle(state);
    });
  }
  command(id: string, body: unknown) {
    const { characterId, version, action } = commandSchema.parse(body);
    return this.mutate(id, version, state => applyAction(state, characterId, action));
  }
}
const idSchema = z.string().uuid();
@Controller('battles')
class BattlesController {
  constructor(@Inject(BattlesService) private readonly service: BattlesService) {}
  @Get() list() { return this.service.list(); }
  @Get(':id') get(@Param('id') id: string) { return this.service.get(idSchema.parse(id)); }
  @Post() create(@Body() body: unknown) { return this.service.create(body); }
  @Post(':id/join') join(@Param('id') id: string, @Body() body: unknown) { return this.service.join(idSchema.parse(id), body); }
  @Post(':id/start') start(@Param('id') id: string, @Body() body: unknown) { return this.service.start(idSchema.parse(id), body); }
  @Post(':id/actions') command(@Param('id') id: string, @Body() body: unknown) { return this.service.command(idSchema.parse(id), body); }
}
@Module({ controllers: [BattlesController], providers: [BattlesService, BattlesGateway] })
export class BattlesModule {}
