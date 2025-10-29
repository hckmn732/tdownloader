import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function clean() {
  console.log("Cleaning database...");
  const deleted = await prisma.torrent.deleteMany({});
  console.log(`Deleted ${deleted.count} torrents.`);
  await prisma.$disconnect();
}

clean().catch(console.error);

