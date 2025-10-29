import { Aria2Client } from "@/lib/aria2/client";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const client = new Aria2Client();
    // Determine if aria2 RPC is reachable
    const running = await client
      .tellActive(["gid"]) // lightweight probe
      .then(() => true)
      .catch(() => false);

    let actives: any[] = [];
    let waiting: any[] = [];

    if (running) {
      try {
        [actives, waiting] = await Promise.all([
          client.tellActive([
            "gid",
            "status",
            "totalLength",
            "completedLength",
            "downloadSpeed",
            "uploadSpeed",
            "bittorrent",
            "numSeeders",
            "numLeechers",
            "connections",
          ]).catch(() => []),
          client.tellWaiting(0, 100, [
            "gid",
            "status",
            "totalLength",
            "completedLength",
            "downloadSpeed",
          ]).catch(() => []),
        ]);
      } catch (e) {
        // If any call fails, keep empty arrays
        actives = [];
        waiting = [];
      }
    }

    const torrents = await prisma.torrent.findMany({
      where: { aria2Gid: { not: null } },
      select: { id: true, aria2Gid: true, originalName: true },
    });

    const dbGids = new Set(torrents.map((t: typeof torrents[0]) => t.aria2Gid).filter((g: string | null): g is string => !!g));
    const aria2Gids = new Set([
      ...(actives as any[]).map((a) => String(a.gid ?? "")),
      ...(waiting as any[]).map((w) => String(w.gid ?? "")),
    ]);

    return Response.json({
      aria2: {
        running,
        actives: actives.length,
        waiting: waiting.length,
        activeDetails: actives,
        waitingDetails: waiting,
      },
      db: {
        torrentsCount: torrents.length,
        torrents,
      },
      diff: {
        inDbNotInAria2: Array.from(dbGids).filter((gid) => !aria2Gids.has(gid as string)),
        inAria2NotInDb: Array.from(aria2Gids).filter((gid) => !dbGids.has(gid as string)),
      },
    });
  } catch (error) {
    return Response.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

