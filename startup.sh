#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════
#  Raipur Interdepartmental Portal — Startup Script
#  Usage:  ./startup.sh [--seed] [--rebuild] [--self-signed]
# ═══════════════════════════════════════════════════════
set -euo pipefail

# ── Colours ────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

log()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
err()   { echo -e "${RED}[✗]${NC} $*"; }
info()  { echo -e "${CYAN}[i]${NC} $*"; }
header(){ echo -e "\n${BOLD}── $* ──${NC}"; }

# ── Parse flags ────────────────────────────────────────
SEED=false
REBUILD=false
SELF_SIGNED=false

for arg in "$@"; do
  case "$arg" in
    --seed)        SEED=true ;;
    --rebuild)     REBUILD=true ;;
    --self-signed) SELF_SIGNED=true ;;
    --help|-h)
      echo "Usage: ./startup.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --seed         Seed the database with demo data (first deploy only)"
      echo "  --rebuild      Force rebuild of Docker images"
      echo "  --self-signed  Generate a self-signed SSL cert (for testing)"
      echo "  --help, -h     Show this help"
      exit 0
      ;;
    *)
      err "Unknown option: $arg"
      echo "Run ./startup.sh --help for usage."
      exit 1
      ;;
  esac
done

echo -e "${BOLD}"
echo "╔═══════════════════════════════════════════════════╗"
echo "║   Raipur Interdepartmental Portal — Deploying    ║"
echo "╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"

# ═══════════════════════════════════════════════════════
# 1. Check prerequisites
# ═══════════════════════════════════════════════════════
header "Checking prerequisites"

if ! command -v docker &>/dev/null; then
  err "Docker is not installed. Install it from https://docs.docker.com/engine/install/"
  exit 1
fi
log "Docker found: $(docker --version)"

if docker compose version &>/dev/null; then
  COMPOSE="docker compose"
  log "Docker Compose found: $(docker compose version --short)"
elif command -v docker-compose &>/dev/null; then
  COMPOSE="docker-compose"
  log "docker-compose found: $(docker-compose --version)"
else
  err "Docker Compose is not installed."
  exit 1
fi

if ! docker info &>/dev/null; then
  err "Docker daemon is not running. Start it with:  sudo systemctl start docker"
  exit 1
fi
log "Docker daemon is running"

# ═══════════════════════════════════════════════════════
# 2. Environment file
# ═══════════════════════════════════════════════════════
header "Checking environment configuration"

ENV_FILE="$PROJECT_DIR/backend/.env"

if [ ! -f "$ENV_FILE" ]; then
  warn ".env file not found. Creating from template..."
  cp "$PROJECT_DIR/backend/.env.example" "$ENV_FILE"

  JWT_SECRET=$(openssl rand -hex 48 2>/dev/null || head -c 96 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 96)
  if [ -n "$JWT_SECRET" ]; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s/^JWT_SECRET=$/JWT_SECRET=$JWT_SECRET/" "$ENV_FILE"
    else
      sed -i "s/^JWT_SECRET=$/JWT_SECRET=$JWT_SECRET/" "$ENV_FILE"
    fi
    log "Generated JWT_SECRET automatically"
  else
    err "Could not generate JWT_SECRET. Please set it manually in backend/.env"
    exit 1
  fi

  log ".env created at backend/.env"
  info "Review and customise it:  nano backend/.env"
else
  log ".env file exists"
fi

