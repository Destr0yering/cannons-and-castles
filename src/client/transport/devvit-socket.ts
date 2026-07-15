import { connectRealtime } from '@devvit/web/client';
import type {
  ActionResponse,
  InitResponse,
  RealtimeMessage,
  StateResponse,
} from '../../shared/api';
import { battleChannel } from '../../shared/realtime';

type Handler = (payload?: unknown) => void;
type Acknowledge = (response: ActionResponse) => void;

const RECOVERY_REFRESH_MS = 1650;

export class DevvitSocket {
  readonly transport = 'reddit-realtime';
  private readonly handlers = new Map<string, Set<Handler>>();
  private initialized = false;
  private postId = '';
  private currentMatchId = '';
  private stateRefresh: Promise<void> = Promise.resolve();
  private lastResolutionId = 0;
  private completedMatchId = '';

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
      this.selectMatch(init.matchId ?? '');
      this.applyRedditIdentity(init.username ?? 'Redditor');
      this.dispatch('connect');
      this.dispatch('leaderboard', init.leaderboard ?? []);

      void connectRealtime<RealtimeMessage>({
        channel: battleChannel(this.postId),
        onConnect: () => {
          this.dispatch('connect');
          this.queueStateRefresh();
        },
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
      if (init.state && !init.finalResults) this.dispatch('matchState', init.state);
      this.applyRecovery(init);
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
      this.dispatchResolution(message.resolution);
      return;
    }
    if (message.type === 'matchFound') {
      this.selectMatch(message.matchId);
      this.dispatch(message.type, message);
      return;
    }
    if (message.type === 'gameOver') {
      this.queueStateRefresh();
      return;
    }
    this.dispatch(message.type, message);
  }

  private queueStateRefresh(): void {
    this.stateRefresh = this.stateRefresh
      .catch((error) => {
        console.warn('Recovering the Devvit state refresh queue:', error);
      })
      .then(() => this.refreshState())
      .catch((error) => {
        console.error('Devvit state refresh failed:', error);
      });
  }

  private async refreshState(): Promise<void> {
    const response = await this.request<StateResponse>('/api/state');
    if (!response.ok || !response.state) return;
    if (!response.finalResults) this.dispatch('matchState', response.state);
    this.applyRecovery(response);
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
        if (response.ok && response.matchId) {
          this.selectMatch(response.matchId);
          this.queueStateRefresh();
        }
      } else if (event === 'leaveQueue') {
        response = await this.request<ActionResponse>('/api/leave', { method: 'POST' });
      } else if (event === 'lockTurn') {
        response = await this.request<ActionResponse>('/api/lock', {
          method: 'POST',
          body: JSON.stringify({ action: payload ?? {} }),
        });
        if (response.ok) this.queueStateRefresh();
      } else if (event === 'requestState') {
        await this.refreshState();
      } else if (event === 'deleteLeaderboardEntry') {
        response = await this.request<ActionResponse>('/api/privacy/delete-leaderboard-entry', {
          method: 'POST',
        });
        if (response.ok) this.dispatch('leaderboard', response.leaderboard ?? []);
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

  private applyRecovery(response: InitResponse | StateResponse): void {
    const stateMatchId = this.readMatchId(response.state);
    if (stateMatchId) this.selectMatch(stateMatchId);
    if (response.finalResults && response.state) {
      const matchId = stateMatchId;
      if (matchId && matchId !== this.completedMatchId) {
        this.completedMatchId = matchId;
        this.dispatch('gameOver', {
          state: response.state,
          results: response.finalResults,
          leaderboard: response.leaderboard ?? [],
        });
      }
      return;
    }
    if (response.lastResolution) this.dispatchResolution(response.lastResolution);
  }

  private dispatchResolution(resolution: unknown): void {
    const resolutionId = this.readResolutionId(resolution);
    if (resolutionId > 0 && resolutionId <= this.lastResolutionId) return;
    if (resolutionId > 0) {
      this.lastResolutionId = resolutionId;
      try {
        sessionStorage.setItem(this.resolutionStorageKey(), String(resolutionId));
      } catch {
        // Storage can be unavailable in hardened browser contexts; in-memory dedupe remains.
      }
    }
    this.dispatch('phaseResolution', resolution);
    setTimeout(() => this.queueStateRefresh(), RECOVERY_REFRESH_MS);
  }

  private readResolutionId(value: unknown): number {
    if (typeof value !== 'object' || value === null || !('id' in value)) return 0;
    const id = Number(value.id);
    return Number.isSafeInteger(id) && id > 0 ? id : 0;
  }

  private readMatchId(value: unknown): string {
    if (typeof value !== 'object' || value === null || !('id' in value)) return '';
    return typeof value.id === 'string' ? value.id : '';
  }

  private readStoredResolutionId(): number {
    if (!this.currentMatchId) return 0;
    try {
      const value = Number(sessionStorage.getItem(this.resolutionStorageKey()));
      return Number.isSafeInteger(value) && value > 0 ? value : 0;
    } catch {
      return 0;
    }
  }

  private resolutionStorageKey(): string {
    return `cannons-castles:last-resolution:${this.postId}:${this.currentMatchId}`;
  }

  private selectMatch(matchId: string): void {
    if (matchId === this.currentMatchId) return;
    this.currentMatchId = matchId;
    this.completedMatchId = '';
    this.lastResolutionId = this.readStoredResolutionId();
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'The Reddit war room rejected that order.';
  }
}
