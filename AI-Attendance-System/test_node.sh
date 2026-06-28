#!/bin/bash
echo "Original PATH: $PATH"
if command -v node &>/dev/null; then
    echo "Found node at $(which node)"
    NODE_BIN_DIR="$(dirname "$(which node)")"
    export PATH="$NODE_BIN_DIR:$PATH"
fi
echo "New PATH: $PATH"
node -v
