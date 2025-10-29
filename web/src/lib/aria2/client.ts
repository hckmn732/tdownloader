type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: unknown[];
};

type JsonRpcResponse<T = unknown> = {
  jsonrpc: "2.0";
  id: string;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
};

export class Aria2Client {
  private readonly endpoint: string;
  private readonly tokenParam: string;

  constructor(opts?: { url?: string; secret?: string }) {
    const url =
      opts?.url ?? process.env.ARIA2_RPC_URL ?? "http://127.0.0.1:6800/jsonrpc";
    const secret = opts?.secret ?? process.env.ARIA2_RPC_SECRET ?? "";
    this.endpoint = url;
    this.tokenParam = secret ? `token:${secret}` : "";
  }

  private async rpcCall<T>(method: string, params: unknown[] = []): Promise<T> {
    const body: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: `${Date.now()}-${Math.random()}`,
      method,
      params: this.tokenParam ? [this.tokenParam, ...params] : params,
    };
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      // Aria2 is local; allow a modest timeout via AbortController if needed
    });
    const data = (await res.json()) as JsonRpcResponse<T>;
    if (!res.ok || data.error) {
      const message = data.error?.message ?? `HTTP ${res.status}`;
      throw new Error(`aria2 RPC error: ${message}`);
    }
    return data.result as T;
  }

  async addUri(uris: string[], options?: Record<string, unknown>): Promise<string> {
    // returns GID
    return this.rpcCall<string>("aria2.addUri", [uris, options ?? {}]);
  }

  async addTorrent(torrentBase64: string, uris?: string[], options?: Record<string, unknown>): Promise<string> {
    // returns GID
    // torrentBase64: le contenu du fichier torrent encodé en base64
    // uris: URLs optionnelles (trackers, etc.)
    return this.rpcCall<string>("aria2.addTorrent", [torrentBase64, uris ?? [], options ?? {}]);
  }

  async tellStatus(gid: string, keys?: string[]): Promise<Record<string, unknown>> {
    return this.rpcCall("aria2.tellStatus", [gid, keys ?? []]);
  }

  async getFiles(gid: string): Promise<unknown[]> {
    return this.rpcCall("aria2.getFiles", [gid]);
  }

  async tellActive(keys?: string[]): Promise<Record<string, unknown>[]> {
    return this.rpcCall("aria2.tellActive", [keys ?? []]);
  }

  async tellWaiting(offset = 0, num = 100, keys?: string[]): Promise<Record<string, unknown>[]> {
    return this.rpcCall("aria2.tellWaiting", [offset, num, keys ?? []]);
  }

  async remove(gid: string): Promise<string> {
    // Remove a download (returns GID)
    return this.rpcCall<string>("aria2.remove", [gid]);
  }

  async forceRemove(gid: string): Promise<string> {
    // Force remove a download (returns GID)
    return this.rpcCall<string>("aria2.forceRemove", [gid]);
  }

  async pause(gid: string): Promise<string> {
    // Pause a download
    return this.rpcCall<string>("aria2.pause", [gid]);
  }

  async forcePause(gid: string): Promise<string> {
    // Force pause a download
    return this.rpcCall<string>("aria2.forcePause", [gid]);
  }

  async unpause(gid: string): Promise<string> {
    // Resume a paused download
    return this.rpcCall<string>("aria2.unpause", [gid]);
  }

  async pauseAll(): Promise<string> {
    return this.rpcCall<string>("aria2.pauseAll", []);
  }

  async unpauseAll(): Promise<string> {
    return this.rpcCall<string>("aria2.unpauseAll", []);
  }

  async purgeDownloadResult(): Promise<string> {
    // Purge completed/error/removed downloads
    return this.rpcCall<string>("aria2.purgeDownloadResult", []);
  }
}


