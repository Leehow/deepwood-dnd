#!/bin/bash
# Optimized frontend build script for production deployment
# Removes OSS-hosted assets from the build to reduce deployment size

set -e

echo "============================================================"
echo "Optimized Frontend Build for Production"
echo "============================================================"

# Build the frontend
echo ""
echo "Building frontend..."
VITE_BASE_PATH=/dnd/ VITE_API_URL=/dnd VITE_WS_URL=wss://ws.deepwood.cn/dnd npm run build

# Get initial build size
INITIAL_SIZE=$(du -sh build | cut -f1)
echo "Initial build size: $INITIAL_SIZE"

# Directories to remove (now hosted on OSS)
# These are copied from public/ to build/client/ by Vite
OSS_DIRS=(
    "build/client/assets/spell-icons"
    "build/client/assets/equipment-icons"
    "build/client/assets/god-icons"
    "build/client/assets/skill-icons"
    "build/client/assets/condition-icons"
    "build/client/assets/ability-icons"
    "build/client/assets/monster-avatars"
    "build/client/assets/npc-avatars"
    "build/client/images/classes"
    "build/client/images/races"
    "build/client/images/monsters"
    "build/client/images/avatars"
    "build/client/images/shops"
    "build/client/images/items"
    "build/client/images/action-buttons"
    "build/client/music"
    "build/client/maps"
    "build/client/sounds"
)

# Non-production files to remove
CLEANUP_DIRS=(
    "build/client/test-data"
    "build/client/rules_bak"
)

# Files to remove (now hosted on OSS)
OSS_FILES=(
    "build/client/bg-dragon.jpg"
    "build/client/bg-tavern.jpg"
    "build/client/logo.jpg"
    "build/client/logo.svg"
)

echo ""
echo "Removing OSS-hosted assets from build..."

for dir in "${OSS_DIRS[@]}"; do
    if [ -d "$dir" ]; then
        SIZE=$(du -sh "$dir" 2>/dev/null | cut -f1)
        echo "  Removing $dir ($SIZE)"
        rm -rf "$dir"
    fi
done

for file in "${OSS_FILES[@]}"; do
    if [ -f "$file" ]; then
        SIZE=$(du -h "$file" 2>/dev/null | cut -f1)
        echo "  Removing $file ($SIZE)"
        rm -f "$file"
    fi
done

echo ""
echo "Removing non-production files..."
for dir in "${CLEANUP_DIRS[@]}"; do
    if [ -d "$dir" ]; then
        SIZE=$(du -sh "$dir" 2>/dev/null | cut -f1)
        echo "  Removing $dir ($SIZE)"
        rm -rf "$dir"
    fi
done

# Clean up empty directories
find build/client/assets -type d -empty -delete 2>/dev/null || true
find build/client/images -type d -empty -delete 2>/dev/null || true

# Get final build size
FINAL_SIZE=$(du -sh build | cut -f1)
echo ""
echo "============================================================"
echo "Build Optimization Complete"
echo "============================================================"
echo "Initial size: $INITIAL_SIZE"
echo "Final size:   $FINAL_SIZE"
echo ""
echo "The build is now ready for deployment."
echo "OSS-hosted assets have been removed."
echo ""

# Create deployment package
echo "Creating deployment package..."
rm -f frontend-build.tar.gz
tar -czf frontend-build.tar.gz build package.json package-lock.json app/data

PACKAGE_SIZE=$(du -h frontend-build.tar.gz | cut -f1)
echo "Deployment package created: frontend-build.tar.gz ($PACKAGE_SIZE)"
