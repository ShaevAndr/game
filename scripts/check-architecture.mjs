import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, relative, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const graph = new Map();
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}
function report(file, message) { errors.push(`${relative(root, file)}: ${message}`); }
function sourceTarget(file, specifier) {
  if (!specifier.startsWith('.')) return;
  const base = resolve(dirname(file), specifier);
  return [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]
    .find(candidate => existsSync(candidate) && statSync(candidate).isFile());
}

for (const file of [...files(join(root, 'apps/server/src')), ...files(join(root, 'apps/web/src'))]) {
  const name = relative(root, file).replaceAll('\\', '/');
  const source = readFileSync(file, 'utf8');
  const imports = [...source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^;'"()]+?\s+from\s*)?['"]([^'"]+)['"]/g)].map(match => match[1]);
  const targets = imports.map(specifier => sourceTarget(file, specifier)).filter(Boolean);
  graph.set(file, targets);
  if (name.startsWith('apps/server/src/')) {
    const layer = name.match(/\/modules\/([^/]+)\/(application|http|ports|repositories)\//);
    for (const specifier of imports) {
      const driver = /^(?:kysely|pg|mongodb|ioredis|bullmq|socket\.io)(?:\/|$)/.test(specifier);
      const target = sourceTarget(file, specifier);
      const targetName = target ? relative(root, target).replaceAll('\\', '/') : specifier;
      if (layer && ['application', 'http', 'ports'].includes(layer[2])) {
        if ((driver && !(layer[2] === 'http' && /\.gateway\.ts$/.test(file) && specifier === 'socket.io')) || /\/infrastructure\//.test(targetName)) {
          report(file, `${layer[2]} must use ports, not storage/queue drivers: ${specifier}`);
        }
        if (layer[2] !== 'ports' && /\/repositories\//.test(targetName)) report(file, `Use a repository port: ${specifier}`);
      }
      if (layer) {
        const other = targetName.match(/\/modules\/([^/]+)\//);
        if (other && other[1] !== layer[1] && !/\/application\//.test(targetName)) {
          report(file, `Cross-module calls must use public application services: ${specifier}`);
        }
        if (layer[2] === 'repositories' && /\/modules\/[^/]+\/application\//.test(targetName)) report(file, `Repositories must not call services: ${specifier}`);
      }
      if (/\/shared\//.test(name) && /\/(?:modules|infrastructure)\//.test(targetName)) report(file, `Shared contracts must not depend on features: ${specifier}`);
      if (/\/infrastructure\//.test(name) && /\/modules\//.test(targetName)) report(file, `Infrastructure must not depend on feature modules: ${specifier}`);
    }
    if (file.endsWith('.module.ts') && /@(Controller|Injectable|Get|Post|WebSocketGateway)\b/.test(source)) {
      report(file, 'Module files only compose providers, imports and exports');
    }
  } else {
    if (/\/components\//.test(name) && imports.some(specifier => /(?:\/api\/|socket\.io-client)/.test(specifier))) report(file, 'UI components receive data/actions through props; network access belongs in api/model');
    if (/\bfetch\s*\(/.test(source) && !name.endsWith('/shared/api/http.ts')) report(file, 'Use the shared HTTP client');
    if (imports.includes('socket.io-client') && !name.startsWith('apps/web/src/features/battles/')) report(file, 'Realtime transport belongs to the battle feature');
    if (/\/shared\//.test(name) && targets.some(target => /\/features\//.test(target))) report(file, 'Shared UI/API must not import features');
  }
}

const visited = new Set();
const visiting = new Set();
function visit(file, path = []) {
  if (visiting.has(file)) { report(file, `Import cycle: ${[...path, file].map(value => relative(root, value)).join(' -> ')}`); return; }
  if (visited.has(file)) return;
  visiting.add(file);
  for (const target of graph.get(file) ?? []) if (graph.has(target)) visit(target, [...path, file]);
  visiting.delete(file);
  visited.add(file);
}
for (const file of graph.keys()) visit(file);
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`Architecture boundaries OK (${graph.size} source files).`);
