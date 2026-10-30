import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Content, contentSchema } from '@game/core';
import { Cache } from '../../../shared/application/cache.port';
import { CharacterTemplatesService } from '../../characters/application/character-templates.service';
import { SkillsCatalogService } from '../../skills/application/skills-catalog.service';
import { ItemsService } from '../../items/application/items.service';
import { RecipesCatalogService } from '../../crafting/application/recipes-catalog.service';
import { ContentSettingsRepository } from '../ports/content-settings.repository';

const cacheKey = 'content:v1';

@Injectable()
export class ContentService implements OnApplicationBootstrap {
  constructor(
    @Inject(ContentSettingsRepository) private readonly settings: ContentSettingsRepository,
    @Inject(SkillsCatalogService) private readonly skills: SkillsCatalogService,
    @Inject(ItemsService) private readonly items: ItemsService,
    @Inject(CharacterTemplatesService) private readonly templates: CharacterTemplatesService,
    @Inject(RecipesCatalogService) private readonly recipes: RecipesCatalogService,
    @Inject(Cache) private readonly cache: Cache,
  ) {}

  async onApplicationBootstrap() {
    await this.cache.delete(cacheKey);
    await this.get(true);
  }

  async get(fresh = false): Promise<Content> {
    if (!fresh) {
      const cached = await this.cache.get<Content>(cacheKey);
      const parsed = contentSchema.safeParse(cached);
      if (parsed.success) return parsed.data;
    }
    const [settings, skills, items, characterTemplates, itemGroups, recipes] = await Promise.all([
      this.settings.get(), this.skills.list(), this.items.list(), this.templates.list(), this.items.groups(), this.recipes.list(),
    ]);
    const content = contentSchema.parse({ ...settings, skills, items, characterTemplates, itemGroups, recipes });
    await this.cache.set(cacheKey, content, 30);
    return content;
  }
}
