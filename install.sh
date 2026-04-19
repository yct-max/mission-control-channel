#!/usr/bin/env bash
# install.sh — Mission Control channel plugin for OpenClaw
# Usage:
#   curl -LsSf https://github.com/yct-max/mission-control-channel/releases/latest/download/install.sh | sh
#   curl -LsSf https://github.com/yct-max/mission-control-channel/releases/latest/download/install.sh | sh -s -- --version 0.2.0
#   curl -LsSf https://github.com/yct-max/mission-control-channel/releases/latest/download/install.sh | sh -s -- --mc-url http://100.78.2.112:18793 --agent-token mc_xxx --restart
#
set -euo pipefail

REPO="yct-max/mission-control-channel"
INSTALL_DIR="$HOME/.openclaw/plugins/mission-control"
OPENCLAW_CONFIG="$HOME/.openclaw/openclaw.json"

# ── Helpers ──────────────────────────────────────────────────────────────────

info()  { echo "[mission-control] $*" >&2; }
warn()  { echo "[mission-control] WARNING: $*" >&2; }
error() { echo "[mission-control] ERROR: $*" >&2; exit 1; }

usage() {
  cat <<EOF >&2
Usage: curl -LsSf <url> | sh [options]
       curl -LsSf <url> | sh -s -- [options]

Options:
  --version <ver>      Install specific version (default: latest)
  --install-dir <path> Override install directory (default: ~/.openclaw/plugins/mission-control)
  --mc-url <url>       Set MC base URL in plugin config (e.g. http://100.78.2.112:18793)
  --agent-token <token> Set agent integration token (mc_xxx...)
  --gateway-port <port> Gateway port to restart (default: auto-detect from config)
  --restart            Restart gateway after install
  --update             Update existing installation to latest (or --version)
  --yes                Skip confirmation prompts
  -h, --help           Show this help

Examples:
  # Install latest
  curl -LsSf https://github.com/yct-max/mission-control-channel/releases/latest/download/install.sh | sh

  # Install specific version
  curl -LsSf https://github.com/yct-max/mission-control-channel/releases/latest/download/install.sh | sh -s -- --version 0.2.0

  # Install + configure + restart
  curl -LsSf https://github.com/yct-max/mission-control-channel/releases/latest/download/install.sh | sh -s -- \\
    --mc-url http://100.78.2.112:18793 \\
    --agent-token mc_xxx \\
    --restart

  # Update existing installation
  curl -LsSf https://github.com/yct-max/mission-control-channel/releases/latest/download/install.sh | sh -s -- --update --restart
EOF
}

# ── Platform detection ────────────────────────────────────────────────────────

detect_platform() {
  case "$(uname -s)" in
    Linux)  echo "linux";;
    Darwin) echo "darwin";;
    *)      error "Unsupported platform: $(uname -s)";;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64)  echo "x64";;
    aarch64|arm64) echo "arm64";;
    armv7l)        echo "armv7l";;
    *)             error "Unsupported architecture: $(uname -m)";;
  esac
}

# ── Version resolution ────────────────────────────────────────────────────────

latest_version() {
  curl -sL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep '"tag_name"' \
    | sed -E 's/.*"tag_name":\s*"v?([^"]+)".*/\1/' \
    | head -1
}

# ── Download ──────────────────────────────────────────────────────────────────

download() {
  local version=$1
  local platform=$2
  local arch=$3
  local artifact="mission-control-${platform}-${arch}.tar.gz"
  local url="https://github.com/${REPO}/releases/download/v${version}/${artifact}"

  info "Downloading ${artifact}..."
  if ! curl -L --fail -o "$TMPDIR/${artifact}" "$url" 2>/dev/null; then
    # Fallback: try generic (no platform suffix) for platforms not separately packaged
    local fallback_url="https://github.com/${REPO}/releases/download/v${version}/mission-control-channel.tar.gz"
    info "Platform-specific artifact not found, trying generic..."
    curl -L --fail -o "$TMPDIR/${artifact}" "$fallback_url" 2>/dev/null \
      || error "Failed to download ${artifact} — check version ${version} exists"
  fi
  echo "$TMPDIR/${artifact}"
}

# ── Extract ──────────────────────────────────────────────────────────────────

extract() {
  local archive=$1
  local dest=$2
  mkdir -p "$dest"
  tar -xzf "$archive" -C "$dest" --strip-components=1 \
    || error "Failed to extract archive"
  info "Installed to ${dest}"
}

# ── Config patching ──────────────────────────────────────────────────────────

