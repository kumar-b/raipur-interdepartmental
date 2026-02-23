#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════
#  Raipur Interdepartmental Portal — Stop Script
#  Usage:  ./stop.sh [--clean] [--backup]
# ═══════════════════════════════════════════════════════
set -euo pipefail

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

# ── Detect compose command ─────────────────────────────
if docker compose version &>/dev/null; then
  COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE="docker-compose"
else
  err "Docker Compose not found."
  exit 1
fi

# ── Parse flags ────────────────────────────────────────
CLEAN=false
BACKUP=false

for arg in "$@"; do
  case "$arg" in
    --clean)
      CLEAN=true
      ;;
    --backup)
      BACKUP=true
      ;;
    --help|-h)
      echo "Usage: ./stop.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --backup   Backup database and uploads before stopping"
      echo "  --clean    Stop AND remove all containers, volumes, and images"
      echo "             WARNING: this deletes the database and uploaded files!"
      echo "  --help     Show this help"
      exit 0
      ;;
    *)
      err "Unknown option: $arg"
      echo "Run ./stop.sh --help for usage."
      exit 1
      ;;
  esac
done

echo -e "${BOLD}"
echo "╔═══════════════════════════════════════════════════╗"
echo "║   Raipur Interdepartmental Portal — Stopping     ║"
echo "╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"

# ═══════════════════════════════════════════════════════
# 1. Show current status
# ═══════════════════════════════════════════════════════
echo -e "${BOLD}Current container status:${NC}"
$COMPOSE ps 2>/dev/null || info "No containers found."
echo ""

# ═══════════════════════════════════════════════════════
# 2. Backup (optional)
# ═══════════════════════════════════════════════════════
if [ "$BACKUP" = true ]; then
  BACKUP_DIR="$PROJECT_DIR/backups/$(date +%Y%m%d_%H%M%S)"
  mkdir -p "$BACKUP_DIR"

  info "Creating backup at $BACKUP_DIR ..."

  # Database backup
  if docker inspect raipur-portal-app &>/dev/null; then
    docker cp raipur-portal-app:/app/backend/database/portal.db "$BACKUP_DIR/portal.db" 2>/dev/null && \
      log "Database backed up" || warn "Could not backup database (container may not be running)"
  fi

  # Uploads backup
  if docker inspect raipur-portal-app &>/dev/null; then
    docker cp raipur-portal-app:/app/backend/uploads "$BACKUP_DIR/uploads" 2>/dev/null && \
      log "Uploads backed up" || warn "Could not backup uploads"
  fi

  if [ -d "$BACKUP_DIR" ] && [ "$(ls -A "$BACKUP_DIR" 2>/dev/null)" ]; then
    log "Backup saved to: $BACKUP_DIR"
    BACKUP_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)
    info "Backup size: $BACKUP_SIZE"
  else
    warn "Backup directory is empty. Containers may not have been running."
  fi
  echo ""
fi

# ═══════════════════════════════════════════════════════
# 3. Stop containers
# ═══════════════════════════════════════════════════════
if [ "$CLEAN" = true ]; then
  echo -e "${RED}${BOLD}WARNING: This will delete all data (database + uploads).${NC}"
  read -rp "Are you sure? Type 'yes' to confirm: " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    info "Aborted. No changes made."
    exit 0
  fi

  echo ""
  info "Stopping containers and removing all data..."
  $COMPOSE down -v --rmi local --remove-orphans
  log "Containers stopped"
  log "Volumes removed"
  log "Local images removed"
else
  info "Stopping containers (data is preserved in Docker volumes)..."
  $COMPOSE down
  log "Containers stopped"
fi

# ═══════════════════════════════════════════════════════
# Done
# ═══════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║${NC}  ${GREEN}Portal stopped successfully.${NC}                      ${BOLD}║${NC}"
echo -e "${BOLD}╠═══════════════════════════════════════════════════╣${NC}"

if [ "$CLEAN" = true ]; then
echo -e "${BOLD}║${NC}  All data was ${RED}removed${NC}.                             ${BOLD}║${NC}"
echo -e "${BOLD}║${NC}  To redeploy: ${YELLOW}./startup.sh --seed${NC}                 ${BOLD}║${NC}"
else
echo -e "${BOLD}║${NC}  Data is ${GREEN}preserved${NC} in Docker volumes.              ${BOLD}║${NC}"
echo -e "${BOLD}║${NC}  To restart:  ${YELLOW}./startup.sh${NC}                        ${BOLD}║${NC}"
fi

echo -e "${BOLD}╚═══════════════════════════════════════════════════╝${NC}"
echo ""
