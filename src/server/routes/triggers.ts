import type { OnAppInstallRequest, TriggerResponse } from '@devvit/web/shared';
import { Hono } from 'hono';
import { createBattlePost } from '../core/post';

export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  try {
    const input = await c.req.json<OnAppInstallRequest>();
    const post = await createBattlePost();
    return c.json<TriggerResponse>({
      status: 'success',
      message: `Created battle post ${post.id} after ${input.type}.`,
    });
  } catch (error) {
    console.error('Failed to create install battle post:', error);
    return c.json<TriggerResponse>(
      { status: 'error', message: 'Failed to create the first battle post.' },
      400
    );
  }
});
