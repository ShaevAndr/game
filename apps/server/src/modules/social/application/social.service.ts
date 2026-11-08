import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { SocialPair, SocialState, socialCommandSchema, socialRelationship } from '@game/core';
import { TransactionContext, UnitOfWork } from '../../../shared/application/unit-of-work';
import { IdentityService } from '../../identity/application/identity.service';
import { SocialRepository } from '../ports/social.repository';

const unavailable = () => new ForbiddenException({ code: 'SOCIAL_NOT_ALLOWED', message: 'Действие недоступно для этого игрока' });

@Injectable()
export class SocialService {
  constructor(@Inject(UnitOfWork) private readonly transactions: UnitOfWork,
    @Inject(SocialRepository) private readonly repository: SocialRepository,
    @Inject(IdentityService) private readonly identity: IdentityService) {}

  async state(playerId: string): Promise<SocialState> {
    const names = new Map((await this.identity.list()).map(account => [account.id, account.name]));
    return this.transactions.run(async context => {
      const [player] = await this.repository.lockPlayers([playerId], context);
      return { revision: player.revision, visibilityRevision: player.visibilityRevision,
        relationships: (await this.repository.pairs(playerId, context)).map(pair => {
          const row = socialRelationship(pair, playerId); return { ...row, playerName: names.get(row.playerId) ?? 'Игрок' };
        }) };
    });
  }
  /** Held through the caller's feed read, so a block cannot race an authorized response. */
  async readPolicy(playerId: string, context: TransactionContext) {
    const [player] = await this.repository.lockPlayers([playerId], context);
    const pairs = await this.repository.pairs(playerId, context);
    return { revision: player.visibilityRevision, hiddenAuthors: pairs.filter(pair => pair.blockedBy.includes(playerId)).map(pair => pair.lowId === playerId ? pair.highId : pair.lowId) };
  }
  /** Lock participants in one order before any delivery locks; use within the send transaction. */
  async assertCanInteract(one: string, two: string, context: TransactionContext) {
    await this.repository.lockPlayers([one, two], context);
    const pair = await this.repository.pair(one, two, context);
    if (pair?.blockedBy.length) throw unavailable();
    return { revision: pair?.interactionRevision ?? 0 };
  }
  /** Batch locking preserves the same social → consumer lock order for invitation reads. */
  async interactionPolicies(playerId: string, otherIds: string[], context: TransactionContext) {
    const ids = [...new Set(otherIds.filter(id => id !== playerId))];
    await this.repository.lockPlayers([playerId, ...ids], context);
    return Promise.all(ids.map(async id => {
      const pair = await this.repository.pair(playerId, id, context);
      return { playerId: id, allowed: !pair?.blockedBy.length, revision: pair?.interactionRevision ?? 0 };
    }));
  }
  async canSeeAuthor(viewerId: string, authorId: string) {
    if (viewerId === authorId) return true;
    return !(await this.repository.pair(viewerId, authorId))?.blockedBy.includes(viewerId);
  }
  async command(playerId: string, body: unknown) {
    const parsed = socialCommandSchema.parse(body);
    const target = await this.identity.getAccount(parsed.targetPlayerId);
    const input = { ...parsed, targetPlayerId: target.id }, signature = JSON.stringify(input);
    if (playerId === input.targetPlayerId) throw new BadRequestException('Выберите другого игрока');
    return this.transactions.run(async context => {
      const receipt = await this.repository.claim(playerId, input.operationId, signature, context);
      if (receipt.signature !== signature) throw new ConflictException({ code: 'SOCIAL_OPERATION_CONFLICT', message: 'Этот ключ уже использован для другого действия' });
      if (receipt.result) return { relationship: receipt.result, replayed: true };
      const players = await this.repository.lockPlayers([playerId, input.targetPlayerId], context), [lowId, highId] = [playerId, input.targetPlayerId].sort();
      const pair: SocialPair = await this.repository.pair(playerId, input.targetPlayerId, context) ?? { lowId, highId, revision: 0, friendship: 'none', requesterId: null, blockedBy: [] };
      if ((input.action === 'friend-request' || input.action === 'friend-accept') && pair.blockedBy.length) throw unavailable();
      const crossedRequest = input.action === 'friend-request' && pair.friendship === 'pending' && pair.requesterId !== playerId && pair.revision === input.expectedRevision + 1;
      if (pair.revision !== input.expectedRevision && !crossedRequest) throw new ConflictException({ code: 'SOCIAL_CHANGED', message: 'Отношения с игроком изменились. Обновите список.' });
      const previous = JSON.stringify(pair);
      switch (input.action) {
        case 'friend-request':
          if (pair.friendship === 'none') { pair.friendship = 'pending'; pair.requesterId = playerId; }
          else if (pair.friendship === 'pending' && pair.requesterId !== playerId) pair.friendship = 'accepted';
          break;
        case 'friend-accept':
          if (pair.friendship !== 'accepted') {
            if (pair.friendship !== 'pending' || pair.requesterId === playerId) throw new BadRequestException('Нет входящей заявки');
            pair.friendship = 'accepted';
          }
          break;
        case 'friend-decline':
        case 'friend-cancel':
          if (pair.friendship !== 'none') {
            if (pair.friendship !== 'pending' || (pair.requesterId === playerId) !== (input.action === 'friend-cancel')) throw new BadRequestException('Заявка уже изменилась');
            pair.friendship = 'none'; pair.requesterId = null;
          }
          break;
        case 'friend-remove': pair.friendship = 'none'; pair.requesterId = null; break;
        case 'block':
          if (!pair.blockedBy.includes(playerId)) { pair.blockedBy.push(playerId); pair.interactionRevision = (pair.interactionRevision ?? 0) + 1; }
          pair.friendship = 'none'; pair.requesterId = null; break;
        case 'unblock':
          if (pair.blockedBy.includes(playerId)) { pair.blockedBy = pair.blockedBy.filter(id => id !== playerId); pair.interactionRevision = (pair.interactionRevision ?? 0) + 1; }
          break;
      }
      if (JSON.stringify(pair) !== previous) {
        pair.revision++;
        for (const player of players) { player.revision++; if (player.id === playerId && (input.action === 'block' || input.action === 'unblock')) player.visibilityRevision++; }
        await this.repository.save(pair, players, context);
      }
      const relationship = socialRelationship(pair, playerId);
      await this.repository.complete(playerId, input.operationId, relationship, context);
      return { relationship, replayed: false };
    });
  }
}
