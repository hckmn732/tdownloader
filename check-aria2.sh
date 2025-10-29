#!/bin/bash

# Check if aria2c process is running
if pgrep -x "aria2c" > /dev/null; then
    echo "aria2 est en cours d'exécution:"
    ps aux | grep "[a]ria2c" | while read line; do
        PID=$(echo "$line" | awk '{print $2}')
        START_TIME=$(ps -o lstart= -p "$PID" 2>/dev/null || echo "N/A")
        echo "  PID: $PID - Démarrage: $START_TIME"
    done
    exit 0
else
    echo "aria2 n'est PAS en cours d'exécution."
    exit 1
fi

