#!/bin/bash

# Build script for Konveyor extension
# Runs full build pipeline: clean -> collect assets -> build -> dist -> package

set -e  # Exit on any error

echo "🧹 Cleaning..."
npm run clean

echo "📦 Installing dependencies..."
npm i

echo "📦 Collecting assets for development..."
npm run collect-assets:dev

echo "🔨 Building..."
npm run build

echo "📦 Creating distribution..."
npm run dist

echo "📦 Packaging VSIX..."
npm run package

echo "✅ Build complete! VSIX file:"
ls -la dist/*.vsix