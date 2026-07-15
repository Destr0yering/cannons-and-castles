import { createServer, getServerPort } from '@devvit/web/server';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { gameApi } from './routes/game-api';
import { menu } from './routes/menu';
import { triggers } from './routes/triggers';

const app = new Hono();
const internal = new Hono();

app.route('/api', gameApi);
internal.route('/menu', menu);
internal.route('/triggers', triggers);
app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
