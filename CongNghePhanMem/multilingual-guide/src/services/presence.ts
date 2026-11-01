import { apiFetch } from './api';

type Request = (path: string, options: { token: string; body: string; method: string; timeoutMs: number; keepalive?: boolean }) => Promise<unknown>;
export function presenceClientId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // This is an idempotency nonce, never an authentication credential.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const n = Math.floor(Math.random()*16); return (c === 'x' ? n : (n & 3) | 8).toString(16); });
}

export class PresenceClient {
  private token: string | null = null;
  private userId: number | null = null;
  private session: string | null = null;
  private clientId = presenceClientId();
  private generation = 0;
  private enabled = false;
  private visible = false;
  private pending = false;
  private lastTick = 0;
  private lastSignal = -Infinity;
  private lastInteraction = -Infinity;
  private retryAt = 0;
  private foreground = 0;
  private interaction = 0;
  constructor(private request: Request, private clock = () => performance.now(), private device = 'web') {}
  setDevice(device: string) { this.device = ['web','android','ios'].includes(device) ? device : 'unknown'; }
  setAccount(id: number | null, token: string | null) {
    if (id !== this.userId) {
      this.end('logout'); this.generation++; this.userId = id; this.clientId = presenceClientId(); this.lastSignal = -Infinity;
    }
    this.token = token;
  }
  setEnabled(enabled: boolean) {
    if (!enabled && this.enabled) { this.end('closed'); this.generation++; }
    this.enabled = enabled;
  }
  setVisible(visible: boolean) {
    this.sample(); this.visible = visible; this.lastTick = this.clock();
    if (visible) void this.pulse(true);
  }
  interact() { this.sample(); this.lastInteraction = this.clock(); }
  sample() {
    const now = this.clock();
    const elapsed = Math.max(0, Math.min(5, (now-this.lastTick)/1000));
    if (this.visible && this.enabled && this.token) {
      this.foreground = Math.min(45, this.foreground+elapsed);
      const interactive = Math.max(0, Math.min(now, this.lastInteraction+60_000)-this.lastTick)/1000;
      this.interaction = Math.min(this.foreground, this.interaction+Math.min(elapsed,interactive));
    }
    this.lastTick = now;
  }
  tick() { this.sample(); void this.pulse(); }
  private send(path: string, token: string, body: object, keepalive = false) {
    return this.request(path, { token, method: 'POST', body: JSON.stringify(body), timeoutMs: 8000, keepalive });
  }
  async pulse(force = false) {
    const now = this.clock();
    if (!this.token || !this.userId || !this.enabled || !this.visible || this.pending || now < this.retryAt || (!force && this.session && now-this.lastSignal<30_000)) return;
    const token = this.token, generation = this.generation;
    this.pending = true;
    try {
      if (!this.session) {
        const result = await this.send('/presence/start', token, { client_id: this.clientId, device: this.device }) as { id: string };
        if (generation !== this.generation || !this.visible || !this.enabled) {
          await this.send('/presence/end',token,{session_id:result.id,reason:'closed'},true).catch(()=>{});
          return;
        }
        this.session = result.id; this.foreground = 0; this.interaction = 0;
      } else {
        const foreground = this.foreground, interaction = this.interaction;
        await this.send('/presence/heartbeat',token,{session_id:this.session,foreground_seconds:foreground,interaction_seconds:Math.min(interaction,foreground)});
        if (generation === this.generation) { this.foreground = Math.max(0,this.foreground-foreground); this.interaction = Math.max(0,this.interaction-interaction); }
      }
      this.lastSignal = this.clock();
    } catch (error) {
      if (generation !== this.generation) return;
      const status = (error as {status?: number}).status;
      if (status === 409 || status === 404) { this.session = null; this.clientId = presenceClientId(); this.foreground = 0; this.interaction = 0; this.retryAt = now+1000; }
      else if (status === 403) this.enabled = false;
      else this.retryAt = now+30_000;
    } finally { this.pending = false; }
  }
  end(reason: 'logout' | 'closed' = 'closed') {
    this.sample();
    const session = this.session, token = this.token;
    const foreground = this.foreground, interaction = this.interaction;
    this.session = null; this.foreground = 0; this.interaction = 0; this.clientId = presenceClientId();
    if (session && token) void this.send('/presence/end',token,{session_id:session,reason,foreground_seconds:foreground,interaction_seconds:Math.min(interaction,foreground)},true).catch(()=>{});
  }
  dispose() { this.end('closed'); this.generation++; this.visible = false; this.token = null; }
}

export const presenceClient = new PresenceClient((path,options) => apiFetch(path,options), undefined,
  typeof navigator !== 'undefined' && navigator.product === 'ReactNative' ? 'unknown' : 'web');
