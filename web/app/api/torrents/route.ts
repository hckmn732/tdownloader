import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Aria2Service, extractInfoHash } from "@/lib/aria2/service";
import { torrentToDTO } from "@/lib/utils";
import * as fs from "fs/promises";
import * as path from "node:path";

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    const aria2 = new Aria2Service();
    const now = new Date();
    let created: Awaited<ReturnType<typeof prisma.torrent.create>>[] = [];

    // Handle file uploads (multipart/form-data)
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const files = formData.getAll("torrents") as File[];
      
      if (files.length === 0) {
        return Response.json({ error: "No torrent files provided" }, { status: 400 });
      }

      // Save files and prepare for aria2
      const torrentsDir = path.join(process.cwd(), "downloads", "_torrents");
      await fs.mkdir(torrentsDir, { recursive: true });

      const torrentFiles = await Promise.all(
        files.map(async (file) => {
          if (!file.name.endsWith(".torrent")) {
            throw new Error(`Invalid file type: ${file.name}. Expected .torrent file`);
          }
          const arrayBuffer = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const base64 = buffer.toString("base64");
          
          // Save file to disk for reference
          const filePath = path.join(torrentsDir, `${Date.now()}-${file.name}`);
          await fs.writeFile(filePath, buffer);

          return { name: file.name, base64, filePath };
        })
      );

      const results = await aria2.addTorrentFiles(
        torrentFiles.map((tf) => ({ name: tf.name, base64: tf.base64 }))
      );

      created = await Promise.all(
        results.map(async (r, idx) => {
          const torrentFile = torrentFiles[idx];
          if (!r.gid) {
            // Failed to add torrent
            return prisma.torrent.create({
              data: {
                type: "torrent",
                torrentFilePath: torrentFile.filePath,
                originalName: r.filename,
                status: "failed",
                progress: 0,
                bytesDone: BigInt(0),
                bytesTotal: BigInt(0),
                downloadSpeed: BigInt(0),
                errorMessage: r.error ?? "Failed to add torrent",
                createdAt: now,
              },
            });
          }

          // Check for duplicates by GID
          const existingByGid = await prisma.torrent.findFirst({ where: { aria2Gid: r.gid } });
          if (existingByGid) {
            return existingByGid;
          }

          return prisma.torrent.create({
            data: {
              type: "torrent",
              torrentFilePath: torrentFile.filePath,
              originalName: r.filename,
              status: r.error ? "failed" : "downloading",
              progress: 0,
              bytesDone: BigInt(0),
              bytesTotal: BigInt(0),
              downloadSpeed: BigInt(0),
              aria2Gid: r.gid,
              errorMessage: r.error ?? null,
              createdAt: now,
            },
          });
        })
      );
    } else {
      // Handle JSON request (magnets and/or HTTP URLs)
      const body = (await req.json()) as { magnets?: string[]; urls?: string[]; applyAi?: boolean };
      const magnets = (body.magnets ?? []).filter((m) => typeof m === "string" && m.startsWith("magnet:"));
      const httpUrls = (body.urls ?? []).filter((u) => typeof u === "string" && (u.startsWith("http://") || u.startsWith("https://")));
      
      if (magnets.length === 0 && httpUrls.length === 0) {
        return Response.json({ error: "No valid magnets or HTTP URLs provided" }, { status: 400 });
      }

      // Process magnets
      if (magnets.length > 0) {
        const results = await aria2.addMagnets(magnets);
        const magnetCreated = await Promise.all(
          results.map(async (r) => {
            const infoHash = r.magnet ? extractInfoHash(r.magnet) : null;
            if (!r.gid) {
              // Si pas de GID, créer quand même une entrée avec erreur
              // Mais d'abord, tenter de retrouver un existant par infoHash
              if (infoHash) {
                const existingByHash = await prisma.torrent.findFirst({
                  where: {
                    OR: [
                      { infoHash },
                      { magnetUri: { contains: infoHash } },
                    ],
                  },
                });
                if (existingByHash) {
                  return existingByHash;
                }
              }

              return prisma.torrent.create({
                data: {
                  type: "magnet",
                  magnetUri: r.magnet,
                  infoHash: infoHash ?? undefined,
                  originalName: r.magnet,
                  status: "failed",
                  progress: 0,
                  bytesDone: BigInt(0),
                  bytesTotal: BigInt(0),
                  downloadSpeed: BigInt(0),
                  errorMessage: r.error ?? "Failed to add magnet",
                  createdAt: now,
                },
              });
            }

            // Vérifier doublons par infoHash en priorité, puis par GID
            if (infoHash) {
              const existingByHash = await prisma.torrent.findFirst({
                where: {
                  OR: [
                    { infoHash },
                    { magnetUri: { contains: infoHash } },
                  ],
                },
              });
              if (existingByHash) {
                // Mettre à jour le GID s'il manquait
                if (!existingByHash.aria2Gid) {
                  return prisma.torrent.update({
                    where: { id: existingByHash.id },
                    data: { aria2Gid: r.gid, status: r.error ? "failed" : "downloading" },
                  });
                }
                return existingByHash;
              }
            }

            const existingByGid = await prisma.torrent.findFirst({ where: { aria2Gid: r.gid } });
            if (existingByGid) {
              return existingByGid;
            }

            return prisma.torrent.create({
              data: {
                type: "magnet",
                magnetUri: r.magnet,
                infoHash: infoHash ?? undefined,
                originalName: r.magnet,
                status: r.error ? "failed" : "downloading",
                progress: 0,
                bytesDone: BigInt(0),
                bytesTotal: BigInt(0),
                downloadSpeed: BigInt(0),
                aria2Gid: r.gid,
                errorMessage: r.error ?? null,
                createdAt: now,
              },
            });
          })
        );
        created.push(...magnetCreated);
      }

      // Process HTTP URLs
      if (httpUrls.length > 0) {
        const results = await aria2.addHttpUrls(httpUrls);
        const httpCreated = await Promise.all(
          results.map(async (r) => {
            if (!r.gid) {
              // Vérifier si l'URL existe déjà
              const existingByUrl = await prisma.torrent.findFirst({
                where: {
                  type: "http",
                  magnetUri: r.url,
                },
              });
              if (existingByUrl) {
                return existingByUrl;
              }

              return prisma.torrent.create({
                data: {
                  type: "http",
                  magnetUri: r.url,
                  originalName: r.url,
                  status: "failed",
                  progress: 0,
                  bytesDone: BigInt(0),
                  bytesTotal: BigInt(0),
                  downloadSpeed: BigInt(0),
                  errorMessage: r.error ?? "Failed to add HTTP URL",
                  createdAt: now,
                },
              });
            }

            // Vérifier doublons par URL, puis par GID
            const existingByUrl = await prisma.torrent.findFirst({
              where: {
                type: "http",
                magnetUri: r.url,
              },
            });
            if (existingByUrl) {
              // Mettre à jour le GID s'il manquait
              if (!existingByUrl.aria2Gid) {
                return prisma.torrent.update({
                  where: { id: existingByUrl.id },
                  data: { aria2Gid: r.gid, status: r.error ? "failed" : "downloading" },
                });
              }
              return existingByUrl;
            }

            const existingByGid = await prisma.torrent.findFirst({ where: { aria2Gid: r.gid } });
            if (existingByGid) {
              return existingByGid;
            }

            return prisma.torrent.create({
              data: {
                type: "http",
                magnetUri: r.url,
                originalName: r.url,
                status: r.error ? "failed" : "downloading",
                progress: 0,
                bytesDone: BigInt(0),
                bytesTotal: BigInt(0),
                downloadSpeed: BigInt(0),
                aria2Gid: r.gid,
                errorMessage: r.error ?? null,
                createdAt: now,
              },
            });
          })
        );
        created.push(...httpCreated);
      }
    }

    const dto = created.map(torrentToDTO);

    return Response.json(dto, { status: 201 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function GET() {
  const items = await prisma.torrent.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      originalName: true,
      cleanedName: true,
      status: true,
      progress: true,
      bytesDone: true,
      bytesTotal: true,
      downloadSpeed: true,
      etaSec: true,
      createdAt: true,
    },
  });
  return Response.json(items.map(torrentToDTO));
}


