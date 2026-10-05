import Fastify from 'fastify';
import { bot } from './telegram.js';
import { env, companies, thresholdsMinutes } from './config.js';
import { seedStaff } from './services/staff.js';
import { syncCompanies } from './services/companies.js';
import { startMonitor } from './services/monitor.js';

const app = Fastify({ logger: true });
let ready = false;

app.get('/health', async (_request, reply) => reply.code(ready ? 200 : 503).send({
  ok: ready, service: 'wpvh-sales-control', testMode: env.TEST_MODE,
  companies: companies.map(c => c.slug), thresholdsMinutes
}));

async function main() {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  await syncCompanies(companies);
  await seedStaff();

  await bot.api.deleteWebhook({ drop_pending_updates: false }).catch(() => undefined);
  void bot.start({ onStart: () => app.log.info('Telegram bot started in long-polling mode') })
    .catch(err => {
      ready = false;
      app.log.error({ message: err instanceof Error ? err.message : 'unknown error' }, 'Telegram polling stopped');
      process.exit(1);
    });

  await startMonitor();
  ready = true;
}

async function shutdown(signal: string) {
  ready = false;
  app.log.info({ signal }, 'Graceful shutdown started');
  bot.stop();
  await app.close();
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

main().catch(err => {
  app.log.error(err);
  process.exit(1);
});
