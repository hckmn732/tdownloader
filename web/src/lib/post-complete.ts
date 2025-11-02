/**
 * Handles post-completion processing for torrents and HTTP downloads: removes .aria2 sidecars and calls AI endpoint
 */

import { Aria2Client } from "@/lib/aria2/client";
import { prisma } from "@/lib/prisma";
import * as fs from "fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { runPostProcessingAgent } from "./agents/postProcessingAgent";
import { spawnSync } from "node:child_process";

/**
 * Processes a completed download (torrent or HTTP): removes .aria2 sidecar files and calls AI endpoint if configured
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

  const downloadsBaseDir = process.env.DOWNLOADS_BASE_DIR ?? "/downloads";
  const targetParent = process.env.ASSETS_BASE_DIR ?? "/media/library";
  const sourcePath = `${downloadsBaseDir}/${dbTorrent.originalName ?? null}`;

  // detect automatically the os with os library 
  let osPlatform = os.platform();


  const payloadAI = {
    name: dbTorrent.originalName ?? null,
    sourcePath: sourcePath,
    targetParent: targetParent,
    os: osPlatform
  }
  console.log(`Payload: ${JSON.stringify(payloadAI)}`);
    
  let sourcePathAI = sourcePath;
  let targetPathAI = targetParent + "/tmp/" + dbTorrent.originalName ;
  let osAI = "linux"; // default to linux
  try {  
    const result = await runPostProcessingAgent(JSON.stringify(payloadAI));
    const payloadAIParsed = JSON.parse(result) as any;
    sourcePathAI = payloadAIParsed.sourcePath;
    targetPathAI = payloadAIParsed.targetPath;
    osAI = payloadAIParsed.os;
  } catch (e) {
    console.error(`Error executing AI: ${e}`);
  }
  console.log(`--------------[ AI POST PROCESSING ]------------------`);
  console.log(`Source Path: ${sourcePath}`);
  console.log(`Target Path AI: ${targetPathAI}`);
  console.log(`OS AI: ${osAI}`);

  // use spawnSync to call rclone move with follwing option --progress --transfers=8 --checkers=16 --s3-upload-concurrency=8 --s3-chunk-size=64M --buffer-size=64M --fast-list --delete-empty-src-dirs --low-level-retries=10 --retries=2 --retries-sleep=10s
  const result = spawnSync("rclone", ["move", sourcePathAI, targetPathAI, "--progress", "--transfers=8", "--checkers=16", "--s3-upload-concurrency=8", "--s3-chunk-size=512M", "--buffer-size=256M", "--fast-list", "--delete-empty-src-dirs", "--low-level-retries=10", "--retries=2", "--retries-sleep=10s"]);
  return result.status === 0;
}
