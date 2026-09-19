import type { ChangeOp } from "@tcw/shared";

/** Boot data the WordPress editor bridge puts on window.__TCWAB_EDITOR__. */
export interface EditorBoot {
  hubUrl: string;
  siteKey: string;
  testId: string;
  variantKey: string;
  token: string;
  expiresAt: number;
}

export class EditorApi {
  /** Renew this long before the token expires (tokens live 5 minutes). */
  static readonly RENEW_MARGIN_S = 90;
  private timer: ReturnType<typeof setTimeout> | undefined;
  onAuthLost: (reason: string) => void = () => {};

  constructor(
    private cfg: EditorBoot,
    private fetcher: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetcher(this.cfg.hubUrl + path, {
      method,
      headers: { authorization: `Bearer ${this.cfg.token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
    if (!res.ok) throw new Error(data.error ?? `http_${res.status}`);
    return data;
  }

  async loadOps(): Promise<ChangeOp[]> {
    return (await this.call<{ ops: ChangeOp[] }>("GET", "/editor/ops")).ops;
  }

  async saveOps(ops: ChangeOp[]): Promise<void> {
    await this.call("PUT", "/editor/ops", { ops });
  }

  async renew(): Promise<void> {
    const r = await this.call<{ token: string; expiresAt: number }>("POST", "/editor/renew");
    this.cfg.token = r.token;
    this.cfg.expiresAt = r.expiresAt;
  }

  /** Keeps the token fresh while the editor is open; reports when it can no longer be renewed. */
  startRenewing(now: () => number = () => Math.floor(Date.now() / 1000)): void {
    const schedule = () => {
      const wait = Math.max(5, this.cfg.expiresAt - now() - EditorApi.RENEW_MARGIN_S);
      this.timer = setTimeout(async () => {
        try {
          await this.renew();
          schedule();
        } catch (e) {
          this.onAuthLost((e as Error).message);
        }
      }, wait * 1000);
    };
    schedule();
  }

  stop(): void {
    clearTimeout(this.timer);
  }
}
