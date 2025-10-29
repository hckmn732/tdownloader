/**
 * Utility functions for the torrent application
 */

import type { Torrent } from "@prisma/client";

export type TorrentDTO = {
  id: string;
  name: string;
  cleanedName?: string;
  status: "queued" | "downloading" | "paused" | "completed" | "failed" | "cancelled";
  progress: number;
  bytesDone: number;
  bytesTotal: number;
  downloadSpeed: number;
  uploadSpeed?: number;
  etaSec?: number;
  createdAt: string;
};

/**
 * Converts a Prisma Torrent to a DTO for API responses
 */
export function torrentToDTO(torrent: {
  id: string;
  originalName: string;
  cleanedName?: string | null;
  status: string;
  progress: number;
  bytesDone: bigint | number;
  bytesTotal: bigint | number;
  downloadSpeed: bigint | number;
  uploadSpeed?: bigint | number;
  etaSec?: number | null;
  createdAt: Date | string;
}): TorrentDTO {
  return {
    id: torrent.id,
    name: torrent.originalName,
    cleanedName: torrent.cleanedName ?? undefined,
    status: torrent.status as TorrentDTO["status"],
    progress: torrent.progress,
    bytesDone: Number(torrent.bytesDone),
    bytesTotal: Number(torrent.bytesTotal),
    downloadSpeed: Number(torrent.downloadSpeed),
    uploadSpeed: torrent.uploadSpeed !== undefined ? Number(torrent.uploadSpeed) : undefined,
    etaSec: torrent.etaSec ?? undefined,
    createdAt: typeof torrent.createdAt === "string" ? torrent.createdAt : torrent.createdAt.toISOString(),
  };
}

/**
 * Merges torrent items into an array, avoiding duplicates and maintaining sort order
 */
export function mergeTorrentItems(
  existing: TorrentDTO[],
  updates: Partial<TorrentDTO>[],
  sortBy: "createdAt" = "createdAt"
): TorrentDTO[] {
  const map = new Map(existing.map((item) => [item.id, item] as const));
  
  for (const update of updates) {
    if (!update.id) continue;
    const existing = map.get(update.id);
    if (existing) {
      map.set(update.id, { ...existing, ...update });
    } else if (update.id && update.name && update.status) {
      // New item, ensure all required fields are present
      map.set(update.id, update as TorrentDTO);
    }
  }
  
  const merged = Array.from(map.values());
  
  if (sortBy === "createdAt") {
    return merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  
  return merged;
}

