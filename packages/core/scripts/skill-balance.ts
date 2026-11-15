import { allocateAttributes, applyAction, combatStatDefinitions, createCharacter, defaultCombatFormulaRules, findBattlefieldMatches,
  findBattlefieldSwap, createBattlefield, moveBattlefield, joinBattle, learnSkill, legalSkillTargets, newBattle, seedContent, seedEffectSkills, skillChoices, startBattle, upgradeSkill,
  type Battle, type Character, type Content, type Element, type Fighter } from '../src';
import { effectSkillUtility } from '../src/effects/skill-effects';

// Offline experiment: no database, network or global Math.random. Both sides use one visible-board policy.
const content: Content = { ...seedContent, effectsVersion: 1, modifierRulesVersion: 1, statDefinitions: combatStatDefinitions,
  balance: { ...seedContent.balance, formulas: defaultCombatFormulaRules }, skills: [...seedContent.skills, ...seedEffectSkills] };
const startingHp = Number(process.argv[3] ?? content.balance.characterStats.maxHp);
if (!Number.isInteger(startingHp) || startingHp < 60 || startingHp > 10000) throw new Error('Starting HP must be 60–10000');
content.statDefinitions = structuredClone(combatStatDefinitions);
const hp = content.statDefinitions.find(stat => stat.id === 'maxHp')!;
if (hp.kind === 'derived') hp.formula.constant = startingHp - 60;
content.balance = { ...content.balance, characterStats: { ...content.balance.characterStats, maxHp: startingHp } };
const builds = {
  physical: { weights: { strength: 5, dexterity: 2, vitality: 3 }, skills: ['strike', 'flying-blade', 'lunge', 'brace', 'bleeding-cut', 'trip', 'battle-focus', 'cleave', 'concussive-blow', 'execution'] },
  dexterity: { weights: { dexterity: 6, strength: 1, vitality: 3 }, skills: ['precise-thrust', 'strike', 'lunge', 'brace', 'bleeding-cut', 'trip', 'battle-focus', 'cleave', 'execution'] },
  fire: { weights: { intelligence: 6, vitality: 3, luck: 1 }, skills: ['ember', 'phoenix-warmth', 'burning-brand', 'fireball', 'purging-flame', 'inferno'] },
  water: { weights: { intelligence: 6, vitality: 3, luck: 1 }, skills: ['ice-shard', 'spring', 'ice-lance', 'mending-stream', 'tide', 'frost-lock', 'glacier'] },
  earth: { weights: { intelligence: 5, vitality: 4, strength: 1 }, skills: ['pebble', 'lifesap', 'earthen-barrier', 'quake', 'earthen-grasp', 'landslide'] },
  air: { weights: { intelligence: 6, vitality: 4 }, skills: ['breeze', 'soothing-wind', 'gust', 'sheltering-wind', 'thunderclap', 'tempest'] },
};
type Build = keyof typeof builds;
function randomStream(seed: number) { let state = seed >>> 0; return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296); }
function character(id: string, build: Build, level: number): Character {
  let hero = createCharacter(id, build, content); hero.level = level;
  hero.skillPoints = content.balance.progression.startingSkillPoints + (level - 1) * content.balance.progression.skillPointsPerLevel;
  hero.attributePoints = 5 + (level - 1) * 5;
  const entries = Object.entries(builds[build].weights), budget = hero.attributePoints;
  const allocations = Object.fromEntries(entries.map(([stat, weight]) => [stat, Math.floor(budget * weight / 10)]));
  allocations[entries[0][0]] += budget - Object.values(allocations).reduce((a, b) => a + b, 0);
  hero = allocateAttributes(hero, Object.fromEntries(Object.entries(allocations).filter(([, value]) => value)), content);
  for (const id of builds[build].skills) {
    try { learnSkill(hero, id, content); } catch { /* Actual prerequisites, level, points and base stats remain authoritative. */ }
  }
  for (let rank = 2; rank <= 10 && hero.skillPoints; rank++) for (const id of hero.learnedSkillIds) {
    if (!hero.skillPoints) break;
    upgradeSkill(hero, id, content);
  }
  return hero;
}
function bestSkill(battle: Battle, actor: Fighter) {
  return skillChoices(battle, actor).filter(choice => choice.enabled).flatMap(choice => {
    const skill = battle.content.skills.find(skill => skill.id === choice.skillId)!;
    return legalSkillTargets(battle, actor, skill).map(target => ({ skill, target,
      score: effectSkillUtility(battle, actor, skill, target.id) / Math.sqrt(Math.max(1, skill.cost / 3)) }));
  }).filter(value => value.score > 0).sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id) || a.target.id.localeCompare(b.target.id))[0];
}
function move(battle: Battle, actor: Fighter) {
  let best: { from: { row: number; col: number }; to: { row: number; col: number }; score: number } | undefined;
  const board = battle.board.map(row => [...row]);
  for (let row = 0; row < board.length; row++) for (let col = 0; col < board[0].length; col++) for (const [dr, dc] of [[0, 1], [1, 0]]) {
    const to = { row: row + dr, col: col + dc }, from = { row, col };
    if (to.row >= board.length || to.col >= board[0].length || board[row][col] === board[to.row][to.col]) continue;
    [board[row][col], board[to.row][to.col]] = [board[to.row][to.col], board[row][col]];
    const cells = findBattlefieldMatches(board), types = new Set(cells.map(cell => board[cell.row][cell.col]));
    const directMatches = Object.fromEntries([...types].map(type => [type, cells.filter(cell => board[cell.row][cell.col] === type).length]));
    const defense = cells.filter(cell => board[cell.row][cell.col] === 'defense').length;
    [board[row][col], board[to.row][to.col]] = [board[to.row][to.col], board[row][col]];
    if (!cells.length) continue;
    const energy = Math.min(200, (actor.skillEnergy ?? 0) + cells.length * content.balance.combat!.energyPerTile);
    const proxy = { ...battle, phase: 'choose' as const, usedSkill: false, matchedElements: [...types].filter(type => type !== 'defense') as Element[], directMatches };
    const score = (bestSkill(proxy, { ...actor, skillEnergy: energy })?.score ?? 0) + (energy - (actor.skillEnergy ?? 0)) * 0.02 + defense * 0.6;
    if (!best || score > best.score) best = { from, to, score };
  }
  return best ?? findBattlefieldSwap(battle.board)!;
}
const samples = Number(process.argv[2] ?? 6);
if (!Number.isInteger(samples) || samples < 1 || samples > 100) throw new Error('Samples must be 1–100');
const report: { level: number; first: Build; second: Build; battles: number; firstBuildWinRate: number; startingTeamWinRate: number; draws: number; medianActions: number; p90Actions: number }[] = [];
const names = Object.keys(builds) as Build[];
for (const level of [1, 10, 30]) for (let i = 0; i < names.length; i++) for (let j = i; j < names.length; j++) {
  let wins = 0, starts = 0, draws = 0; const lengths: number[] = [];
  for (let sample = 0; sample < samples; sample++) {
    const rng = randomStream(7919 * (sample + 1) + level * 101), first = character('first', names[i], level), second = character('second', names[j], level);
    const battle = newBattle(`simulation-${level}-${sample}`, 'Баланс', 'duel', 'on-match', first, content, {}, { create: (options, _random) => {
      // Use the same seed for the opening board, first team and all subsequent refills.
      return createBattlefield(options, rng);
    }, move: moveBattlefield, possibleMove: findBattlefieldSwap });
    joinBattle(battle, second, 1); startBattle(battle, rng); battle.attributeRngState = Math.floor(rng() * 4294967296);
    const startingTeam = battle.fighters.find(f => f.id === battle.activeId)!.team;
    let actions = 0;
    while (battle.status === 'active' && actions < 240) {
      const actor = battle.fighters.find(f => f.id === battle.activeId)!;
      if (battle.phase === 'before') { applyAction(battle, actor.id, { type: 'swap', ...move(battle, actor), targetId: '' }, rng); actions++; }
      else {
        const best = bestSkill(battle, actor);
        applyAction(battle, actor.id, best ? { type: 'skill', skillId: best.skill.id, targetId: best.target.id } : { type: 'end' }, rng);
      }
    }
    lengths.push(actions);
    if (battle.status !== 'finished' || battle.winner === null) draws++;
    else { if (battle.winner === 0) wins++; if (battle.winner === startingTeam) starts++; }
  }
  lengths.sort((a, b) => a - b);
  report.push({ level, first: names[i], second: names[j], battles: samples, firstBuildWinRate: wins / samples,
    startingTeamWinRate: starts / samples, draws, medianActions: lengths[Math.floor((samples - 1) / 2)], p90Actions: lengths[Math.ceil(samples * 0.9) - 1] });
}
process.stdout.write(JSON.stringify({ note: 'Deterministic smoke experiment with a visible-board heuristic, no free skills, equal attribute/skill budgets, no equipment or potions. Draw cutoff: 240 actions. Small samples are not proof of PvP balance.', startingHp, startingSkillPoints: content.balance.progression.startingSkillPoints, samples, results: report }, null, 2) + '\n');
