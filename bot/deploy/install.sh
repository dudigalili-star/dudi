#!/usr/bin/env bash
# One-command install / update of the Telegram parts bot on an Ubuntu server
# (made for an Oracle Cloud "Always Free" VM, works on any Ubuntu/Debian with systemd).
#
#   Install or update:   curl -fsSL https://raw.githubusercontent.com/dudigalili-star/dudi/main/bot/deploy/install.sh | sudo bash
#   Allow Telegram users: curl -fsSL dudigalili-star.github.io/dudi/i.sh | sudo bash -s -- --users 12345678
#   Logs:                 sudo journalctl -u parts-bot -f
#
# Secrets are asked for interactively (never on the command line) and stored in /etc/parts-bot.env (root only).
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/dudigalili-star/dudi.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/parts-bot}"
DATA_DIR="${DATA_DIR:-/var/lib/parts-bot}"
ENV_FILE="${ENV_FILE:-/etc/parts-bot.env}"
SERVICE="parts-bot"
RUN_USER="parts-bot"
SKIP_SYSTEM="${SKIP_SYSTEM:-}" # for testing: skip apt / users / systemd

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

USERS_ARG=""
RESET=""
while [ $# -gt 0 ]; do
  case "$1" in
    --users) USERS_ARG="${2:-}"; shift 2 ;;
    --reset) RESET=1; shift ;;
    *) die "unknown option $1" ;;
  esac
done

[ -n "$SKIP_SYSTEM" ] || [ "$(id -u)" -eq 0 ] || die "run with sudo"

# Read from the terminal even when the script itself comes from a pipe (curl | bash).
ask() { # ask VAR "prompt" [silent]
  local __v=""
  if (: </dev/tty) 2>/dev/null; then
    if [ "${3:-}" = silent ]; then read -r -s -p "$2" __v </dev/tty; echo >/dev/tty; else read -r -p "$2" __v </dev/tty; fi
  fi
  printf -v "$1" '%s' "$__v"
}

set_env() { # set_env KEY VALUE  (replace or append in ENV_FILE)
  local key="$1" val="$2" tmp
  tmp="$(mktemp)"
  if [ -f "$ENV_FILE" ]; then grep -v "^${key}=" "$ENV_FILE" > "$tmp" || true; fi
  printf '%s=%s\n' "$key" "$val" >> "$tmp"
  install -m 600 "$tmp" "$ENV_FILE"
  rm -f "$tmp"
}

# Pasting into a web terminal can add invisible characters (e.g. ESC[200~ ... ESC[201~): strip them.
clean() { printf '%s' "$1" | sed 's/\x1b\[[0-9;]*[~A-Za-z]//g; s/\^\[\[20[01]~//g; s/\[20[01]~//g' | tr -d '[:space:][:cntrl:]'; }

check_token() { # 0 if Telegram accepts the token
  [[ "$1" =~ ^[0-9]+:[A-Za-z0-9_-]{30,}$ ]] || return 1
  curl -fsS -m 15 "https://api.telegram.org/bot$1/getMe" 2>/dev/null | grep -q '"ok":true'
}

check_key() { # 0 if Anthropic accepts the key
  [[ "$1" =~ ^sk-ant-[A-Za-z0-9_-]+$ ]] || return 1
  curl -fsS -m 20 -o /dev/null https://api.anthropic.com/v1/models \
    -H "x-api-key: $1" -H "anthropic-version: 2023-06-01" 2>/dev/null
}

