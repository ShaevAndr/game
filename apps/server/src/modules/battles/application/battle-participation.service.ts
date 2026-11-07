import { Inject, Injectable } from '@nestjs/common';
import { TransactionContext } from '../../../shared/application/unit-of-work';
import { BattlesRepository } from '../ports/battles.repository';

/** Shared read scenario: inventory needs participation without depending on combat mutations. */
@Injectable()
export class BattleParticipationService {
  constructor(@Inject(BattlesRepository) private readonly repository: BattlesRepository) {}
  isCharacterInActiveBattle(characterId: string, context?: TransactionContext) {
    return this.repository.hasActiveCharacter(characterId, context);
  }
}
