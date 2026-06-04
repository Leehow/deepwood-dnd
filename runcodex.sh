#!/bin/bash

# runcodex.sh - Launch Codex with full sandbox access
# Usage: ./runcodex.sh

# Colors for output
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

echo -e "${GREEN}========================================${RESET}"
echo -e "${GREEN}  Launching Codex${RESET}"
echo -e "${GREEN}========================================${RESET}\n"

echo -e "${YELLOW}⚠️  Warning: Running with danger-full-access sandbox mode${RESET}"
echo -e "${YELLOW}   This grants full system access to the AI${RESET}\n"

# Check if codex is installed
if ! command -v codex &> /dev/null; then
    echo -e "${RED}Error: codex command not found${RESET}"
    echo -e "Please install codex first"
    exit 1
fi

# Launch codex with full sandbox access
echo -e "${GREEN}Starting codex...${RESET}\n"
codex --sandbox danger-full-access "$@"

# Exit code handling
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
    echo -e "\n${RED}Codex exited with code $EXIT_CODE${RESET}"
else
    echo -e "\n${GREEN}Codex session ended${RESET}"
fi

exit $EXIT_CODE
