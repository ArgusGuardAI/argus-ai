#!/bin/bash
# =============================================================================
# Argus Agent VPS Setup Script
# Target: Ubuntu 22.04/24.04 on Hetzner/Vultr/DigitalOcean
# VPS IP: 46.XXX.X.XXX
# =============================================================================

set -e  # Exit on error

echo "=========================================="
echo "  ARGUS AGENT SYSTEM - VPS SETUP"
echo "=========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# -----------------------------------------------------------------------------
# 1. System Update
# -----------------------------------------------------------------------------
echo -e "${YELLOW}[1/8] Updating system...${NC}"
apt update && apt upgrade -y
apt install -y curl git build-essential

# -----------------------------------------------------------------------------
# 2. Install Node.js 20 LTS
# -----------------------------------------------------------------------------
echo -e "${YELLOW}[2/8] Installing Node.js 20 LTS...${NC}"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node --version
npm --version

# -----------------------------------------------------------------------------
# 3. Install pnpm & PM2
# -----------------------------------------------------------------------------
echo -e "${YELLOW}[3/8] Installing pnpm and PM2...${NC}"
npm install -g pnpm pm2

# -----------------------------------------------------------------------------
# 4. Install PostgreSQL
# -----------------------------------------------------------------------------
echo -e "${YELLOW}[4/8] Installing PostgreSQL...${NC}"
apt install -y postgresql postgresql-contrib

# Start and enable PostgreSQL
systemctl start postgresql
systemctl enable postgresql

# Create argus database and user
sudo -u postgres psql <<EOF
CREATE USER argus WITH PASSWORD 'CHANGE_THIS_PASSWORD';
CREATE DATABASE argus_agents OWNER argus;
GRANT ALL PRIVILEGES ON DATABASE argus_agents TO argus;
EOF

echo -e "${GREEN}PostgreSQL installed. Database: argus_agents, User: argus${NC}"

# -----------------------------------------------------------------------------
# 5. Create Directory Structure
# -----------------------------------------------------------------------------
echo -e "${YELLOW}[5/8] Creating directory structure...${NC}"
mkdir -p /opt/argus-agents
mkdir -p /opt/argus-agents/logs
mkdir -p /opt/argus-agents/data
mkdir -p /var/log/argus

# -----------------------------------------------------------------------------
# 6. Create Environment File Template
# -----------------------------------------------------------------------------
echo -e "${YELLOW}[6/8] Creating environment file...${NC}"
cat > /opt/argus-agents/.env <<'ENVFILE'
# ===========================================
# ARGUS AGENT SYSTEM - ENVIRONMENT CONFIG
# ===========================================

# Node environment
NODE_ENV=production

# ===========================================
# RPC Configuration (YOUR INFRASTRUCTURE)
# ===========================================
# Pruned node (update IP when sync completes)
RPC_ENDPOINT=http://PRUNED_NODE_IP:8899
RPC_WS_ENDPOINT=ws://PRUNED_NODE_IP:8900

# ===========================================
# Yellowstone gRPC (Real-time streaming)
# ===========================================
YELLOWSTONE_ENDPOINT=YELLOWSTONE_VPS_IP:10000

# ===========================================
# PostgreSQL (Local on this VPS)
# ===========================================
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=argus
POSTGRES_PASSWORD=CHANGE_THIS_PASSWORD
POSTGRES_DB=argus_agents
DATABASE_URL=postgresql://argus:CHANGE_THIS_PASSWORD@localhost:5432/argus_agents

# ===========================================
# Agent Configuration
# ===========================================
ENABLE_TRADING=false
SCOUT_COUNT=2
ANALYST_COUNT=1
HUNTER_COUNT=1
TRADER_COUNT=1

# Trading limits (when enabled)
MAX_DAILY_TRADES=10
MAX_POSITION_SIZE=0.1

# ===========================================
# Logging
# ===========================================
LOG_LEVEL=info
LOG_DIR=/var/log/argus
ENVFILE

echo -e "${GREEN}Environment file created at /opt/argus-agents/.env${NC}"
echo -e "${RED}IMPORTANT: Update the passwords and IPs in .env!${NC}"

# -----------------------------------------------------------------------------
# 7. Create PM2 Ecosystem File
# -----------------------------------------------------------------------------
echo -e "${YELLOW}[7/8] Creating PM2 ecosystem config...${NC}"
cat > /opt/argus-agents/ecosystem.config.js <<'PM2CONFIG'
module.exports = {
  apps: [
    {
      name: 'argus-coordinator',
      script: 'dist/start.js',
      cwd: '/opt/argus-agents',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production'
      },
      env_file: '/opt/argus-agents/.env',

      // Logging
      log_file: '/var/log/argus/combined.log',
      out_file: '/var/log/argus/out.log',
      error_file: '/var/log/argus/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Restart policy
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '1G',

      // Auto-restart on file change (disable in prod)
      watch: false,

      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000
    }
  ]
};
PM2CONFIG

echo -e "${GREEN}PM2 config created at /opt/argus-agents/ecosystem.config.js${NC}"

# -----------------------------------------------------------------------------
# 8. Create Systemd Service (auto-start on boot)
# -----------------------------------------------------------------------------
echo -e "${YELLOW}[8/8] Creating systemd service...${NC}"
cat > /etc/systemd/system/argus-agents.service <<'SYSTEMD'
[Unit]
Description=Argus AI Agent System
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=forking
User=root
WorkingDirectory=/opt/argus-agents
Environment=PM2_HOME=/root/.pm2
ExecStart=/usr/bin/pm2 start /opt/argus-agents/ecosystem.config.js
ExecReload=/usr/bin/pm2 reload all
ExecStop=/usr/bin/pm2 stop all
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
SYSTEMD

systemctl daemon-reload
systemctl enable argus-agents

echo -e "${GREEN}Systemd service created and enabled${NC}"

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "=========================================="
echo -e "${GREEN}  SETUP COMPLETE!${NC}"
echo "=========================================="
echo ""
echo "Directory:     /opt/argus-agents"
echo "Env file:      /opt/argus-agents/.env"
echo "PM2 config:    /opt/argus-agents/ecosystem.config.js"
echo "Logs:          /var/log/argus/"
echo ""
echo "PostgreSQL:"
echo "  Database:    argus_agents"
echo "  User:        argus"
echo "  Password:    CHANGE_THIS_PASSWORD (update in .env!)"
echo ""
echo -e "${YELLOW}NEXT STEPS:${NC}"
echo "1. Upload agent code to /opt/argus-agents/"
echo "2. Edit /opt/argus-agents/.env with correct IPs"
echo "3. cd /opt/argus-agents && pnpm install"
echo "4. pnpm build"
echo "5. pm2 start ecosystem.config.js"
echo ""
echo "Commands:"
echo "  pm2 status           # Check agent status"
echo "  pm2 logs             # View logs"
echo "  pm2 restart all      # Restart agents"
echo "  systemctl status argus-agents  # Check service"
echo ""
