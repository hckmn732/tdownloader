import { Aria2Client } from "@/lib/aria2/client";

export function extractInfoHash(magnetUri: string): string | null {
  if (!magnetUri || !magnetUri.startsWith("magnet:")) return null;
  // Try to extract xt=urn:btih:<hash> (hex or base32)
  const match = magnetUri.match(/[?&]xt=urn:btih:([a-zA-Z0-9]+)\b/);
  return match ? match[1] : null;
}

export class Aria2Service {
  private readonly client: Aria2Client;

  constructor() {
    this.client = new Aria2Client();
  }

  async addMagnets(magnets: string[]): Promise<{
    gid?: string;
    magnet: string;
    error?: string;
  }[]> {
    const results = await Promise.all(
      magnets.map(async (magnet) => {
        try {
          const gid = await this.client.addUri([magnet]);
          return { gid, magnet };
        } catch (e) {
          return { magnet, error: (e as Error).message };
        }
      })
    );
    return results;
  }

  async addTorrentFiles(torrentFiles: Array<{ name: string; base64: string }>): Promise<{
    gid?: string;
    filename: string;
    error?: string;
  }[]> {
    const results = await Promise.all(
      torrentFiles.map(async ({ name, base64 }) => {
        try {
          const gid = await this.client.addTorrent(base64);
          return { gid, filename: name };
        } catch (e) {
          return { filename: name, error: (e as Error).message };
        }
      })
    );
    return results;
  }
}

