#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/webui"
export NEXT_TELEMETRY_DISABLED=1
exec /Users/bytedance/.nvm/versions/node/v26.5.0/bin/node "$PWD/node_modules/next/dist/bin/next" start --hostname 127.0.0.1 --port 3000
