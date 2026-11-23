import { loadConfig } from './config/env.js';
import { createDb } from './db/client.js';
import { buildApp } from './app.js';

const config = loadConfig();
const db = createDb(config);
const app = await buildApp({ config, db });

// Passenger (cPanel) provides PORT; otherwise use the configured host/port.
const port = Number(process.env.PORT ?? config.PORT);
await app.listen({ host: config.HOST, port });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await db.destroy();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
