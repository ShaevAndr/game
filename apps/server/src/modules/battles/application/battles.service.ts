import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import { Battle, BattleFrame, DEFAULT_TURN_SECONDS, applyAction, battleBelt, characterFighter, commandSchema, createBattleSchema, expireMatchedTurn, joinBattle, joinBattleSchema, newBattle, runNpcTurns, startBattle } from '@game/core';
import { z } from 'zod';
import { TransactionContext, UnitOfWork } from '../../../shared/application/unit-of-work';
import { CharactersService } from '../../characters/application/characters.service';
import { ContentService } from '../../content/application/content.service';
import { RewardsService } from '../../rewards/application/rewards.service';
import { BattleHistoryService } from '../../battle-history/application/battle-history.service';
import { BattlesRepository } from '../ports/battles.repository';
import { BattlefieldService } from '../../battlefield/application/battlefield.service';
import { BattleEvents } from '../ports/battle-events';
import { InventoryService } from '../../inventory/application/inventory.service';
import { BattleRuntime } from '../ports/battle-runtime';

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
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(BattleRuntime) private readonly runtime: BattleRuntime,
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

  private async mutate(id: string, expected: number | undefined, change: (battle: Battle, context: TransactionContext, checkpoint: (battle: Battle) => void) => void | Promise<void>, guard?: (battle: Battle) => boolean) {
    const result = await this.transactions.run(async context => {
      const row = await this.repository.lock(id, context);
      if (!row) throw new NotFoundException('Бой не найден');
      if (expected !== undefined && expected !== row.version) throw new ConflictException('Состояние изменилось. Повторите действие.');
      const state = row.battle;
      if (guard && !guard(state)) return { battle: state, changed: false };
      const wasFinished = state.status === 'finished';
      const previousTurn = state.turn;
      const previousActiveId = state.activeId;
      const previousStatus = state.status;
      state.effectResults = [];
      state.damageResults = [];
      state.boardMoves = [];
      state.playback = [];
      const frames: BattleFrame[] = [];
      let recordedMoves = 0;
      const checkpoint = (source = state) => {
        const { board, fighters, activeId, turn, phase, status, usedSkill, pendingMatch, matchPowerBps, matchedElements, skillChoices, boardMoves, log, wave, winner } = source;
        frames.push(structuredClone({ board, fighters, activeId, turn, phase, status, usedSkill, pendingMatch, ...(matchPowerBps !== undefined ? { matchPowerBps } : {}), matchedElements, skillChoices, boardMoves: boardMoves?.slice(recordedMoves), log, wave, winner }));
        recordedMoves = boardMoves?.length ?? 0;
      };
      await change(state, context, checkpoint);
      checkpoint();
      domainAction(() => runNpcTurns(state, this.battlefield, checkpoint));
      state.playback = frames;
      if (state.status !== 'active') delete state.turnDeadlineAt;
      else if (previousTurn !== state.turn || previousActiveId !== state.activeId || previousStatus !== 'active' || !state.turnDeadlineAt) {
        state.turnDeadlineAt = this.runtime.now() + (state.turnDurationSeconds ?? DEFAULT_TURN_SECONDS) * 1000;
      }
      const finished = !wasFinished && state.status === 'finished';
      if (finished) await this.rewards.award(state, await this.content.get(), context);
      state.version = row.version + 1;
      await this.repository.save(state, context);
      if (finished) await this.history.stage(state, context);
      return { battle: state, changed: true };
    });
    if (result.changed) this.events.publish(result.battle);
    return result.battle;
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
      state.combatVersion = 1; state.rule = 'on-match'; state.skillChoices = []; state.matchedElements = [];
      state.content = await this.content.get(true);
      if (state.content.modifierRulesVersion === 1) state.attributeRngState = randomInt(0, 4294967296);
      state.effectsVersion = state.content.effectsVersion;
      if (state.effectsVersion === 1) state.effectSequence = 0;
      state.totalWaves = state.kind === 'dungeon' ? state.content.balance.dungeonWaves.length : 1;
      for (const fighter of [...state.fighters].filter(f => !f.npc).sort((a, b) => a.id.localeCompare(b.id))) {
        const character = await this.characters.get(fighter.id, state.content, context, true);
        if (await this.repository.hasActiveCharacter(character.id, context)) throw new ConflictException(`${character.name} уже участвует в активном бою`);
        const items = await this.inventory.state(character.id, state.content, context);
        const primary = items.inventories.find(inventory => inventory.primary);
        const current = characterFighter(character, fighter.team, state.content);
        current.equipment = structuredClone(items.items.filter(item => item.equippedSlot));
        current.backpack = structuredClone(items.items.filter(item => primary && item.inventoryId === primary.id && !item.equippedSlot));
        current.inventory = battleBelt(current.backpack.map(item => ({ itemId: item.itemId, quantity: item.quantity, instanceId: item.id, effects: item.effects })), state.content);
        state.fighters[state.fighters.findIndex(f => f.id === fighter.id)] = current;
      }
      state.turnDurationSeconds = DEFAULT_TURN_SECONDS;
      domainAction(() => startBattle(state, () => this.runtime.random()));
    });
  }

  command(id: string, body: unknown) {
    const { characterId, version, action } = commandSchema.parse(body);
    return this.mutate(id, version, async (state, context, checkpoint) => {
      const actor = state.fighters.find(fighter => fighter.characterId === characterId && !fighter.npc);
      if (!actor) throw new BadRequestException('Выберите участника боя');
      // Surrender is available outside one's turn, including after a deadline.
      if (action.type !== 'surrender' && this.isExpired(state)) {
        domainAction(() => expireMatchedTurn(state, checkpoint));
        return;
      }
      const bottle = action.type === 'item' ? actor.inventory.find(stack => stack.itemId === action.itemId && stack.quantity > 0 && (!action.instanceId || stack.instanceId === action.instanceId)) : undefined;
      domainAction(() => applyAction(state, characterId, action, Math.random, this.battlefield, checkpoint));
      if (bottle) await this.inventory.consumeBattleItem(characterId, bottle, state.content, context);
    });
  }

  private isExpired(battle: Battle) {
    return battle.status === 'active' && battle.turnDeadlineAt !== undefined && battle.turnDeadlineAt <= this.runtime.now();
  }

  async expireTurns() {
    const ids = await this.repository.expired(this.runtime.now(), 50);
    const results = await Promise.allSettled(ids.map(id => this.mutate(id, undefined,
      (state, _context, checkpoint) => domainAction(() => expireMatchedTurn(state, checkpoint)), state => this.isExpired(state))));
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (errors.length) throw new AggregateError(errors.map(result => result.reason), 'Ошибки таймеров боя');
  }
}
