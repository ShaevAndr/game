import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import { applyGatheringAction, gatheringCatalog, gatheringCommandSchema, gatheringView, initialGatheringState, validateGatheringCatalog, type GatheringReceipt } from '@game/core';
import { UnitOfWork } from '../../../shared/application/unit-of-work';
import { ContentService } from '../../content/application/content.service';
import { InventoryService } from '../../inventory/application/inventory.service';
import { GatheringRepository } from '../ports/gathering.repository';

@Injectable()
export class GatheringService {
  constructor(
    @Inject(UnitOfWork) private readonly transactions: UnitOfWork,
    @Inject(ContentService) private readonly content: ContentService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(GatheringRepository) private readonly repository: GatheringRepository,
  ) {}

  async get(ownerId: string) {
    const content = await this.content.get(true);
    validateGatheringCatalog(gatheringCatalog, content.items);
    return this.transactions.run(async context => {
      const inventory = await this.inventory.state(ownerId, content, context);
      const state = await this.repository.load(ownerId, context) ?? initialGatheringState();
      return gatheringView(state, gatheringCatalog, inventory, content.items);
    });
  }

  async execute(ownerId: string, input: unknown): Promise<GatheringReceipt> {
    const command = gatheringCommandSchema.parse(input);
    const signature = JSON.stringify({ expectedRevision: command.expectedRevision, action: command.action });
    const content = await this.content.get(true);
    validateGatheringCatalog(gatheringCatalog, content.items);
    return this.transactions.run(async context => {
      // Lock the character before inserting FK-backed receipts: concurrent operations
      // must not both hold a parent KEY SHARE lock and then upgrade to FOR UPDATE.
      let inventory = await this.inventory.state(ownerId, content, context);
      const receipt = await this.repository.claim(ownerId, command.operationId, signature, context);
      if (receipt.signature !== signature) throw new ConflictException('ID операции уже использован с другими параметрами');
      if (receipt.result) return receipt.result;
      const state = await this.repository.load(ownerId, context) ?? initialGatheringState();
      if (state.revision !== command.expectedRevision) throw new ConflictException('Состояние вылазки изменилось; обновите экран');
      let transition: ReturnType<typeof applyGatheringAction>;
      try { transition = applyGatheringAction(state, command.action, gatheringCatalog, inventory, randomUUID, max => randomInt(max)); }
      catch (error) { throw new BadRequestException((error as Error).message); }
      if (transition.returned.length) inventory = await this.inventory.receiveInTransaction(ownerId, transition.returned, content, context);
      await this.repository.save(ownerId, transition.state, context);
      const result = { view: gatheringView(transition.state, gatheringCatalog, inventory, content.items), outcome: transition.outcome };
      await this.repository.finish(ownerId, command.operationId, result, context);
      return result;
    });
  }
}
