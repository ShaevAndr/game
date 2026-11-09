import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { createProbe } from './probe.mjs';
import { openStore } from './store.mjs';

export default defineConfig(({ mode }) => ({
  build: { target: 'es2022' },
  plugins: [{ name: 'isolated-sandbox-authority', async configureServer(server) {
    const fixture = JSON.parse(readFileSync(new URL('./world-view.json', import.meta.url)));
    const store = await openStore({ memory: mode === 'test' });
    server.httpServer?.once('close', () => { void store.close(); });
    let queue = Promise.resolve();
    server.middlewares.use('/probe-api', async (request, response) => {
      response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store');
      try {
        let command = null;
        if (request.method === 'POST') {
          let body = '';
          for await (const chunk of request) { body += chunk; if (body.length > 8192) throw new Error('Request too large'); }
          command = JSON.parse(body);
        } else if (request.method !== 'GET') throw new Error('Unsupported method');
        const work = queue.then(async () => {
          const catalog = await store.catalog(), saved = await store.load();
          const authority = createProbe(fixture, { catalog, ...(command?.type === 'reset' ? {} : { state: saved }) });
          authority.ensureStartingSupply('tree-resin', 10, 'starter-resin');
          if (command && command.type !== 'reset') authority.execute(command);
          const next = authority.exportState();
          if (!saved || command?.type === 'reset' || next.revision !== saved.revision) await store.save(next, saved?.revision ?? null);
          return authority.snapshot();
        });
        queue = work.catch(() => {});
        response.end(JSON.stringify(await work));
      } catch (error) { response.statusCode = error.code ? 409 : 503; response.end(JSON.stringify({ code: error.code ?? 'STORE_UNAVAILABLE', error: error.message })); }
    });
  } }],
}));
