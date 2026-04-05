#!/bin/bash
# Production deployment helper for OpenClaw (build locally; deploy via git/SSH on the host).
#
# Do not put passwords or private keys in this file. Use SSH keys and ~/.ssh/config.
#
# Optional environment:
#   DEPLOY_HOST       default: root@your-server.example
#   DEPLOY_SSH_PORT   default: 22
#   DEPLOY_REMOTE_DIR default: /opt/openclaw
#   DEPLOY_GIT_BRANCH branch to pull on the server (default: current branch or main)
#
set -euo pipefail

SERVER="${DEPLOY_HOST:-}"
PORT="${DEPLOY_SSH_PORT:-22}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/opt/openclaw}"

echo "=== OpenClaw production build (local) ==="
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

echo "Step 1: Installing deps and building..."
pnpm install
pnpm build
pnpm ui:build

echo ""
echo "=== Local build finished ==="
echo ""
echo "Deploy on the server (SSH key auth recommended). Example:"
echo ""
echo "  export DEPLOY_HOST=root@YOUR_HOST"
echo "  export DEPLOY_SSH_PORT=22   # or your SSH port"
echo "  ssh -p \"\$DEPLOY_SSH_PORT\" \"\$DEPLOY_HOST\" \\"
echo "    'cd ${REMOTE_DIR} && git fetch origin && git checkout YOUR_BRANCH && git pull && pnpm install && pnpm build && pnpm ui:build && (openclaw gateway restart || true)'"
echo ""
if [[ -n "$SERVER" ]]; then
  BRANCH="${DEPLOY_GIT_BRANCH:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)}"
  echo "With DEPLOY_HOST set, one-liner:"
  echo "  ssh -p ${PORT} ${SERVER} 'cd ${REMOTE_DIR} && git fetch origin && git checkout ${BRANCH} && git pull && pnpm install && pnpm build && pnpm ui:build'"
  echo ""
fi
echo "Ensure the server repo is cloned, branch tracks origin, and gateway restart matches your install (systemd, pm2, etc.)."
echo "=== Done ==="
