import { useLayoutEffect, useRef, useState } from 'react';
import type { SkillTreeNode } from '@game/core';

interface Edge { id: string; path: string; open: boolean }
/** Measures presentation only. Requirements and membership are supplied by the catalog/core. */
export function useSkillConnections(nodes: SkillTreeNode[], learnedIds: string[], identity: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [drawing, setDrawing] = useState<{ width: number; height: number; edges: Edge[] }>({ width: 0, height: 0, edges: [] });
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    const draw = () => {
      const bounds = container.getBoundingClientRect();
      const boxes = new Map([...container.querySelectorAll<HTMLElement>('[data-branch-id]')].map(element => [element.dataset.branchId, element.getBoundingClientRect()]));
      const edges: Edge[] = [];
      for (const node of nodes) for (const id of node.parents) {
        const from = boxes.get(id), to = boxes.get(node.id);
        if (!from || !to) continue;
        const x1 = from.right - bounds.left, y1 = from.top + from.height / 2 - bounds.top;
        const x2 = to.left - bounds.left, y2 = to.top + to.height / 2 - bounds.top;
        const mid = x1 + (x2 - x1) / 2;
        edges.push({ id: `${id}:${node.id}`, path: `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`,
          open: nodes.find(parent => parent.id === id)!.skills.some(skill => learnedIds.includes(skill.id)) });
      }
      setDrawing({ width: bounds.width, height: bounds.height, edges });
    };
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    for (const node of container.querySelectorAll('[data-branch-id]')) observer.observe(node);
    draw();
    return () => observer.disconnect();
  }, [nodes, learnedIds, identity]);
  return { ref, drawing };
}
