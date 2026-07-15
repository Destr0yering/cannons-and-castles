import { connectRealtime } from '@devvit/web/client';
import type {
  ActionResponse,
  InitResponse,
  RealtimeMessage,
  StateResponse,
} from '../../shared/api';

type Handler = (payload?: unknown) => void;
type Acknowledge = (response: ActionResponse) => void;

export class DevvitSocket {
  readonly transport = 'reddit-realtime';
  private readonly handlers = new Map<string, Set<Handler>>();
  private initialized = false;
  private postId = '';
  private stateRefresh: Promise<void> = Promise.resolve();

  on(event: string, handler: Handler): this {
    const handlers = this.handlers.get(event) ?? new Set<Handler>();
    handlers.add(handler);
    this.handlers.set(event, handlers);
    if (event === 'connect' && !this.initialized) {
      this.initialized = true;
      queueMicrotask(() => void this.initialize());
    }
    return this;
  }

  emit(event: string, payload?: unknown, acknowledge?: Acknowledge): this {
    void this.handleEmit(event, payload, acknowledge);
    return this;
  }

  private dispatch(event: string, payload?: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }

  private async initialize(): Promise<void> {
    try {
      const init = await this.request<InitResponse>('/api/init');
      if (!init.ok || !init.postId) throw new Error(init.error ?? 'Reddit context is unavailable.');
      this.postId = init.postId;
      this.applyRedditIdentity(init.username ?? 'Redditor');
      this.dispatch('connect');
      this.dispatch('leaderboard', init.leaderboard ?? []);

      connectRealtime<RealtimeMessage>({
        channel: `cannons-castles:${this.postId}`,
        onConnect: () => this.dispatch('connect'),
        onDisconnect: () => this.dispatch('disconnect'),
        onMessage: (message) => this.handleRealtime(message),
      });

      if (init.queuedFor) {
        this.showQueuedState();
        this.dispatch('queueStatus', {
          desiredPlayers: init.queuedFor,
          queued: init.queued ?? 0,
        });
      }
      if (init.matchId) {
        this.dispatch('matchFound', { matchId: init.matchId });
      }
      if (init.state) this.dispatch('matchState', init.state);
    } catch (error) {
      console.error('Devvit initialization failed:', error);
      this.dispatch('disconnect');
      const errorNode = document.getElementById('lobby-error');
      if (errorNode) errorNode.textContent = this.errorMessage(error);
    }
  }

  private handleRealtime(message: RealtimeMessage): void {
    if (message.type === 'stateChanged') {
      this.queueStateRefresh();
      return;
    }
    if (message.type === 'phaseResolution') {
      this.dispatch('phaseResolution', message.resolution);
      return;
    }
    if (message.type === 'gameOver') {
      this.stateRefresh = this.stateRefresh.then(async () => {
        const state = await this.request<StateResponse>('/api/state');
        if (state.ok && state.state) {
          this.dispatch('gameOver', {
            state: state.state,
            results: message.results,
            leaderboard: message.leaderboard,
          });
        }
      });
      return;
    }
    this.dispatch(message.type, message);
  }

  private queueStateRefresh(): void {
    this.stateRefresh = this.stateRefresh.then(() => this.refreshState());
  }

  private async refreshState(): Promise<void> {
    const response = await this.request<StateResponse>('/api/state');
    if (response.ok && response.state) this.dispatch('matchState', response.state);
  }

  private async handleEmit(
    event: string,
    payload: unknown,
    acknowledge?: Acknowledge
  ): Promise<void> {
    try {
      let response: ActionResponse = { ok: true };
      if (event === 'joinQueue') {
        const desiredPlayers = this.readDesiredPlayers(payload);
        response = await this.request<ActionResponse>('/api/join', {
          method: 'POST',
          body: JSON.stringify({ desiredPlayers }),
        });
        if (response.ok && response.matchId) this.queueStateRefresh();
      } else if (event === 'leaveQueue') {
        response = await this.request<ActionResponse>('/api/leave', { method: 'POST' });
      } else if (event === 'lockTurn') {
        response = await this.request<ActionResponse>('/api/lock', {
          method: 'POST',
          body: JSON.stringify({ action: payload ?? {} }),
        });
      } else if (event === 'requestState') {
        await this.refreshState();
      }
      acknowledge?.(response);
    } catch (error) {
      console.error(`Devvit ${event} failed:`, error);
      acknowledge?.({ ok: false, error: this.errorMessage(error) });
    }
  }

  private async request<Response>(path: string, init?: RequestInit): Promise<Response> {
    const options: RequestInit = { ...init };
    if (init?.body) options.headers = { 'content-type': 'application/json' };
    const response = await fetch(path, options);
    const body = await response.json();
    if (!response.ok && !body.error) throw new Error(`Request failed (${response.status}).`);
    return body;
  }

  private readDesiredPlayers(payload: unknown): number {
    if (typeof payload !== 'object' || payload === null || !('desiredPlayers' in payload)) return 4;
    return Number(payload.desiredPlayers);
  }

  private applyRedditIdentity(username: string): void {
    const input = document.getElementById('username');
    if (!(input instanceof HTMLInputElement)) return;
    input.value = username;
    input.readOnly = true;
    input.title = 'Your verified Reddit username is used for multiplayer and scoring.';
  }

  private showQueuedState(): void {
    document.getElementById('matchmaking-form')?.classList.add('hidden');
    document.getElementById('queue-state')?.classList.remove('hidden');
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'The Reddit war room rejected that order.';
  }
}
