import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Aria2Client } from "@/lib/aria2/client";
import { torrentToDTO } from "@/lib/utils";
import * as fs from "fs/promises";
import * as path from "node:path";

type Aria2File = {
  path?: string;
  uris?: Array<{ uri?: string }>;
};

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const deleteFiles = searchParams.get("deleteFiles") === "true";

    // Récupérer le torrent depuis la DB
    const torrent = await prisma.torrent.findUnique({
      where: { id },
      select: {
        id: true,
        aria2Gid: true,
        finalDir: true,
        originalName: true,
      },
    });

    if (!torrent) {
      return Response.json({ error: "Torrent not found" }, { status: 404 });
    }

    const client = new Aria2Client();
    const filesToDelete: string[] = [];

    // Si le torrent a un GID aria2, arrêter le téléchargement
    if (torrent.aria2Gid) {
      try {
        // 1) Récupérer les fichiers avant de supprimer dans aria2
        if (deleteFiles) {
          try {
            // Essayer d'abord getFiles
            const files = (await client.getFiles(torrent.aria2Gid)) as Aria2File[];
            for (const file of files) {
              const p = file.path?.trim();
              // Skip aria2 metadata pseudo-entries
              if (!p || p.startsWith("[METADATA]")) continue;
              filesToDelete.push(p);
            }
          } catch {
            // Si getFiles échoue (téléchargement complété/arrêté), essayer tellStatus pour obtenir le dir
            try {
              const status = await client.tellStatus(torrent.aria2Gid, ["dir", "files", "bittorrent"]);
              const dir = status.dir as string | undefined;
              const files = (status.files as Aria2File[] | undefined) || [];
              
              if (dir) {
                // Si on a un dossier et des fichiers, construire les chemins complets
                for (const file of files) {
                  const p = file.path?.trim();
                  if (!p || p.startsWith("[METADATA]")) continue;
                  const fullPath = path.isAbsolute(p) ? p : path.join(dir, p);
                  filesToDelete.push(fullPath);
                }
              }
            } catch {
              // Si on ne peut pas récupérer les fichiers, continuer quand même
            }
          }
        }

        // 2) Arrêter le téléchargement dans aria2
        try {
          await client.remove(torrent.aria2Gid);
        } catch {
          // Si remove échoue (par ex. déjà arrêté), essayer forceRemove
          try {
            await client.forceRemove(torrent.aria2Gid);
          } catch {
            // Ignorer l'erreur si le téléchargement n'existe plus
          }
        }
        // Purger les résultats terminés/erreurs côté aria2 pour libérer les références
        try {
          await client.purgeDownloadResult();
        } catch {}
        // Laisser un court délai pour relâcher d'éventuels verrous de fichiers
        await new Promise((r) => setTimeout(r, 200));
      } catch (e) {
        // Si aria2 n'est pas disponible, continuer quand même pour supprimer de la DB
        console.error(`Failed to remove from aria2:`, e);
      }
    }

    // Si finalDir est défini, supprimer aussi le dossier du torrent
    if (deleteFiles && torrent.finalDir) {
      try {
        const finalDirPath = torrent.finalDir;
        await fs.rm(finalDirPath, { recursive: true, force: true });
      } catch (e) {
        console.error(`Failed to delete finalDir ${torrent.finalDir}:`, e);
      }
    }

    // 3) Supprimer les fichiers individuels (ou dossiers)
    if (deleteFiles && filesToDelete.length > 0) {
      for (const filePath of filesToDelete) {
        try {
          const stats = await fs.stat(filePath).catch(() => null);
          if (!stats) {
            // missing file, ignore
            continue;
          }
          if (stats.isDirectory()) {
            await fs.rm(filePath, { recursive: true, force: true });
          } else {
            await fs.unlink(filePath);
          }
        } catch (e) {
          // Ignore deletion errors per-file but log once for debugging
          console.error(`Failed to delete path ${filePath}:`, e);
        }
      }
    }

    // Si le téléchargement se trouve dans le dossier de base (sans finalDir), essayer de supprimer le dossier du torrent
    if (deleteFiles && !torrent.finalDir && torrent.aria2Gid) {
      const downloadsDir = process.env.DOWNLOADS_BASE_DIR ?? "./downloads";
      // aria2 stocke généralement les torrents dans un sous-dossier nommé d'après le nom du torrent
      const torrentDir = path.join(downloadsDir, torrent.originalName);
      try {
        const stats = await fs.stat(torrentDir);
        if (stats.isDirectory()) {
          await fs.rm(torrentDir, { recursive: true, force: true });
        }
      } catch {
        // Le dossier n'existe peut-être pas ou est un fichier, ignorer
      }
    }

    // 4) Supprimer de la base de données (les fichiers et events seront supprimés en cascade)
    await prisma.torrent.delete({
      where: { id },
    });

    return Response.json({ success: true, deletedFiles: deleteFiles });
  } catch (err) {
    console.error("Delete error:", err);
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { action?: "pause" | "resume" };
    if (!body.action) {
      return Response.json({ error: "Missing action (pause|resume)" }, { status: 400 });
    }

    const torrent = await prisma.torrent.findUnique({ where: { id }, select: { id: true, aria2Gid: true } });
    if (!torrent) return Response.json({ error: "Torrent not found" }, { status: 404 });
    if (!torrent.aria2Gid) return Response.json({ error: "No aria2 GID associated" }, { status: 400 });

    const client = new Aria2Client();
    if (body.action === "pause") {
      try {
        await client.pause(torrent.aria2Gid);
      } catch {
        await client.forcePause(torrent.aria2Gid).catch(() => {});
      }
      await prisma.torrent.updateMany({ where: { aria2Gid: torrent.aria2Gid }, data: { status: "paused" as any } });
    } else if (body.action === "resume") {
      await client.unpause(torrent.aria2Gid).catch(() => {});
      await prisma.torrent.updateMany({ where: { aria2Gid: torrent.aria2Gid }, data: { status: "downloading" as any } });
    }

    // Attendre un peu puis resync pour avoir les vraies valeurs
    await new Promise((resolve) => setTimeout(resolve, 300));
    const updated = await prisma.torrent.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        progress: true,
        bytesDone: true,
        bytesTotal: true,
        downloadSpeed: true,
        originalName: true,
        cleanedName: true,
        createdAt: true,
      },
    });

    if (!updated) {
      return Response.json({ error: "Torrent not found after update" }, { status: 404 });
    }

    return Response.json({
      success: true,
      torrent: torrentToDTO(updated),
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

