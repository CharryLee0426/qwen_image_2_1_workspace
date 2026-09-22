#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
.venv/bin/python scripts/service.py start
exec .venv/bin/python scripts/webui_service.py start
