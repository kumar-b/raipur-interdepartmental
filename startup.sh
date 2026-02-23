#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════
#  Raipur Interdepartmental Portal — Startup Script
#  Usage:  ./startup.sh [--seed] [--rebuild]
# ═══════════════════════════════════════════════════════
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

APP_PORT=5002

log()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
err()   { echo -e "${RED}[✗]${NC} $*"; }
info()  { echo -e "${CYAN}[i]${NC} $*"; }

SEED=false
REBUILD=false

for arg in "$@"; do
  case "$arg" in
    --seed)    SEED=true ;;
    --rebuild) REBUILD=true ;;
    --help|-h)
      echo "Usage: ./startup.sh [--seed] [--rebuild]"
      echo "  --seed     Seed database with demo data (first deploy)"
      echo "  --rebuild  Force full Docker image rebuild"
      exit 0 ;;
    *) err "Unknown option: $arg"; exit 1 ;;
  esac
done

echo -e "\n${BOLD}══ Raipur Interdepartmental Portal ═══════════════${NC}\n"

# ── 1. Prerequisites ──────────────────────────────────
if ! command -v docker &>/dev/null; then err "Docker not installed."; exit 1; fi
log "Docker: $(docker --version | cut -d, -f1)"

if docker compose version &>/dev/null; then COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then COMPOSE="docker-compose"
else err "Docker Compose not found."; exit 1; fi
log "Compose: $($COMPOSE version --short 2>/dev/null || $COMPOSE --version)"

if ! docker info &>/dev/null; then err "Docker daemon not running."; exit 1; fi

if lsof -i :$APP_PORT -sTCP:LISTEN &>/dev/null; then
  err "Port $APP_PORT is already in use."; exit 1
fi
log "Port $APP_PORT is free"

# ── 2. Environment ────────────────────────────────────
ENV_FILE="$PROJECT_DIR/backend/.env"
if [ ! -f "$ENV_FILE" ]; then
  cp "$PROJECT_DIR/backend/.env.example" "$ENV_FILE"
  JWT_SECRET=$(openssl rand -hex 48)
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/^JWT_SECRET=$/JWT_SECRET=$JWT_SECRET/" "$ENV_FILE"
  else
    sed -i "s/^JWT_SECRET=$/JWT_SECRET=$JWT_SECRET/" "$ENV_FILE"
  fi
  log "Created .env with auto-generated JWT_SECRET"
else
  log ".env exists"
fi

JWT_VAL=$(grep -E '^JWT_SECRET=' "$ENV_FILE" | cut -d'=' -f2-)
if [ -z "$JWT_VAL" ] || [ ${#JWT_VAL} -lt 32 ]; then
  err "JWT_SECRET missing or too short (need 32+ chars)."; exit 1
fi
log "JWT_SECRET OK (${#JWT_VAL} chars)"

# ── 3. Build & Start ─────────────────────────────────
BUILD_FLAG="--build"
[ "$REBUILD" = true ] && BUILD_FLAG="--build --force-recreate"

$COMPOSE up -d $BUILD_FLAG
sleep 5

APP_STATUS=$(docker inspect --format='{{.State.Status}}' raipur-portal-app 2>/dev/null || echo "not found")
if [ "$APP_STATUS" = "running" ]; then
  log "Container running on port $APP_PORT"
else
  err "Container status: $APP_STATUS"; $COMPOSE logs --tail 20 app; exit 1
fi

# ── 4. Seed (optional) ───────────────────────────────
if [ "$SEED" = true ]; then
  warn "Seeding database..."
  $COMPOSE exec -e NODE_ENV=development app node backend/database/seed.js || warn "Seed failed."
fi

# ── 5. Health check ───────────────────────────────────
sleep 2
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$APP_PORT/api/departments 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  log "Health check passed (200 OK)"
else
  warn "Health check returned $HTTP_CODE — check logs"
fi

# ── Done ──────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}  Portal running at: http://localhost:${APP_PORT}${NC}"
echo -e "  Logs:  ${CYAN}docker compose logs -f${NC}"
echo -e "  Stop:  ${CYAN}./stop.sh${NC}"
echo ""

if [ "$SEED" = true ]; then
  info "Login:  admin / Admin@Portal2024!"
  warn "Change all passwords immediately."
fi
