import { reddit } from '@devvit/web/server';

export async function createBattlePost() {
  return reddit.submitCustomPost({
    title: 'Cannons and Castles — A Six-Round Siege',
  });
}