patch_openclaw_config() {
  local mc_url=${1:-}
  local agent_token=${2:-}
  local gateway_port=${3:-}

  if [[ ! -f "$OPENCLAW_CONFIG" ]]; then
    warn "OpenClaw config not found at ${OPENCLAW_CONFIG} — skipping config patch"
    return 0
  fi

  # Backup
  cp "$OPENCLAW_CONFIG" "${OPENCLAW_CONFIG}.bak"
  info "Backed up config to ${OPENCLAW_CONFIG}.bak"

  # Use python3 for robust JSON patching
  python3 - <<'PYEOF'
import json, sys, os

config_path = os.environ['OPENCLAW_CONFIG']
mc_url = os.environ.get('MC_URL', '')
agent_token = os.environ.get('AGENT_TOKEN', '')
gateway_port = os.environ.get('GATEWAY_PORT', '')

with open(config_path, 'r') as f:
    cfg = json.load(f)

# Ensure plugins section exists
if 'plugins' not in cfg:
    cfg['plugins'] = {}
if 'entries' not in cfg['plugins']:
    cfg['plugins']['entries'] = {}
if 'load' not in cfg['plugins']:
    cfg['plugins']['load'] = {}
if 'paths' not in cfg['plugins']['load']:
    cfg['plugins']['load']['paths'] = []

# Add plugin path if not present
plugin_path = os.path.expanduser('~/.openclaw/plugins/mission-control')
if plugin_path not in cfg['plugins']['load']['paths']:
    cfg['plugins']['load']['paths'].append(plugin_path)

# Patch mission-control entry
cfg['plugins']['entries']['mission-control'] = {
    'enabled': True,
    'config': {
        'mcUrl': mc_url or cfg['plugins']['entries'].get('mission-control', {}).get('config', {}).get('mcUrl', ''),
        'agentToken': agent_token or cfg['plugins']['entries'].get('mission-control', {}).get('config', {}).get('agentToken', ''),
    }
}

# Optionally update gateway.bind to lan (for remote MC connectivity)
if 'gateway' not in cfg:
    cfg['gateway'] = {}
if cfg['gateway'].get('bind') == 'loopback':
    cfg['gateway']['bind'] = 'lan'
    info("Changed gateway.bind from loopback to lan for remote webhook connectivity")

with open(config_path, 'w') as f:
    json.dump(cfg, f, indent=2)

print("Config patched successfully")
PYEOF

  info "Config patched — ${OPENCLAW_CONFIG}"
}

# ── Gateway restart ───────────────────────────────────────────────────────────

restart_gateway() {
  local port=${1:-}
  if [[ -z "$port" ]]; then
    port=$(python3 -c "import json; cfg=json.load(open('$OPENCLAW_CONFIG')); print(cfg.get('gateway',{}).get('port','18789'))" 2>/dev/null || echo "18789")
  fi
  info "Restarting OpenClaw gateway on port ${port}..."

  # Try openclaw gateway restart first
  if command -v openclaw &>/dev/null; then
    openclaw gateway restart 2>/dev/null && info "Gateway restarted via openclaw CLI" && return 0
  fi

  # Fallback: kill and restart via launchctl/systemd
  case "$(uname -s)" in
    Darwin)
      if grep -q "ai.mission-control" ~/Library/LaunchAgents/*.plist 2>/dev/null; then
        launchctl unload ~/Library/LaunchAgents/ai.mission-control.plist 2>/dev/null || true
        launchctl load ~/Library/LaunchAgents/ai.mission-control.plist 2>/dev/null
        info "Gateway restarted via launchctl"
      else
        pkill -f "openclaw-gateway" 2>/dev/null || true
        sleep 2
        (openclaw gateway start &) 2>/dev/null || warn "Could not restart gateway — please restart manually"
        info "Gateway restart attempted"
      fi
      ;;
    Linux)
      systemctl --user restart openclaw 2>/dev/null \
        || (pkill -f "openclaw-gateway" 2>/dev/null || true; sleep 2; openclaw gateway start &) 2>/dev/null \
        || warn "Could not restart gateway — please restart manually"
      info "Gateway restart attempted"
      ;;
  esac
}

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
  local version=""
  local platform
  local arch
  local do_config=false
  local do_restart=false
  local do_update=false
  local do_yes=false
  local mc_url=""
  local agent_token=""
  local gateway_port=""
  local install_dir="${INSTALL_DIR}"

  platform=$(detect_platform)
  arch=$(detect_arch)

  # Parse args
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --version)       version="$2"; shift 2;;
      --install-dir)   install_dir="$2"; shift 2;;
      --mc-url)        mc_url="$2"; do_config=true; shift 2;;
      --agent-token)   agent_token="$2"; do_config=true; shift 2;;
      --gateway-port)  gateway_port="$2"; shift 2;;
      --restart)       do_restart=true; shift;;
      --update)        do_update=true; shift;;
      --yes|-y)        do_yes=true; shift;;
      -h|--help)      usage; exit 0;;
      --)              shift; break;;
      -*)              error "Unknown option: $1";;
      *)               break;;
    esac
  done

  # Resolve version
  if [[ -z "$version" ]]; then
    version=$(latest_version)
    [[ -z "$version" ]] && error "Could not determine latest version"
  fi
  info "Installing mission-control plugin v${version} (${platform}/${arch})"

  # Pre-install check
  if [[ -d "$install_dir" ]] && [[ "$do_update" == "false" ]] && [[ "$do_yes" == "false" ]]; then
    read -p "[mission-control] $install_dir already exists. Update? [y/N] " ans < /dev/tty || ans="N"
    [[ "${ans:-N}" =~ ^[Yy]$ ]] || { info "Aborted"; exit 0; }
  fi

  TMPDIR=$(mktemp -d)
  trap "rm -rf $TMPDIR" EXIT

  # Download
  local archive
  archive=$(download "$version" "$platform" "$arch")

  # Extract
  extract "$archive" "$install_dir"

  # Config patch
  if [[ "$do_config" == "true" ]]; then
    MC_URL="$mc_url" AGENT_TOKEN="$agent_token" GATEWAY_PORT="$gateway_port" \
      patch_openclaw_config "$mc_url" "$agent_token" "$gateway_port"
  fi

  # Restart
  if [[ "$do_restart" == "true" ]]; then
    restart_gateway "$gateway_port"
  fi

  info "Done! Installed mission-control ${version} to ${install_dir}"
  [[ "$do_restart" == "false" ]] && info "Run with --restart to restart the gateway"
}

main "$@"
