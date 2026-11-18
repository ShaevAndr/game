import { useMemo } from 'react';
import { skillTreeNodes, type Content, type Element, type SkillTreeNode } from '@game/core';

export function useSkillTreeLayout(content: Content | null, element: Element) {
  const nodes = useMemo(() => {
    if (!content) return [];
    const grouped = skillTreeNodes(content.skills).filter(node => node.element === element);
    // Custom skills without group metadata still show their actual mandatory dependencies.
    const ungrouped = content.skills.filter(skill => skill.element === element && !skill.learning.branch).map((skill, i): SkillTreeNode => ({
      id: `single-${skill.id}`, name: skill.name, element, order: 100 + i, skills: [skill],
      parents: skill.learning.prerequisites.map(id => content.skills.find(skill => skill.id === id)?.learning.branch?.id ?? `single-${id}`),
    }));
    return [...grouped, ...ungrouped];
  }, [content, element]);
  const { rows, lanes } = useMemo(() => {
    const depths = new Map<string, number>();
    const depth = (node: SkillTreeNode): number => {
      if (depths.has(node.id)) return depths.get(node.id)!;
      const parents = nodes.filter(parent => node.parents.includes(parent.id));
      const result = parents.length ? 1 + Math.max(...parents.map(depth)) : 0;
      depths.set(node.id, result); return result;
    };
    for (const node of nodes) depth(node);
    const forks = nodes.filter(node => depths.get(node.id) === 1);
    const lane = (node: SkillTreeNode): number => {
      if (forks.some(fork => fork.id === node.id)) return forks.findIndex(fork => fork.id === node.id) + 1;
      const parent = nodes.find(parent => node.parents.includes(parent.id));
      return parent ? lane(parent) : 0;
    };
    return { rows: [...new Set(depths.values())].sort((a, b) => a - b).map(value => nodes.filter(node => depths.get(node.id) === value)), lanes: new Map(nodes.map(node => [node.id, lane(node)])) };
  }, [nodes]);
  return { nodes, rows, lanes };
}
