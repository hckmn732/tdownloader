/**
 * Handles post-completion processing for torrents: removes .aria2 sidecars and calls AI endpoint
 */

import { Aria2Client } from "@/lib/aria2/client";
import { prisma } from "@/lib/prisma";
import * as fs from "fs/promises";
import * as path from "node:path";

/**
 * Processes a completed torrent: removes .aria2 sidecar files and calls AI endpoint if configured
 * Returns true if processing was successful, false if already handled or failed
 */
export async function handlePostComplete(torrentId: string, gid: string): Promise<boolean> {
  // Check if already handled to prevent duplicate processing
  const alreadyHandled = await prisma.eventLog.findFirst({
    where: { torrentId, level: "info", message: "post-complete:handled" },
  });
  
  if (alreadyHandled) {
    return false;
  }

  try {
    // Mark as handled immediately to prevent race conditions
    await prisma.eventLog.create({
      data: { torrentId, level: "info", message: "post-complete:handled" },
    });
  } catch (e) {
    // If EventLog creation failed (e.g., duplicate key), another instance handled it
    return false;
  }

  // Load torrent info
  const dbTorrent = await prisma.torrent.findUnique({
    where: { id: torrentId },
    select: { id: true, originalName: true, magnetUri: true, infoHash: true },
  });

  if (!dbTorrent) {
    return false;
  }

  // Remove .aria2 sidecar files
  const client = new Aria2Client();
  try {
    const status = (await client.tellStatus(gid, ["dir", "files"])) as any;
    const baseDir = typeof status?.dir === "string" ? status.dir : undefined;
    const files: Array<{ path?: string }> = Array.isArray(status?.files) ? status.files : [];
    
    for (const file of files) {
      const filePath = (file.path ?? "").trim();
      if (!filePath || filePath.startsWith("[METADATA]")) continue;
      
      const fullPath = path.isAbsolute(filePath) ? filePath : (baseDir ? path.join(baseDir, filePath) : filePath);
      const sidecarPath = `${fullPath}.aria2`;
      
      try {
        await fs.unlink(sidecarPath);
      } catch {
        // File may not exist, ignore
      }
    }
  } catch (e) {
    // Aria2 may have purged the download or it's not accessible anymore
    console.log(`Could not fetch files from aria2 for ${torrentId} (may be purged):`, (e as Error).message);
  }

  // Call AI endpoint if configured
  const aiEndpoint = process.env.AI_ENDPOINT_URL;
  if (aiEndpoint) {
    try {
      const payload = {
        torrentId,
        gid,
        when: new Date().toISOString(),
        name: dbTorrent.originalName ?? null,
        magnet: dbTorrent.magnetUri ?? null,
        infoHash: dbTorrent.infoHash ?? null,
      };
      
      const res = await fetch(aiEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      
      if (!res.ok) {
        console.error(`[AI] HTTP ${res.status} for torrent ${torrentId}`);
      }
    } catch (e) {
      console.error(`[AI] Call failed for torrent ${torrentId}:`, e);
    }
  }

  return true;
}

