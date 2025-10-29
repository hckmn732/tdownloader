/*
  Warnings:

  - A unique constraint covering the columns `[infoHash]` on the table `Torrent` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Torrent" ADD COLUMN "infoHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Torrent_infoHash_key" ON "Torrent"("infoHash");
