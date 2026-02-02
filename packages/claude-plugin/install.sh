#!/bin/bash
#
# GateFlow Plugin Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/your-org/gateflow-cli/main/packages/claude-plugin/install.sh | bash
#

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                                                                  ║${NC}"
echo -e "${BLUE}║   ${GREEN}GateFlow${BLUE} - AI-Powered SystemVerilog Development              ║${NC}"
echo -e "${BLUE}║                                                                  ║${NC}"
echo -e "${BLUE}║   Verification Engineer & RTL Developer Personas                ║${NC}"
echo -e "${BLUE}║   ASCII Waveform Visualization · Automated Lint Workflows       ║${NC}"
echo -e "${BLUE}║                                                                  ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check for required tools
check_command() {
    if command -v "$1" &> /dev/null; then
        echo -e "  ${GREEN}✓${NC} $1 found"
        return 0
    else
        echo -e "  ${RED}✗${NC} $1 not found"
        return 1
    fi
}

echo -e "${YELLOW}Checking prerequisites...${NC}"
echo ""

MISSING_TOOLS=()

# Check Node.js
if ! check_command node; then
    MISSING_TOOLS+=("node")
fi

# Check npm
if ! check_command npm; then
    MISSING_TOOLS+=("npm")
fi

# Check Claude Code
if ! check_command claude; then
    echo -e "  ${YELLOW}⚠${NC} Claude Code CLI not found in PATH"
    echo "    Install from: https://claude.ai/claude-code"
fi

# Optional: Check Verilator
if check_command verilator; then
    VERILATOR_VERSION=$(verilator --version 2>/dev/null | head -1)
    echo -e "    Version: $VERILATOR_VERSION"
else
    echo -e "  ${YELLOW}⚠${NC} Verilator not found (optional, install with: brew install verilator)"
fi

# Install missing tools
if [ ${#MISSING_TOOLS[@]} -gt 0 ]; then
    echo ""
    echo -e "${RED}Missing required tools: ${MISSING_TOOLS[*]}${NC}"

    if command -v brew &> /dev/null; then
        echo -e "${YELLOW}Installing via Homebrew...${NC}"
        for tool in "${MISSING_TOOLS[@]}"; do
            case $tool in
                node|npm) brew install node ;;
            esac
        done
    else
        echo -e "${RED}Please install Node.js manually: https://nodejs.org${NC}"
        exit 1
    fi
fi

echo ""
echo -e "${YELLOW}Installing GateFlow Plugin...${NC}"
echo ""

# Determine install locations
GATEFLOW_CLI_DIR="${HOME}/.gateflow/cli"
PLUGIN_DIR="${HOME}/.claude/plugins/gateflow"

# Clone or update gateflow-cli
if [ -d "$GATEFLOW_CLI_DIR" ]; then
    echo "Updating GateFlow CLI..."
    cd "$GATEFLOW_CLI_DIR"
    git pull --quiet
else
    echo "Cloning GateFlow CLI..."
    mkdir -p "$(dirname "$GATEFLOW_CLI_DIR")"
    git clone --quiet https://github.com/your-org/gateflow-cli.git "$GATEFLOW_CLI_DIR"
    cd "$GATEFLOW_CLI_DIR"
fi

# Build the CLI (includes MCP server)
echo "Building GateFlow (this may take a moment)..."
npm install --silent 2>/dev/null
npm run build --silent 2>/dev/null

# Install the plugin
echo "Installing Claude Code plugin..."
mkdir -p "$(dirname "$PLUGIN_DIR")"

if [ -d "$PLUGIN_DIR" ]; then
    rm -rf "$PLUGIN_DIR"
fi

cp -r "$GATEFLOW_CLI_DIR/packages/claude-plugin" "$PLUGIN_DIR"

# Create environment config
echo "Configuring plugin..."
cat > "$PLUGIN_DIR/.env" << EOF
GATEFLOW_CLI_PATH=$GATEFLOW_CLI_DIR
EOF

# Update plugin.json with correct path
if command -v sed &> /dev/null; then
    sed -i.bak "s|\${GATEFLOW_CLI_PATH}|$GATEFLOW_CLI_DIR|g" "$PLUGIN_DIR/.claude-plugin/plugin.json" 2>/dev/null || true
    rm -f "$PLUGIN_DIR/.claude-plugin/plugin.json.bak" 2>/dev/null || true
fi

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Installation Complete!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  GateFlow CLI:    ${BLUE}$GATEFLOW_CLI_DIR${NC}"
echo -e "  Claude Plugin:   ${BLUE}$PLUGIN_DIR${NC}"
echo ""
echo -e "${YELLOW}To enable GateFlow in Claude Code:${NC}"
echo ""
echo "  Option 1: Add to ~/.claude/settings.json:"
echo ""
echo '    {'
echo '      "enabledPlugins": {'
echo "        \"gateflow\": true"
echo '      }'
echo '    }'
echo ""
echo "  Option 2: Run with plugin flag:"
echo ""
echo -e "    ${BLUE}claude --plugin-dir $PLUGIN_DIR${NC}"
echo ""
echo -e "${YELLOW}Quick Start Commands:${NC}"
echo ""
echo "  /gf-setup     - First-time setup and tool installation"
echo "  /gf-map       - Map your codebase architecture"
echo "  /gf-plan      - Plan a complex task with AI"
echo ""
echo "  Or just describe what you want to build in plain English!"
echo ""
echo -e "${GREEN}Made with ♥ for Hardware Engineers${NC}"
echo ""
