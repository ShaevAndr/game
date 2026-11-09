import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { addPartyMember, applyPartyManagement, invitationView, partyCommandSchema, PARTY_CAPACITY, PARTY_DECLINE_COOLDOWN, PARTY_INVITATION_LIMIT, PARTY_INVITATION_TTL,
  type AccountSession, type Party, type PartyChatAccess, type PartyCommandResult, type PartyInvitation, type PartyMember, type PartyState } from '@game/core';
import { UnitOfWork } from '../../../shared/application/unit-of-work';
import type { TransactionContext } from '../../../shared/application/unit-of-work';
import { CharactersService } from '../../characters/application/characters.service';
import { IdentityService } from '../../identity/application/identity.service';
import { SocialService } from '../../social/application/social.service';
import { PartiesRepository } from '../ports/parties.repository';
import { PartyClock } from '../ports/party-clock';
import { WorldJournalService } from '../../world-journal/application/world-journal.service';

const changed = (message = 'Группа изменилась. Обновите состав и повторите действие.') => new ConflictException({ code: 'PARTY_CHANGED', message });
const notAllowed = () => new ForbiddenException({ code: 'SOCIAL_NOT_ALLOWED', message: 'Действие недоступно для этого игрока' });

@Injectable()
export class PartiesService {
  constructor(@Inject(UnitOfWork) private readonly transactions: UnitOfWork,
    @Inject(PartiesRepository) private readonly repository: PartiesRepository,
    @Inject(CharactersService) private readonly characters: CharactersService,
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(SocialService) private readonly social: SocialService,
    @Inject(PartyClock) private readonly clock: PartyClock,
    @Inject(WorldJournalService) private readonly worlds: WorldJournalService) {}

  /** Keeps the party lock through admission; session selection never silently changes the party hero. */
  async worldAccess(session: AccountSession, context: TransactionContext, createSolo = false): Promise<Party> {
    if (!session.characterId) throw new BadRequestException('Выберите персонажа');
    let party = await this.worldParty(session, context);
    if (!party && createSolo) {
      const hero = await this.characters.identity(session.characterId);
      if (hero.accountId !== session.account.id) throw new ForbiddenException('Персонаж не принадлежит аккаунту');
      party = { id: randomUUID(), revision: 1, leaderPlayerId: session.account.id, members: [{ playerId: session.account.id,
        characterId: hero.id, membershipId: randomUUID(), characterName: hero.name, level: hero.level, joinedAt: this.clock.now() }] };
      await this.repository.save(party, context);
    }
    if (!party) throw new ForbiddenException('Вы не состоите в группе экспедиции');
    return party;
  }

  /** Discovers a group's expedition without creating a solo party as a read side effect. */
  async worldParty(session: AccountSession, context: TransactionContext): Promise<Party | null> {
    if (!session.characterId) throw new BadRequestException('Выберите персонажа');
    await this.repository.lock(context);
    const party = await this.repository.partyOf(session.account.id, context);
    if (!party) return null;
    const member = party.members.find(member => member.playerId === session.account.id);
    if (!member) throw new ForbiddenException('Вы не состоите в группе экспедиции');
    if (member.characterId !== session.characterId) throw new ConflictException('Выбран другой герой. Сначала смените персонажа в группе');
    await this.characters.assertOwned(session.account.id, member.characterId, context);
    return party;
  }

  /** Caller acquires social locks first; this lock stays held through feed read/send/push. */
  async chatAccess(playerId: string, context: TransactionContext): Promise<PartyChatAccess | null> {
    await this.repository.lock(context);
    const party = await this.repository.partyOf(playerId, context);
    const member = party?.members.find(member => member.playerId === playerId);
    return party && member ? { partyId: party.id, membershipId: member.membershipId,
      recipients: party.members.map(({ playerId, membershipId }) => ({ playerId, membershipId })) } : null;
  }

