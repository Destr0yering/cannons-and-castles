import type {
  OnAppInstallRequest,
  OnPostDeleteRequest,
  TriggerResponse,
} from '@devvit/web/shared';
import { Hono } from 'hono';
import { createBattlePost } from '../core/post';
import { deleteSession } from '../store';

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

triggers.post('/on-post-delete', async (c) => {
  try {
    const input = await c.req.json<OnPostDeleteRequest>();
    await deleteSession(input.postId);
    return c.json<TriggerResponse>({});
  } catch (error) {
    console.error('Failed to remove deleted battle state:', error);
    return c.json<TriggerResponse>({}, 500);
  }
});
