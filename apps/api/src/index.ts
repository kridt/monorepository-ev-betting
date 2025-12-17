import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { registerRoutes } from './routes/index.js';
import { initDatabase } from './db/index.js';
import { startScheduler, stopScheduler } from './scheduler/index.js';

const app = Fastify({
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  },
});

// Register CORS
await app.register(cors, {
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://monorepository-ev-betting-web.vercel.app',
    /\.vercel\.app$/,  // Allow all Vercel preview deployments
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204,
});

// Initialize database
await initDatabase();

// Register routes
registerRoutes(app);

// Start scheduler
startScheduler();

// Graceful shutdown
const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}. Shutting down gracefully...`);
  stopScheduler();
  await app.close();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Start server
try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Server listening on http://${config.host}:${config.port}`);
  app.log.info(`Target sportsbooks: ${config.targetSportsbooks.join(', ')}`);
  app.log.info(`Sharp book: ${config.sharpBook}`);
  app.log.info(`Min EV: ${config.minEvPercent}%`);
  app.log.info(`Refresh interval: ${config.refreshIntervalMs / 1000}s`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
