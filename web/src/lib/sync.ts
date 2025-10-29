import { prisma } from "@/lib/prisma";
import { Aria2Client } from "@/lib/aria2/client";
import { handlePostComplete } from "@/lib/post-complete";

type Aria2Status = Record<string, unknown> & {
  gid?: string;
  status?: string;
  totalLength?: string;
  completedLength?: string;
  verifiedLength?: string;
  downloadSpeed?: string;
  uploadSpeed?: string;
  connections?: string | number;
  followedBy?: string[];
  bittorrent?: {
    info?: {
      name?: string;
    };
  };
  errorMessage?: string;
  errorCode?: string;
};

function mapAria2Status(status: string): "queued"|"downloading"|"paused"|"completed"|"failed"|"cancelled" {
  switch (status) {
    case "active":
      return "downloading";
    case "waiting":
      return "queued";
    case "paused":
      return "paused";
    case "error":
      return "failed";
    case "complete":
      return "completed";
    case "removed":
      return "cancelled";
    default:
      return "downloading";
  }
}

async function syncOneStatus(
  client: Aria2Client,
  gid: string
): Promise<{
  gid: string;
  status: string;
  progress: number;
  bytesDone: number;
  bytesTotal: number;
  downloadSpeed: number;
  uploadSpeed: number;
  connections: number;
  torrentName?: string;
  errorMessage?: string;
  isAllocating?: boolean;
  isChecking?: boolean;
} | null> {
  try {
    let s = (await client.tellStatus(gid, [
      "gid",
      "status",
      "totalLength",
      "completedLength",
      "verifiedLength",
      "downloadSpeed",
      "uploadSpeed",
      "connections",
      "followedBy",
      "errorMessage",
      "errorCode",
      "bittorrent",
    ])) as Aria2Status;

    // If this is the magnet metadata task, aria2 creates a new GID in `followedBy`.
    // Follow it to get the real torrent status/size.
    if (Array.isArray(s.followedBy) && s.followedBy.length > 0) {
      const nextGid = String(s.followedBy[0]);
      try {
        s = (await client.tellStatus(nextGid, [
          "gid",
          "status",
          "totalLength",
          "completedLength",
          "verifiedLength",
          "downloadSpeed",
          "uploadSpeed",
          "connections",
          "followedBy",
          "errorMessage",
          "errorCode",
          "bittorrent",
        ])) as Aria2Status;
        gid = nextGid; // switch to the real download GID
      } catch {
        // if we cannot fetch next, keep original
      }
    }
    const bytesTotal = Number(s.totalLength ?? 0);
    const bytesDone = Number(s.completedLength ?? 0);
    const downloadSpeed = Number(s.downloadSpeed ?? 0);
    const uploadSpeed = Number(s.uploadSpeed ?? 0);
    const connections = Number((s as any).connections ?? 0);
    const verifiedLength = Number((s as any).verifiedLength ?? 0);
    const progress = bytesTotal > 0 ? (bytesDone / bytesTotal) * 100 : 0;
    const aria2Status = String(s.status ?? "unknown");
    const prismaStatus = mapAria2Status(aria2Status);
    // Extract torrent name from bittorrent.info.name
    const torrentName = s.bittorrent?.info?.name ? String(s.bittorrent.info.name) : undefined;
    const isAllocating = aria2Status === "active" && bytesTotal > 0 && bytesDone === 0 && downloadSpeed === 0 && connections === 0;
    // Heuristic: checksum verification phase (aria2 doesn't expose explicit status)
    const isChecking = aria2Status === "active" && downloadSpeed === 0 && connections === 0 && bytesDone > 0 && verifiedLength < bytesDone;
    return {
      gid,
      status: prismaStatus,
      progress,
      bytesDone,
      bytesTotal,
      downloadSpeed,
      uploadSpeed,
      connections,
      torrentName,
      errorMessage: s.errorMessage ? String(s.errorMessage) : undefined,
      isAllocating,
      isChecking,
    };
  } catch (e) {
    const message = (e as Error)?.message ?? "";
    // If the download no longer exists in aria2, skip silently to avoid log spam
    if (typeof message === "string" && message.includes("is not found")) {
      return null;
    }
    console.error(`Failed to sync GID ${gid}:`, e);
    return null;
  }
}

