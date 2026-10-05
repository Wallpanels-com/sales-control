import Fastify from 'fastify';
import { bot } from './telegram.js';
import { env, companies, thresholdsMinutes } from './config.js';
import { seedStaff } from './services/staff.js';
import { syncCompanies } from './services/companies.js';
import { startMonitor } from './services/monitor.js';

const app = Fastify({ logger: true });
let ready = false;
let telegramPolling = false;
let shuttingDown = false;

app.get('/health', async (_request, reply) => reply.code(200).send({
  ok: true, ready, telegramPolling, service: 'wpvh-sales-control', testMode: env.TEST_MODE,
  companies: companies.map(c => c.slug), thresholdsMinutes,
  productionCutoverAt: env.PRODUCTION_CUTOVER_AT || null
}));

async function runTelegramPolling(): Promise<void> {
  while (!shuttingDown) {
    try {
      await bot.start({
        onStart: () => {
          telegramPolling = true;
          app.log.info('Telegram bot started in long-polling mode');
        }
      });
      telegramPolling = false;
      if (!shuttingDown) app.log.warn('Telegram polling stopped unexpectedly; retrying');
    } catch (err) {
      telegramPolling = false;
      if (shuttingDown) return;
      app.log.warn({ message: err instanceof Error ? err.message : 'unknown error' }, 'Telegram polling unavailable; retrying');
    }
    if (!shuttingDown) await new Promise(resolve => setTimeout(resolve, 10_000));
  }
}

async function main() {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  await syncCompanies(companies);
  await seedStaff();

  await bot.api.deleteWebhook({ drop_pending_updates: false }).catch(() => undefined);
  void runTelegramPolling();

  await startMonitor();
  ready = true;
}

async function shutdown(signal: string) {
  shuttingDown = true;
  ready = false;
  app.log.info({ signal }, 'Graceful shutdown started');
  if (telegramPolling) bot.stop();
  await app.close();
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

main().catch(err => {
  app.log.error(err);
  process.exit(1);
});
