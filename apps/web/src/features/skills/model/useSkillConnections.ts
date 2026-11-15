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
        const x1 = from.left + from.width / 2 - bounds.left, y1 = from.bottom - bounds.top;
        const x2 = to.left + to.width / 2 - bounds.left, y2 = to.top - bounds.top;
        const mid = y1 + (y2 - y1) / 2;
        edges.push({ id: `${id}:${node.id}`, path: bounds.width < 650
            ? `M ${from.left - bounds.left} ${y1 - 12} H ${8 + edges.length % 3 * 5} V ${y2 + 16} H ${to.left - bounds.left}`
            : `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`,
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