  async state(session: AccountSession): Promise<PartyState> {
    const playerId = session.account.id;
    const [players, initialInvitations] = await Promise.all([this.identity.list(), this.repository.invitationsFor(playerId, this.clock.now())]);
    return this.transactions.run(async context => {
      // Lock social participants before the graph. Invitations arriving after this
      // preliminary read are withheld until the next poll if their policy is unknown.
      const policies = await this.social.interactionPolicies(playerId, initialInvitations.map(invitation => invitation.inviterPlayerId === playerId ? invitation.targetPlayerId : invitation.inviterPlayerId), context);
      await this.repository.lock(context);
      const now = this.clock.now(), stored = await this.repository.partyOf(playerId, context);
      const party = stored ? { ...stored, members: await Promise.all(stored.members.map(async member => {
        const character = await this.characters.identity(member.characterId);
        return { ...member, characterName: character.name, level: character.level };
      })) } : null;
      const incoming: PartyInvitation[] = [], outgoing: PartyInvitation[] = [];
      for (const invitation of await this.repository.invitationsFor(playerId, now, context)) {
        const other = invitation.inviterPlayerId === playerId ? invitation.targetPlayerId : invitation.inviterPlayerId;
        const policy = policies.find(policy => policy.playerId === other);
        if (!policy?.allowed || policy.revision !== invitation.interactionRevision) continue;
        const invitedParty = await this.repository.party(invitation.partyId, context);
        if (!invitedParty || invitedParty.leaderPlayerId !== invitation.inviterPlayerId || invitedParty.members.length >= PARTY_CAPACITY) continue;
        if (invitation.targetPlayerId === playerId && !party) incoming.push(invitation);
        if (invitation.inviterPlayerId === playerId && party?.id === invitation.partyId && party.leaderPlayerId === playerId) outgoing.push(invitation);
      }
      return { party, incoming: incoming.map(invitationView), outgoing: outgoing.map(invitationView),
        players: players.filter(player => player.id !== playerId).map(({ id, name }) => ({ id, name })), capacity: PARTY_CAPACITY, serverTime: now };
    });
  }

