import { elements, newBattle, createBoard, seedContent } from '../../src';

export const legacyContent = structuredClone(seedContent);
delete legacyContent.balance.combat;
legacyContent.skills.find(skill => skill.id === 'strike')!.cost = 0;

/** Explicit fixtures for snapshots that predate the matched-type combat rules. */
export const newLegacyBattle: typeof newBattle = (...args) => {
  args[6] = { ...(args[6] ?? {}), elementTypes: args[6]?.elementTypes ?? elements };
  const battle = newBattle(...args);
  delete battle.combatVersion;
  battle.rule = args[3];
  return battle;
};

export const createLegacyBoard = (random = Math.random) => createBoard({ elementTypes: elements }, random);
