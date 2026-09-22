#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
.venv/bin/python scripts/webui_service.py stop
exec .venv/bin/python scripts/service.py stop
