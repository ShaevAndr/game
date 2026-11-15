import { z } from 'zod';
import type { Skill } from './types';

const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const skillIcons = ['spark', 'flame', 'meteor', 'phoenix', 'heart', 'drop', 'wave', 'ice', 'snowflake', 'cleanse', 'stone', 'mountain', 'leaf', 'tree', 'barrier', 'wind', 'storm', 'bolt', 'feather', 'sword', 'dagger', 'axes', 'shield', 'fist', 'eye', 'focus', 'wound', 'chain'] as const;
export type SkillIcon = typeof skillIcons[number];
export const skillBranchSchema = z.object({
  id, name: z.string().min(1).max(80), parents: z.array(id).max(8), order: z.number().int().min(0).max(1000),
}).strict();
export type SkillBranch = z.infer<typeof skillBranchSchema>;
export interface SkillTreeNode extends SkillBranch { element: Skill['element']; skills: Skill[] }

/** Nodes and membership come from catalog data; no skill IDs are special to the learning rule. */
export function skillTreeNodes(skills: Skill[]): SkillTreeNode[] {
  const nodes = new Map<string, SkillTreeNode>();
  for (const skill of skills) {
    const branch = skill.learning.branch;
    if (!branch) continue;
    const node = nodes.get(branch.id) ?? { ...branch, parents: [...branch.parents], element: skill.element, skills: [] };
    node.skills.push(skill); nodes.set(branch.id, node);
  }
  return [...nodes.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function branchLearningRequirements(learnedSkillIds: string[], skill: Skill, skills: Skill[]) {
  const nodes = skillTreeNodes(skills);
  return (skill.learning.branch?.parents ?? []).map(id => {
    const node = nodes.find(node => node.id === id);
    return { id, name: node?.name ?? id, skillIds: node?.skills.map(skill => skill.id) ?? [],
      met: !!node?.skills.some(skill => learnedSkillIds.includes(skill.id)) };
  });
}

export function validateSkillTree(skills: Skill[]): void {
  const nodes = skillTreeNodes(skills), byId = new Map(nodes.map(node => [node.id, node]));
  for (const skill of skills) {
    const branch = skill.learning.branch;
    if (!branch) continue;
    const node = byId.get(branch.id)!;
    if (node.element !== skill.element || node.name !== branch.name || node.order !== branch.order || JSON.stringify(node.parents) !== JSON.stringify(branch.parents))
      throw new Error(`Противоречивый узел дерева ${branch.id}`);
    if (new Set(branch.parents).size !== branch.parents.length) throw new Error(`Повтор зависимости узла ${branch.id}`);
    for (const parent of branch.parents) {
      if (!byId.has(parent)) throw new Error(`Неизвестный узел дерева ${parent}`);
      if (byId.get(parent)!.element !== skill.element) throw new Error(`Узел ${branch.id} зависит от другой школы`);
    }
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error('В дереве ветвей обнаружен цикл');
    if (visited.has(id)) return;
    visiting.add(id); for (const parent of byId.get(id)!.parents) visit(parent);
    visiting.delete(id); visited.add(id);
  };
  for (const node of nodes) visit(node.id);
  // Also catch a deadlock mixing mandatory skill prerequisites and alternative branch prerequisites.
  const reachable = new Set<string>();
  for (let pass = 0; pass < skills.length; pass++) {
    let added = false;
    for (const skill of skills) if (!reachable.has(skill.id) && skill.learning.prerequisites.every(id => reachable.has(id))
      && (skill.learning.branch?.parents ?? []).every(id => byId.get(id)!.skills.some(member => reachable.has(member.id)))) {
      reachable.add(skill.id); added = true;
    }
    if (!added) break;
  }
  if (nodes.length && reachable.size !== skills.length) throw new Error('Неразрешимые зависимости дерева навыков');
}
