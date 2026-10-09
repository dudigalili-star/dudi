#!/usr/bin/env bash
# Short alias for the bot installer, easy to type on a tablet:
#   curl -fsSL dudigalili-star.github.io/dudi/i.sh | sudo bash
#   curl -fsSL dudigalili-star.github.io/dudi/i.sh | sudo bash -s -- --users 12345678
set -euo pipefail
curl -fsSL https://raw.githubusercontent.com/dudigalili-star/dudi/main/bot/deploy/install.sh | bash -s -- "$@"
