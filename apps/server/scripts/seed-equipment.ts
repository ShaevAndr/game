import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';

config({ path: resolve(process.cwd(), '../../.env') }); config();

async function main() {
  const { AppModule } = await import('../src/app.module');
  const { CharactersService } = await import('../src/modules/characters/application/characters.service');
  const { InventoryService } = await import('../src/modules/inventory/application/inventory.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const characters = await app.get(CharactersService).list(), inventory = app.get(InventoryService);
    for (const character of characters) {
      const result = await inventory.seedEquipmentSamples(character.id);
      console.log(JSON.stringify({ character: character.name, characterLevel: character.level, samples: result.itemIds.length, itemLevel: 1 }));
    }
  } finally { await app.close(); }
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
