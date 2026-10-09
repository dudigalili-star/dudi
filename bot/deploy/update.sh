#!/usr/bin/env bash
# Pulls the latest version of the bot from GitHub and restarts it.
# If the new version does not start, it goes back to the previous one.
#
# Run by systemd (units written by install.sh):
#   parts-bot-update.timer  - every night
#   parts-bot-update.path   - when the bot's /update command creates $DATA_DIR/update-request
#
# Everything is inside main() so bash has read the whole script before `git reset` replaces this file.
set -euo pipefail

main() {
  APP_DIR="${APP_DIR:-/opt/parts-bot}"
  DATA_DIR="${DATA_DIR:-/var/lib/parts-bot}"
  SERVICE="${SERVICE:-parts-bot}"
  RUN_USER="${RUN_USER:-parts-bot}"
  BRANCH="${BRANCH:-main}"
  local req="$DATA_DIR/update-request" note="$DATA_DIR/update-notify" requested=""

  # A request from Telegram: remember who asked, so the bot can report back after the restart
  if [ -f "$req" ]; then
    mv -f "$req" "$note"
    chown "$RUN_USER:$RUN_USER" "$note" 2>/dev/null || true
    requested=1
  fi

  cd "$APP_DIR"
  local old new
  old="$(git rev-parse HEAD)"
  git fetch --depth 1 origin "$BRANCH"
  new="$(git rev-parse FETCH_HEAD)"

  if [ "$old" = "$new" ]; then
    echo "Already up to date (${old:0:7})"
    if [ -n "$requested" ]; then systemctl restart "$SERVICE"; fi
    return 0
  fi

  echo "Updating ${old:0:7} -> ${new:0:7}"
  local installer_changed=""
  git diff --quiet "$old" "$new" -- bot/deploy/install.sh || installer_changed=1
  git reset --hard "$new"

  if [ -n "$installer_changed" ]; then
    # The server setup changed: re-run the installer. It keeps the saved settings and asks nothing.
    APP_DIR="$APP_DIR" DATA_DIR="$DATA_DIR" BRANCH="$BRANCH" bash bot/deploy/install.sh </dev/null || { rollback "$old"; return 0; }
  else
    (cd bot && npm ci --omit=dev --no-audit --no-fund) || { rollback "$old"; return 0; }
    systemctl restart "$SERVICE"
  fi

  sleep "${CHECK_DELAY:-15}"
  if systemctl is-active --quiet "$SERVICE"; then
    echo "Updated to ${new:0:7}"
  else
    rollback "$old"
  fi
}

rollback() {
  echo "The new version did not start - going back to ${1:0:7}"
  cd "$APP_DIR"
  git reset --hard "$1"
  (cd bot && npm ci --omit=dev --no-audit --no-fund) || true
  echo "$1" > "$DATA_DIR/update-failed"
  chown "$RUN_USER:$RUN_USER" "$DATA_DIR/update-failed" 2>/dev/null || true
  systemctl restart "$SERVICE"
}

main "$@"
