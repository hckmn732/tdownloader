/**
 * Handles post-completion processing for torrents: removes .aria2 sidecars and calls AI endpoint
 */

import { Aria2Client } from "@/lib/aria2/client";
import { prisma } from "@/lib/prisma";
import * as fs from "fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { runPostProcessingAgent } from "./agents/postProcessingAgent";
import { spawnSync } from "node:child_process";

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
  // Replace this with runPostProcessingAgent call and extract the payload from the response and execute the actions
  const result = await runPostProcessingAgent(JSON.stringify(payloadAI));
  const payload = JSON.parse(result);
  const actions = payload.actions;
  const agentShell: string | undefined = payload.shell;


  if (Array.isArray(actions) && actions.length > 0) {  
    for (const action of actions) {
      console.log(`Executing action: ${action}`);
      try {
        const shellOption = agentShell === "powershell" ? { shell: "powershell.exe" } : { shell: true };
        // Use spawnSync with inherited stdio to avoid buffering large outputs which can cause EPIPE
        const result = spawnSync(action, {
          ...shellOption,
          stdio: "inherit",
        });
        if (result.status !== 0) {
          throw new Error(`Command failed with exit code ${result.status}`);
        }
      } catch (e) {
        console.error(`Error executing action: ${action}`, e);
      }
    }
  }

  return true;
}

