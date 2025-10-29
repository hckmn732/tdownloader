-- CreateTable
CREATE TABLE "Torrent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "magnetUri" TEXT,
    "torrentFilePath" TEXT,
    "originalName" TEXT NOT NULL,
    "cleanedName" TEXT,
    "originalToCleanMap" JSONB,
    "suggestedDir" TEXT,
    "finalDir" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" REAL NOT NULL DEFAULT 0,
    "bytesTotal" BIGINT NOT NULL DEFAULT 0,
    "bytesDone" BIGINT NOT NULL DEFAULT 0,
    "downloadSpeed" BIGINT NOT NULL DEFAULT 0,
    "etaSec" INTEGER,
    "aria2Gid" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TorrentFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "torrentId" TEXT NOT NULL,
    "originalPath" TEXT NOT NULL,
    "cleanedPath" TEXT,
    "bytesTotal" BIGINT NOT NULL DEFAULT 0,
    "bytesDone" BIGINT NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "TorrentFile_torrentId_fkey" FOREIGN KEY ("torrentId") REFERENCES "Torrent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EventLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "torrentId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventLog_torrentId_fkey" FOREIGN KEY ("torrentId") REFERENCES "Torrent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" JSONB NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Torrent_aria2Gid_key" ON "Torrent"("aria2Gid");
