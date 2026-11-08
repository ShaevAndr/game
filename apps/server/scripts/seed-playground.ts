import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { experienceToNextLevel, gainExperience, type AccountSession, type GatheringAction, type PartyAction } from '@game/core';

config({ path: resolve(process.cwd(), '../../.env') }); config();

/** Stable receipts make fixture inventory/message grants safe to repeat. */
function operationId(...parts: string[]) {
  const bytes = createHash('sha256').update(['playground', ...parts].join(':')).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const fixtures = [
  { account: 'Тест: лидер', name: 'Следопыт', templateId: 'pyromancer', level: 10, gatheringXp: 0 },
  { account: 'Тест: целитель', name: 'Целительница', templateId: 'phoenix', level: 10, gatheringXp: 0 },
  { account: 'Тест: рудокоп', name: 'Рудокоп', templateId: 'geomancer', level: 10, gatheringXp: 10 },
  { account: 'Тест: травник', name: 'Травница', templateId: 'druid', level: 10, gatheringXp: 10 },
  { account: 'Тест: лесоруб', name: 'Лесоруб', templateId: 'veteran', level: 10, gatheringXp: 10 },
  { account: 'Тест: кристаллы', name: 'Кристаллист', templateId: 'frostmage', level: 10, gatheringXp: 20 },
  { account: 'Тест: седьмой', name: 'Седьмой', templateId: 'duelist', level: 10, gatheringXp: 0 },
  { account: 'Тест: новичок', name: 'Новичок', templateId: 'tidekeeper', level: 1, gatheringXp: 0 },
] as const;

async function main() {
  // Dynamic imports preserve the same dotenv-before-modules order as main.ts.
  const { AppModule } = await import('../src/app.module');
  const { UnitOfWork } = await import('../src/shared/application/unit-of-work');
  const { IdentityService } = await import('../src/modules/identity/application/identity.service');
  const { CharacterCreationService } = await import('../src/modules/characters/application/character-creation.service');
  const { CharactersService } = await import('../src/modules/characters/application/characters.service');
  const { ContentService } = await import('../src/modules/content/application/content.service');
  const { SkillsService } = await import('../src/modules/skills/application/skills.service');
  const { InventoryService } = await import('../src/modules/inventory/application/inventory.service');
  const { GatheringService } = await import('../src/modules/gathering/application/gathering.service');
  const { PartiesService } = await import('../src/modules/parties/application/parties.service');
  const { ChatService } = await import('../src/modules/chat/application/chat.service');
  const { SocialService } = await import('../src/modules/social/application/social.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const tokens: string[] = [];
  try {
    const identity = app.get(IdentityService), characters = app.get(CharactersService), creation = app.get(CharacterCreationService);
    const inventory = app.get(InventoryService), skills = app.get(SkillsService), gathering = app.get(GatheringService);
    const parties = app.get(PartiesService), chat = app.get(ChatService), social = app.get(SocialService);
    const content = await app.get(ContentService).get(true), transactions = app.get(UnitOfWork);
    const accounts = await identity.list();
    const actors: { accountId: string; session: AccountSession; characterId: string; name: string }[] = [];
    for (const fixture of fixtures) {
      const account = accounts.find(account => account.name === fixture.account) ?? await identity.create({ name: fixture.account });
      const existing = (await characters.list(account.id)).find(character => character.name === fixture.name);
      let character = existing ?? await creation.create({ name: fixture.name, templateId: fixture.templateId }, account.id);
      if (!existing) {
        character = await transactions.run(context => characters.update(character.id, content, value => {
          let experience = -value.experience;
          for (let level = value.level; level < fixture.level; level++) experience += experienceToNextLevel(level, content.balance.progression);
          if (experience > 0) gainExperience(value, experience, content.balance.progression);
        }, context));
        const skillId = content.characterTemplates.find(template => template.id === fixture.templateId)!.skillId;
        if (!character.learnedSkillIds.includes(skillId)) character = await skills.learn(character.id, { skillId });
      }
      if (fixture.level > 1) {
        // Only public inventory operations create canonical instances and receipts.
        for (const item of content.items.filter(item => item.groupId === 'resources' || item.groupId === 'tools')) {
          await inventory.receive(character.id, item.id, item.groupId === 'tools' ? 1 : 30, operationId('inventory', character.id, item.id));
        }
      }
      let exploration = await gathering.get(character.id);
      // Never consume a player's unfinished expedition on a subsequent seed run.
      if (!exploration.expedition && exploration.xp < fixture.gatheringXp) {
        const act = async (action: GatheringAction) => {
          const result = await gathering.execute(character.id, { operationId: randomUUID(), expectedRevision: exploration.revision, action });
          exploration = result.view;
        };
        while (exploration.xp < fixture.gatheringXp) {
          await act({ type: 'start', areaId: 'forest', routeId: 'forest-edge' });
          while (exploration.expedition!.step < exploration.expedition!.totalSteps && exploration.xp < fixture.gatheringXp) {
            await act({ type: 'harvest', resourceId: 'herb-patch', methodId: 'pick' });
          }
          await act({ type: 'return' });
        }
      }
      const login = await identity.login({ accountId: account.id }); tokens.push(login.token);
      const session = await identity.selectCharacter(login.token, { characterId: character.id });
      actors.push({ accountId: account.id, session, characterId: character.id, name: fixture.name });
    }
    const partyAction = async (actor: typeof actors[number], action: PartyAction) => {
      const state = await parties.state(actor.session);
      return parties.command(actor.session, { operationId: randomUUID(), expectedPartyId: state.party?.id ?? null, expectedRevision: state.party?.revision ?? 0, action });
    };
    const leader = actors[0], healer = actors[1], seventh = actors[6];
    const existingParty = (await parties.state(leader.session)).party;
    // A later run must not re-add kicked members or overwrite a different leader.
    const firstInvitation = !existingParty && !(await parties.state(healer.session)).party ? await parties.command(leader.session, {
      operationId: operationId('initial-party', leader.accountId), expectedPartyId: null, expectedRevision: 0,
      action: { type: 'invite', targetPlayerId: healer.accountId },
    }) : null;
    if (firstInvitation && !firstInvitation.replayed) {
      await partyAction(healer, { type: 'accept', invitationId: firstInvitation.invitationId! });
      for (const actor of actors.slice(2, 5)) {
        if ((await parties.state(actor.session)).party) continue;
        const invitation = await partyAction(leader, { type: 'invite', targetPlayerId: actor.accountId });
        await partyAction(actor, { type: 'accept', invitationId: invitation.invitationId! });
      }
      const party = (await parties.state(leader.session)).party;
      if (party) {
        await chat.send(leader.session, { operationId: operationId('group-message', party.id, 'leader'), authorCharacterId: leader.characterId,
          destination: { kind: 'party', partyId: party.id }, segments: [{ kind: 'text', text: 'Нас пятеро. Пригласите Кристаллиста на шестое место, затем проверьте приглашение Седьмого.' }] });
        if (party.members.some(member => member.playerId === healer.accountId)) await chat.send(healer.session, { operationId: operationId('group-message', party.id, 'healer'), authorCharacterId: healer.characterId,
          destination: { kind: 'party', partyId: party.id }, segments: [{ kind: 'text', text: 'У Кристаллиста не должно быть этой переписки до вступления. После выхода и возврата проверьте историю за время отсутствия.' }] });
      }
      // A ready friend makes the invite action available from the friends list too.
      for (const [actor, target] of [[leader, seventh], [seventh, leader]] as const) {
        const state = await social.state(actor.accountId), relation = state.relationships.find(row => row.playerId === target.accountId);
        if (relation?.friendship === 'accepted' || relation?.blocked) continue;
        await social.command(actor.accountId, { operationId: randomUUID(), targetPlayerId: target.accountId, expectedRevision: relation?.revision ?? 0, action: 'friend-request' });
      }
    }
    await chat.send(leader.session, { operationId: operationId('world-message', leader.accountId), authorCharacterId: leader.characterId,
      destination: { kind: 'world' }, segments: [{ kind: 'text', text: 'Тестовый мир готов: аккаунты «Тест: …», группа 5/6, инструменты и материалы для добычи и крафта.' }] });
    await chat.send(leader.session, { operationId: operationId('direct-message', leader.accountId), authorCharacterId: leader.characterId,
      destination: { kind: 'direct', recipientPlayerId: seventh.accountId }, segments: [{ kind: 'text', text: 'После вступления Кристаллиста шестое место будет занято. Проверьте отказ приглашения Седьмому и передачу лидерства.' }] });
    console.log(JSON.stringify({ accounts: fixtures.map(fixture => fixture.account), characters: actors.map(actor => actor.name),
      partyMembers: (await parties.state(leader.session)).party?.members.length ?? 0, note: 'Токены временных сессий отозваны при завершении.' }, null, 2));
  } finally {
    const identity = app.get(IdentityService);
    await Promise.allSettled(tokens.map(token => identity.logout(token)));
    await app.close();
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