  async command(session: AccountSession, body: unknown): Promise<PartyCommandResult> {
    const command = partyCommandSchema.parse(body), action = command.action, playerId = session.account.id;
    if (!session.characterId) throw new BadRequestException('Выберите персонажа');
    const character = await this.characters.identity(session.characterId);
    if (character.accountId !== playerId) throw new ForbiddenException('Персонаж не принадлежит аккаунту');
    const target = action.type === 'invite' ? await this.identity.getAccount(action.targetPlayerId) : undefined;
    const preliminary = 'invitationId' in action ? await this.repository.invitation(action.invitationId) : null;
    const signature = JSON.stringify({ ...command, characterId: session.characterId });
    return this.transactions.run(async context => {
      const receipt = await this.repository.claim(playerId, command.operationId, signature, context);
      if (receipt.signature !== signature) throw new ConflictException({ code: 'PARTY_OPERATION_CONFLICT', message: 'Этот ключ уже использован для другого действия' });
      if (receipt.result) return { ...receipt.result, replayed: true };
      let interactionRevision = 0;
      if (action.type === 'invite') {
        if (target!.id === playerId) throw new BadRequestException('Выберите другого игрока');
        interactionRevision = (await this.social.assertCanInteract(playerId, target!.id, context)).revision;
      } else if (action.type === 'accept') {
        if (!preliminary || preliminary.targetPlayerId !== playerId) throw new ForbiddenException('Приглашение недоступно');
        interactionRevision = (await this.social.assertCanInteract(playerId, preliminary.inviterPlayerId, context)).revision;
      }
      await this.repository.lock(context);
      const now = this.clock.now();
      let party = await this.repository.partyOf(playerId, context);
      let changedPartyId = party?.id;
      if ((party?.id ?? null) !== command.expectedPartyId || (party?.revision ?? 0) !== command.expectedRevision) throw changed();
      const member: PartyMember = { playerId, membershipId: randomUUID(), characterId: character.id, characterName: character.name, level: character.level, joinedAt: now };
      let invitationId: string | undefined;
      if (action.type === 'invite') {
        if (party && party.leaderPlayerId !== playerId) throw new ForbiddenException('Приглашать может только лидер группы');
        if (party && party.members.length >= PARTY_CAPACITY) throw changed('В группе уже 6 игроков');
        if (await this.repository.partyOf(target!.id, context)) throw changed('Игрок уже состоит в группе');
        const targetInvitations = (await this.repository.invitationsFor(target!.id, now, context)).filter(invitation => invitation.targetPlayerId === target!.id);
        const existing = targetInvitations.find(invitation => invitation.partyId === party?.id && invitation.inviterPlayerId === playerId && invitation.interactionRevision === interactionRevision);
        if (existing) invitationId = existing.id;
        else {
          if (await this.repository.recentlyDeclined(playerId, target!.id, now - PARTY_DECLINE_COOLDOWN, context)) throw changed('Приглашение отклонено. Повторить можно через 30 секунд.');
          if (targetInvitations.length >= PARTY_INVITATION_LIMIT || party && (await this.repository.invitationsInParty(party.id, now, context)).length >= PARTY_INVITATION_LIMIT) throw changed('Слишком много ожидающих приглашений');
          const created = !party;
          party = party ? { ...party, revision: party.revision + 1 } : { id: randomUUID(), revision: 1, leaderPlayerId: playerId, members: [member] };
          const invitation: PartyInvitation = { id: randomUUID(), partyId: party.id, inviterPlayerId: playerId, inviterCharacterName: character.name,
            targetPlayerId: target!.id, createdAt: now, expiresAt: now + PARTY_INVITATION_TTL, resolvedAt: null, status: 'pending', interactionRevision };
          await this.repository.save(party, context);
          changedPartyId = party.id;
          if (created) await this.repository.cancelInvitations({ targetPlayerId: playerId }, now, context);
          await this.repository.saveInvitation(invitation, context);
          invitationId = invitation.id;
        }
      } else if (action.type === 'accept' || action.type === 'decline' || action.type === 'cancel') {
        const invitation = await this.repository.invitation(action.invitationId, context);
        if (!invitation) throw changed('Приглашение больше недоступно');
        const responding = action.type !== 'cancel';
        if ((responding ? invitation.targetPlayerId : invitation.inviterPlayerId) !== playerId) throw new ForbiddenException('Приглашение недоступно');
        if (invitation.status !== 'pending' || invitation.expiresAt <= now) throw changed('Приглашение больше недоступно');
        const invitedParty = await this.repository.party(invitation.partyId, context);
        if (!invitedParty || invitedParty.leaderPlayerId !== invitation.inviterPlayerId) throw changed('Приглашение больше недоступно');
        if (action.type === 'accept') {
          if (party) throw changed('Сначала выйдите из текущей группы');
          if (invitation.interactionRevision !== interactionRevision) throw notAllowed();
          if (invitedParty.members.length >= PARTY_CAPACITY) throw changed('В группе уже 6 игроков');
          party = addPartyMember(invitedParty, member);
          changedPartyId = party.id;
          await this.repository.save(party, context);
          await this.repository.cancelInvitations({ targetPlayerId: playerId }, now, context, invitation.id);
          if (party.members.length === PARTY_CAPACITY) await this.repository.cancelInvitations({ partyId: party.id }, now, context, invitation.id);
        } else if (action.type === 'cancel' && (party?.id !== invitedParty.id || party.leaderPlayerId !== playerId)) throw new ForbiddenException('Отменять приглашения может только лидер группы');
        await this.repository.saveInvitation({ ...invitation, status: action.type === 'accept' ? 'accepted' : action.type === 'decline' ? 'declined' : 'cancelled', resolvedAt: now }, context);
        invitationId = invitation.id;
        if (action.type === 'cancel' && party) { party = { ...party, revision: party.revision + 1 }; await this.repository.save(party, context); }
      } else {
        if (!party) throw changed('Вы не состоите в группе');
        if (['transfer', 'kick', 'disband'].includes(action.type) && party.leaderPlayerId !== playerId) throw new ForbiddenException('Действие доступно только лидеру группы');
        const previous = party;
        try { party = applyPartyManagement(party, playerId, action, member); }
        catch (error) { throw new BadRequestException((error as Error).message); }
        if (!party || party.leaderPlayerId !== previous.leaderPlayerId) await this.repository.cancelInvitations({ partyId: previous.id }, now, context);
        if (party) await this.repository.save(party, context); else await this.repository.remove(previous.id, context);
        if (action.type === 'leave') party = null;
      }
      // A departing player's response hides the party, but the journal needs the remaining roster.
      if (changedPartyId) await this.worlds.partyChanged(changedPartyId, await this.repository.party(changedPartyId, context), context);
      const result: PartyCommandResult = { party, ...(invitationId ? { invitationId } : {}), replayed: false };
      await this.repository.complete(playerId, command.operationId, result, context);
      return result;
    });
  }
}
