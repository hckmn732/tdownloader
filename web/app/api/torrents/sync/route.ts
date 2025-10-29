import { synchronizeActive } from "@/lib/sync";
import { prisma } from "@/lib/prisma";
import { torrentToDTO } from "@/lib/utils";

export async function GET() {
  const { items } = await synchronizeActive();
  const list = await prisma.torrent.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return Response.json({
    updated: items,
    list: list.map(torrentToDTO),
  });
}