# Validate JWT_SECRET is present
JWT_VAL=$(grep -E '^JWT_SECRET=' "$ENV_FILE" | cut -d'=' -f2-)
if [ -z "$JWT_VAL" ] || [ ${#JWT_VAL} -lt 32 ]; then
  err "JWT_SECRET in backend/.env is missing or too short (need 32+ chars)."
  err "Generate one:  openssl rand -hex 48"
  exit 1
fi
log "JWT_SECRET is set (${#JWT_VAL} chars)"

# ═══════════════════════════════════════════════════════
# 3. SSL certificates
# ═══════════════════════════════════════════════════════
header "Checking SSL certificates"

SSL_DIR="$PROJECT_DIR/nginx/ssl"
mkdir -p "$SSL_DIR"

if [ -f "$SSL_DIR/fullchain.pem" ] && [ -f "$SSL_DIR/privkey.pem" ]; then
  log "SSL certificates found"
  EXPIRY=$(openssl x509 -enddate -noout -in "$SSL_DIR/fullchain.pem" 2>/dev/null | cut -d= -f2 || echo "unknown")
  info "Certificate expires: $EXPIRY"
elif [ "$SELF_SIGNED" = true ]; then
  warn "Generating self-signed certificate (for testing only)..."
  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "$SSL_DIR/privkey.pem" \
    -out "$SSL_DIR/fullchain.pem" \
    -subj "/CN=localhost/O=Raipur Portal/C=IN" \
    2>/dev/null
  log "Self-signed certificate generated (valid 365 days)"
  warn "Browsers will show a security warning. Use a real cert for production."
else
  err "SSL certificates not found in nginx/ssl/"
  echo ""
  info "You have two options:"
  echo ""
  echo "  ${BOLD}Option 1: Self-signed (testing)${NC}"
  echo "    ./startup.sh --self-signed"
  echo ""
  echo "  ${BOLD}Option 2: Let's Encrypt (production)${NC}"
  echo "    sudo certbot certonly --standalone -d your-domain.gov.in"
  echo "    cp /etc/letsencrypt/live/your-domain.gov.in/fullchain.pem nginx/ssl/"
  echo "    cp /etc/letsencrypt/live/your-domain.gov.in/privkey.pem nginx/ssl/"
  echo "    ./startup.sh"
  echo ""
  exit 1
fi

# ═══════════════════════════════════════════════════════
# 4. Build and start containers
# ═══════════════════════════════════════════════════════
header "Building and starting containers"

BUILD_FLAG=""
if [ "$REBUILD" = true ]; then
  BUILD_FLAG="--build --force-recreate"
  info "Forcing full rebuild..."
else
  BUILD_FLAG="--build"
fi

$COMPOSE up -d $BUILD_FLAG

echo ""
log "Waiting for containers to become healthy..."
sleep 5

# Check container status
APP_STATUS=$(docker inspect --format='{{.State.Status}}' raipur-portal-app 2>/dev/null || echo "not found")
NGINX_STATUS=$(docker inspect --format='{{.State.Status}}' raipur-portal-nginx 2>/dev/null || echo "not found")

if [ "$APP_STATUS" = "running" ]; then
  log "App container:   running"
else
  err "App container:   $APP_STATUS"
  err "Check logs:  $COMPOSE logs app"
  exit 1
fi

if [ "$NGINX_STATUS" = "running" ]; then
  log "Nginx container: running"
else
  err "Nginx container: $NGINX_STATUS"
  err "Check logs:  $COMPOSE logs nginx"
  exit 1
fi

# ═══════════════════════════════════════════════════════
# 5. Seed database (optional, first deploy only)
# ═══════════════════════════════════════════════════════
if [ "$SEED" = true ]; then
  header "Seeding database"
  warn "Running seed in development mode (will refuse if NODE_ENV=production inside container)..."
  $COMPOSE exec -e NODE_ENV=development app node backend/database/seed.js || {
    err "Seed failed. Check the output above."
    info "You can seed manually later:  $COMPOSE exec -e NODE_ENV=development app node backend/database/seed.js"
  }
fi

# ═══════════════════════════════════════════════════════
# 6. Health check
# ═══════════════════════════════════════════════════════
header "Running health check"

sleep 3
HTTP_CODE=$(curl -sk -o /dev/null -w "%{http_code}" https://localhost/api/departments 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
  log "Health check passed (HTTPS → 200 OK)"
elif [ "$HTTP_CODE" = "000" ]; then
  warn "Could not reach HTTPS endpoint (curl returned 000)"
  info "This may be normal if you're using a self-signed cert"
  HTTP_PLAIN=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/api/departments 2>/dev/null || echo "000")
  if [ "$HTTP_PLAIN" = "301" ]; then
    log "HTTP → HTTPS redirect working (301)"
  fi
else
  warn "Health check returned HTTP $HTTP_CODE"
  info "Check logs:  $COMPOSE logs --tail 50"
fi

# ═══════════════════════════════════════════════════════
# Done
# ═══════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║${NC}  ${GREEN}Portal is UP and running!${NC}                        ${BOLD}║${NC}"
echo -e "${BOLD}╠═══════════════════════════════════════════════════╣${NC}"
echo -e "${BOLD}║${NC}                                                   ${BOLD}║${NC}"
echo -e "${BOLD}║${NC}  HTTPS : ${CYAN}https://localhost${NC}                       ${BOLD}║${NC}"
echo -e "${BOLD}║${NC}  HTTP  : ${CYAN}http://localhost${NC} (→ redirects to HTTPS)  ${BOLD}║${NC}"
echo -e "${BOLD}║${NC}                                                   ${BOLD}║${NC}"
echo -e "${BOLD}║${NC}  Logs  : ${YELLOW}docker compose logs -f${NC}                  ${BOLD}║${NC}"
echo -e "${BOLD}║${NC}  Stop  : ${YELLOW}./stop.sh${NC}                               ${BOLD}║${NC}"
echo -e "${BOLD}║${NC}  Status: ${YELLOW}docker compose ps${NC}                       ${BOLD}║${NC}"
echo -e "${BOLD}║${NC}                                                   ${BOLD}║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════╝${NC}"
echo ""

if [ "$SEED" = true ]; then
  info "Database was seeded. Default login:  admin / Admin@Portal2024!"
  warn "Change all passwords immediately via the admin panel."
fi
