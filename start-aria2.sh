#!/bin/bash
set -e

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DOWNLOAD_DIR="$SCRIPT_DIR/downloads"

# Check if aria2c is installed
if ! command -v aria2c &> /dev/null; then
    echo "Erreur: aria2c n'est pas installé ou n'est pas dans le PATH"
    echo "Installez aria2 avec: sudo apt-get install aria2 (Debian/Ubuntu) ou sudo yum install aria2 (RHEL/CentOS)"
    exit 1
fi

# Create downloads directory if it doesn't exist
if [ ! -d "$DOWNLOAD_DIR" ]; then
    mkdir -p "$DOWNLOAD_DIR"
    echo "Répertoire downloads créé: $DOWNLOAD_DIR"
fi

# Set environment variables (change secret if needed)
export ARIA2_RPC_SECRET="${ARIA2_RPC_SECRET:-changeme}"
export DOWNLOADS_BASE_DIR="$DOWNLOAD_DIR"

# Launch aria2 in background
aria2c \
    --enable-rpc \
    --rpc-listen-all=false \
    --rpc-secret="$ARIA2_RPC_SECRET" \
    --check-integrity=true \
    --continue=true \
    --seed-time=0 \
    --seed-ratio=0 \
    --max-upload-limit=1K \
    --bt-max-peers=50 \
    --dir="$DOWNLOAD_DIR" \
    --daemon \
    --log="$DOWNLOAD_DIR/aria2.log"

echo "Aria2 lancé en arrière-plan. Downloads: $DOWNLOAD_DIR"
echo "Consultez les logs: tail -f $DOWNLOAD_DIR/aria2.log"


