import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDb, closeDb } from './db/db.js';
import { config, ROOT } from './config.js';
import { registerApi } from './api.js';

const app = Fastify({ logger: { level: 'warn' } });
const db = await getDb();
registerApi(app, db);

// Serve the built web app when present (npm run build); in dev, Vite serves it and proxies /api here.
const dist = resolve(ROOT, 'dist');
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist });
  app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api') ? reply.code(404).send({ error: 'Not found' }) : reply.sendFile('index.html')));
}

// Local only: bind to loopback so the real data is never exposed on the network.
await app.listen({ port: config.port, host: '127.0.0.1' });
console.log(`ESH API on http://127.0.0.1:${config.port}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, async () => { await app.close(); await closeDb(); process.exit(0); });
