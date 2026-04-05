#!/usr/bin/env bash
# One-click style deploy: local build, then SSH to server to pull, build, restart gateway.
# Usage: bash scripts/deploy-remote-production.sh
#
# Environment (optional):
#   SKIP_LOCAL_BUILD=1     — skip pnpm build / ui:build on this machine
#   DEPLOY_SSH_HOST        — default: 108.175.14.99
#   DEPLOY_SSH_PORT        — default: 21005
#   DEPLOY_SSH_USER        — default: root
#   DEPLOY_REMOTE_DIR      — default: /opt/openclaw
#   DEPLOY_GIT_BRANCH      — default: current local branch name
#
# You will be prompted for the SSH password unless you use an SSH key.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEPLOY_SSH_HOST="${DEPLOY_SSH_HOST:-108.175.14.99}"
DEPLOY_SSH_PORT="${DEPLOY_SSH_PORT:-21005}"
DEPLOY_SSH_USER="${DEPLOY_SSH_USER:-root}"
DEPLOY_REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/opt/openclaw}"
BRANCH="${DEPLOY_GIT_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
REMOTE="${DEPLOY_SSH_USER}@${DEPLOY_SSH_HOST}"

echo "=========================================="
echo "  OpenClaw production deploy"
echo "=========================================="
echo "  Local repo:  $ROOT"
echo "  Branch:      $BRANCH"
echo "  SSH:         ssh -p $DEPLOY_SSH_PORT $REMOTE"
echo "  Remote dir:  $DEPLOY_REMOTE_DIR"
echo ""
echo "  Push this branch to origin before continuing if the server should pull new commits:"
echo "    git push origin $BRANCH"
echo "=========================================="
echo ""

if [[ "${SKIP_LOCAL_BUILD:-0}" != "1" ]]; then
  echo ">>> Local: pnpm build && pnpm ui:build"
  pnpm build
  pnpm ui:build
  echo ""
else
  echo ">>> Skipping local build (SKIP_LOCAL_BUILD=1)"
  echo ""
fi

echo ">>> Remote: git pull, install, build, openclaw gateway restart"
echo "    (enter SSH password when prompted)"
echo ""

# shellcheck disable=SC2029
ssh -p "$DEPLOY_SSH_PORT" -o StrictHostKeyChecking=accept-new -t "$REMOTE" \
  "set -euo pipefail
cd $(printf '%q' "$DEPLOY_REMOTE_DIR")
git fetch origin
git checkout $(printf '%q' "$BRANCH")
git pull origin $(printf '%q' "$BRANCH")
pnpm install
pnpm build
pnpm ui:build
openclaw gateway restart"

echo ""
echo ">>> Done."
