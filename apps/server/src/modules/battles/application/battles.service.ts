import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Battle, BattleFrame, applyAction, characterFighter, commandSchema, createBattleSchema, elements, joinBattle, joinBattleSchema, newBattle, runNpcTurns, startBattle } from '@game/core';
import { z } from 'zod';
import { TransactionContext, UnitOfWork } from '../../../shared/application/unit-of-work';
import { CharactersService } from '../../characters/application/characters.service';
import { ContentService } from '../../content/application/content.service';
import { RewardsService } from '../../rewards/application/rewards.service';
import { BattleHistoryService } from '../../battle-history/application/battle-history.service';
import { BattlesRepository } from '../ports/battles.repository';
import { BattlefieldService } from '../../battlefield/application/battlefield.service';
import { BattleEvents } from '../ports/battle-events';

function domainAction<T>(action: () => T): T {
  try { return action(); }
  catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Недопустимое действие'); }
}

@Injectable()
export class BattlesService {
  constructor(
    @Inject(UnitOfWork) private readonly transactions: UnitOfWork,
    @Inject(BattlesRepository) private readonly repository: BattlesRepository,
    @Inject(CharactersService) private readonly characters: CharactersService,
    @Inject(ContentService) private readonly content: ContentService,
    @Inject(RewardsService) private readonly rewards: RewardsService,
    @Inject(BattleHistoryService) private readonly history: BattleHistoryService,
    @Inject(BattleEvents) private readonly events: BattleEvents,
    @Inject(BattlefieldService) private readonly battlefield: BattlefieldService,
  ) {}

  list() { return this.repository.list(); }
  async get(id: string) {
    const battle = await this.repository.find(id);
    if (!battle) throw new NotFoundException('Бой не найден');
    return battle;
  }

  async create(body: unknown) {
    const input = createBattleSchema.parse(body);
    const content = await this.content.get(true);
    const character = await this.characters.get(input.characterId, content);
    const battle = domainAction(() => newBattle(randomUUID(), input.name, input.kind, input.rule, character, content, input.battlefield, this.battlefield));
    await this.repository.create(battle);
    this.events.publish(battle);
    return battle;
  }

  private async mutate(id: string, expected: number | undefined, change: (battle: Battle, context: TransactionContext) => void | Promise<void>) {
    const battle = await this.transactions.run(async context => {
      const row = await this.repository.lock(id, context);
      if (!row) throw new NotFoundException('Бой не найден');
      if (expected !== undefined && expected !== row.version) throw new ConflictException('Состояние изменилось. Повторите действие.');
      const state = row.battle;
      const wasFinished = state.status === 'finished';
      state.boardMoves = [];
      state.playback = [];
      const frames: BattleFrame[] = [];
      let recordedMoves = 0;
      const checkpoint = () => {
        const { board, fighters, activeId, turn, phase, status, usedSkill, pendingMatch, matchedElements, skillChoices, boardMoves, log, wave, winner } = state;
        frames.push(structuredClone({ board, fighters, activeId, turn, phase, status, usedSkill, pendingMatch, matchedElements, skillChoices, boardMoves: boardMoves?.slice(recordedMoves), log, wave, winner }));
        recordedMoves = boardMoves?.length ?? 0;
      };
      await change(state, context);
      if (state.combatVersion === 2) checkpoint();
      domainAction(() => runNpcTurns(state, this.battlefield, checkpoint));
      state.playback = frames;
      const finished = !wasFinished && state.status === 'finished';
      if (finished) await this.rewards.award(state, await this.content.get(), context);
      state.version = row.version + 1;
      await this.repository.save(state, context);
      if (finished) await this.history.stage(state, context);
      return state;
    });
    this.events.publish(battle);
    return battle;
  }

  async join(id: string, body: unknown) {
    const input = joinBattleSchema.parse(body);
    const content = await this.content.get();
    const character = await this.characters.get(input.characterId, content);
    return this.mutate(id, undefined, state => domainAction(() => joinBattle(state, character, input.team)));
  }

  start(id: string, body: unknown) {
    const { characterId, version } = z.object({ characterId: z.string().uuid(), version: z.number().int().nonnegative() }).strict().parse(body);
    return this.mutate(id, version, async (state, context) => {
      if (!state.fighters.some(fighter => fighter.characterId === characterId)) throw new BadRequestException('Выберите участника боя');
      if (state.status !== 'waiting') throw new BadRequestException('Бой уже начался');
      if (state.combatVersion !== 2 && (!state.battlefield || elements.every(type => state.battlefield!.elementTypes.includes(type)) && state.battlefield.elementTypes.length === elements.length)) {
        const field = domainAction(() => this.battlefield.create({ size: { rows: state.board.length, cols: state.board[0]?.length ?? 0 } }));
        state.board = field.board; state.battlefield = field.config;
      }
      state.combatVersion = 2; state.rule = 'on-match'; state.skillChoices = []; state.matchedElements = [];
      state.content = await this.content.get(true);
      state.effectsVersion = state.content.effectsVersion;
      if (state.effectsVersion === 1) state.effectSequence = 0;
      state.totalWaves = state.kind === 'dungeon' ? state.content.balance.dungeonWaves.length : 1;
      for (const fighter of [...state.fighters].filter(f => !f.npc).sort((a, b) => a.id.localeCompare(b.id))) {
        const character = await this.characters.get(fighter.id, state.content, context, true);
        state.fighters[state.fighters.findIndex(f => f.id === fighter.id)] = characterFighter(character, fighter.team, state.content);
      }
      domainAction(() => startBattle(state));
    });
  }

  command(id: string, body: unknown) {
    const { characterId, version, action } = commandSchema.parse(body);
    return this.mutate(id, version, state => domainAction(() => applyAction(state, characterId, action, Math.random, this.battlefield)));
  }
}
