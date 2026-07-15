import { context, requestExpandedMode } from '@devvit/web/client';

const startButton = document.getElementById('start-button');
const welcome = document.getElementById('welcome');

if (welcome && context.username) {
  welcome.textContent = `${context.username}, rally your neighbors for six simultaneous rounds of walls, angles, and cannon fire.`;
}

startButton?.addEventListener('click', (event) => {
  requestExpandedMode(event, 'game');
});
