#!/bin/bash

# Quick build script for Konveyor extension
# Skips: clean, npm install, asset download
# Use this for rapid iteration when you already have assets downloaded

set -e  # Exit on any error

echo "⚡ Quick VSIX Build (skipping cleanup and asset downloads)"
echo ""

# Check if assets exist
if [ ! -d "downloaded_assets/kai" ]; then
    echo "⚠️  Warning: No downloaded assets found!"
    echo "   Run 'npm run collect-assets:dev' once to download platform binaries"
    echo "   Or use './scripts/build.sh' for a full build"
    echo ""
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "🔨 Building workspaces..."
npm run build

echo "📦 Creating distribution..."
npm run dist

echo "📦 Packaging VSIX..."
npm run package

echo ""
echo "✅ Quick build complete! VSIX file:"
ls -lh dist/*.vsix
echo ""
echo "💡 Tip: For production builds, use './scripts/build.sh' instead"

