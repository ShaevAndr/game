import type { Character, Content } from '@game/core';
import type { ActionRunner } from '../../shared/model/useAsyncAction';
import { skillsApi } from './api/skills.api';
import { SkillTree } from './components/SkillTree';
import './skill-tree.css';

interface Props {
  character?: Character;
  content: Content | null;
  busy: boolean;
  run: ActionRunner;
  onCharacter: (character: Character) => void;
}

export function SkillsPage({ character, content, busy, run, onCharacter }: Props) {
  const learn = (skillId: string) => {
    if (!character) return;
    void run(async () => onCharacter(await skillsApi.learn(character.id, skillId)));
  };
  const upgrade = (skillId: string, level: number) => {
    if (!character) return;
    void run(async () => onCharacter(await skillsApi.upgrade(character.id, skillId, level)));
  };
  return <SkillTree character={character} content={content} busy={busy} onLearn={learn} onUpgrade={upgrade}/>;
}
