#!/bin/bash

# Usage: ./rclone_move_wasabi.sh <source_file_or_dir> <destination_remote_path> <rclone_config>

# Vérifie les arguments
if [ $# -ne 3 ]; then
    echo "Usage: $0 <source> <destination> <rclone_config>"
    echo "Example: $0 ./aria2.zip wasabi:plex.knbs/backup"
    exit 1
fi

SOURCE="$1"
DEST="$2"

rclone move "$SOURCE" "$DEST" \
  --progress \
  --transfers=8 \
  --checkers=16 \
  --s3-upload-concurrency=8 \
  --s3-chunk-size=64M \
  --buffer-size=64M \
  --fast-list \
  --delete-empty-src-dirs \
  --low-level-retries=10 \
  --retries=2 \
  --retries-sleep=10s