export async function synchronizeActive(): Promise<{
  updatedCount: number;
  items: {
    id: string;
    gid: string;
    status: string;
    progress: number;
    bytesDone: number;
    bytesTotal: number;
    downloadSpeed: number;
    uploadSpeed: number;
    connections: number;
    name?: string;
    errorMessage?: string;
    isAllocating?: boolean;
    isChecking?: boolean;
  }[];
}> {
  const client = new Aria2Client();
  // If aria2 is not reachable, skip syncing quietly
  try {
    await client.tellActive(["gid"]);
  } catch {
    return { updatedCount: 0, items: [] };
  }
  
  // Récupérer tous les torrents avec un GID dans la DB
  const torrentsWithGid = await prisma.torrent.findMany({
    where: { aria2Gid: { not: null } },
    select: { id: true, aria2Gid: true, status: true },
  });
  
  // Also check for completed torrents that might not be in aria2 anymore (for post-complete hook)
  const completedTorrentsNeedingProcessing = await prisma.torrent.findMany({
    where: { 
      status: "completed",
      aria2Gid: { not: null },
      events: { none: { level: "info", message: "post-complete:handled" } }
    },
    select: { id: true, aria2Gid: true },
  });
  
  // Filter out completed torrents that are already in torrentsWithGid to avoid duplicate processing
  const processedIds = new Set(torrentsWithGid.map((t: { id: string }) => t.id));
  const completedOnly = completedTorrentsNeedingProcessing.filter((t: { id: string }) => !processedIds.has(t.id));

  let updatedCount = 0;
  const out: {
    id: string;
    gid: string;
    status: string;
    progress: number;
    bytesDone: number;
    bytesTotal: number;
    downloadSpeed: number;
    uploadSpeed: number;
    connections: number;
    name?: string;
    errorMessage?: string;
    isAllocating?: boolean;
    isChecking?: boolean;
  }[] = [];

  for (const t of torrentsWithGid) {
    if (!t.aria2Gid) continue;
    const sync = await syncOneStatus(client, t.aria2Gid);
    if (!sync) continue;

    const updateData: any = {
      status: sync.status as any,
      progress: sync.progress,
      bytesDone: BigInt(sync.bytesDone),
      bytesTotal: BigInt(sync.bytesTotal),
      downloadSpeed: BigInt(sync.downloadSpeed),
      errorMessage: sync.errorMessage ?? null,
      updatedAt: new Date(),
    };
    // Update torrent name if we discovered it and it's different from current
    if (sync.torrentName && sync.torrentName.trim()) {
      updateData.originalName = sync.torrentName;
    }
    const updated = await prisma.torrent.updateMany({
      where: { aria2Gid: t.aria2Gid },
      data: updateData,
    });
    updatedCount += updated.count;

    // If aria2 switched from metadata GID to real download GID, persist the new GID
    if (sync.gid !== t.aria2Gid) {
      await prisma.torrent.updateMany({
        where: { aria2Gid: t.aria2Gid },
        data: { aria2Gid: sync.gid },
      });
    }

    // Post-complete hook (once): remove .aria2 sidecars and call AI endpoint
    if (sync.status === "completed") {
      await handlePostComplete(t.id, sync.gid);
    }

    out.push({
      id: t.id,
      gid: sync.gid,
      status: sync.status,
      progress: sync.progress,
      bytesDone: sync.bytesDone,
      bytesTotal: sync.bytesTotal,
      downloadSpeed: sync.downloadSpeed,
      uploadSpeed: sync.uploadSpeed,
      connections: sync.connections,
      name: sync.torrentName,
      errorMessage: sync.errorMessage,
      isAllocating: sync.isAllocating,
      isChecking: sync.isChecking,
    });
  }

  // Process completed torrents that weren't in the active sync (aria2 might have purged them)
  for (const t of completedOnly) {
    if (!t.aria2Gid) continue;
    await handlePostComplete(t.id, t.aria2Gid);
  }

  return { updatedCount, items: out };
}