get_env() { [ -f "$ENV_FILE" ] && grep "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }

restart_service() {
  [ -n "$SKIP_SYSTEM" ] && return 0
  systemctl restart "$SERVICE"
}

# Quick path: only update the allowed users
if [ -n "$USERS_ARG" ] && [ -f "$ENV_FILE" ] && [ -d "$APP_DIR/bot" ]; then
  [[ "$USERS_ARG" =~ ^[0-9,\ ]+$ ]] || die "--users takes Telegram user IDs (digits, comma separated)"
  set_env ALLOWED_USERS "$USERS_ARG"
  restart_service
  say "Allowed users set to: $USERS_ARG — the bot restarted. Send it a photo!"
  exit 0
fi

if [ -z "$SKIP_SYSTEM" ]; then
  say "Installing system packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y git curl ca-certificates fonts-liberation

  # Finish any install that was interrupted (e.g. a dropped SSH connection)
  dpkg --configure -a || true

  if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
    say "Installing Node.js 22"
    # NodeSource may not support the newest Ubuntu yet; fall back to Ubuntu's own packages
    if curl -fsSL https://deb.nodesource.com/setup_22.x | bash -; then
      apt-get install -y nodejs || true
    fi
    command -v node >/dev/null || apt-get install -y nodejs
  fi
  # Ubuntu's nodejs package comes without npm
  command -v npm >/dev/null || apt-get install -y npm
  [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || die "Node.js 20+ is required (found $(node -v))"

  # Small VMs (1 GB) need some swap for npm install and the CAD engine
  mem_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
  if [ "$mem_kb" -lt 2000000 ] && ! swapon --show | grep -q .; then
    say "Adding 2 GB swap (small machine)"
    fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi

  id "$RUN_USER" >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$RUN_USER"
fi

say "Getting the code ($BRANCH)"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$APP_DIR" reset --hard FETCH_HEAD
else
  rm -rf "$APP_DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

say "Installing the bot's packages"
(cd "$APP_DIR/bot" && npm ci --omit=dev --no-audit --no-fund)

mkdir -p "$DATA_DIR"
[ -n "$SKIP_SYSTEM" ] || chown -R "$RUN_USER:$RUN_USER" "$DATA_DIR"

say "Settings"
# Ask again when requested (--reset) or when a saved value is not accepted any more
if [ -n "$RESET" ] || { [ -n "$(get_env TELEGRAM_BOT_TOKEN)" ] && ! check_token "$(get_env TELEGRAM_BOT_TOKEN)"; }; then
  [ -n "$RESET" ] || echo "The saved Telegram token is not accepted by Telegram - please enter it again."
  set_env TELEGRAM_BOT_TOKEN ""
fi
if [ -n "$RESET" ] || { [ -n "$(get_env ANTHROPIC_API_KEY)" ] && ! check_key "$(get_env ANTHROPIC_API_KEY)"; }; then
  [ -n "$RESET" ] || echo "The saved Anthropic API key is not accepted - please enter it again."
  set_env ANTHROPIC_API_KEY ""
fi
if [ -z "$(get_env TELEGRAM_BOT_TOKEN)" ]; then
  tok=""
  for try in 1 2 3; do
    ask raw "Telegram bot token (from @BotFather; nothing shows while pasting): " silent
    tok="$(clean "$raw")"
    if check_token "$tok"; then echo "  OK - Telegram accepted the token"; break; fi
    echo "  X - Telegram did not accept this token (${#tok} characters). Copy it again: @BotFather -> /mybots -> API Token."
    tok=""
  done
  [ -n "$tok" ] || die "no valid Telegram token"
  set_env TELEGRAM_BOT_TOKEN "$tok"
fi
if [ -z "$(get_env ANTHROPIC_API_KEY)" ]; then
  key=""
  for try in 1 2 3; do
    ask raw "Anthropic API key (sk-ant-...; nothing shows while pasting): " silent
    key="$(clean "$raw")"
    if check_key "$key"; then echo "  OK - Anthropic accepted the key"; break; fi
    echo "  X - Anthropic did not accept this key (${#key} characters). Create a new one at platform.claude.com/settings/keys."
    key=""
  done
  [ -n "$key" ] || die "no valid Anthropic API key"
  set_env ANTHROPIC_API_KEY "$key"
fi
if [ -n "$USERS_ARG" ]; then set_env ALLOWED_USERS "$USERS_ARG"; fi
[ -n "$(get_env DATA_DIR)" ] || set_env DATA_DIR "$DATA_DIR"
echo "Saved in $ENV_FILE (readable by root only)."

if [ -n "$SKIP_SYSTEM" ]; then
  say "Done (test mode, no service installed)"
  exit 0
fi

say "Installing the background service"
cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=Telegram bot: supplier drawings
After=network-online.target
Wants=network-online.target

[Service]
User=$RUN_USER
WorkingDirectory=$APP_DIR/bot
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) index.js
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"
sleep 4

if systemctl is-active --quiet "$SERVICE"; then
  say "The bot is running!"
  journalctl -u "$SERVICE" -n 5 --no-pager || true
  if [ -z "$(get_env ALLOWED_USERS)" ]; then
    cat <<'EOF'

Next: send your bot any message in Telegram. It will answer with your user number.
Then run (with your number instead of 12345678):

  curl -fsSL dudigalili-star.github.io/dudi/i.sh | sudo bash -s -- --users 12345678
EOF
  fi
else
  journalctl -u "$SERVICE" -n 30 --no-pager || true
  die "the bot did not start — see the log above"
fi
