import { createServerApp } from './src/server/app.js';
import { env } from './src/server/lib/env.js';
import { logger } from './src/server/lib/logger.js';

const app = await createServerApp();

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'server_started');
});
