import { Inject, Injectable } from '@nestjs/common';
import { Battle, Content, addLog, gainExperience, victoryRecipients } from '@game/core';
import { TransactionContext } from '../../../shared/application/unit-of-work';
import { CharactersService } from '../../characters/application/characters.service';
import { RewardsRepository } from '../ports/rewards.repository';

@Injectable()
export class RewardsService {
  constructor(
    @Inject(RewardsRepository) private readonly repository: RewardsRepository,
    @Inject(CharactersService) private readonly characters: CharactersService,
  ) {}

  async award(battle: Battle, content: Content, context: TransactionContext) {
    const config = battle.content.balance.progression ?? content.balance.progression;
    const experience = config.victoryExperience[battle.kind] ?? config.victoryExperience.duel;
    battle.rewards = [];
    // All victories acquire character locks in a stable order.
    for (const characterId of victoryRecipients(battle)) {
      await this.characters.get(characterId, content, context, true);
      if (!await this.repository.claim(battle.id, characterId, experience, context)) continue;
      let levelsGained = 0;
      const character = await this.characters.update(characterId, content, character => {
        levelsGained = gainExperience(character, experience, config);
      }, context);
      battle.rewards.push({ characterId, experience, levelsGained });
      addLog(battle, `${character.name}: +${experience} опыта${levelsGained ? `, новый уровень ${character.level}, +${levelsGained * config.skillPointsPerLevel} очков навыков` : ''}`);
    }
  }
}
