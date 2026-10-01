#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

if ! command -v docker &> /dev/null; then
  echo "Error: Docker is not installed or not in PATH."
  echo "Please install Docker (e.g. 'sudo apt install docker.io docker-buildx') or use './scripts/build-apk-local.sh' to build natively."
  exit 1
fi

mkdir -p "$ROOT_DIR/dist"

echo "==============================================="
echo "Building CTracker Android APK via Docker..."
echo "==============================================="

docker build -t ctracker-android-builder -f docker/Dockerfile.android .
docker run --rm --init --shm-size=2g -v "$ROOT_DIR/dist:/output" ctracker-android-builder

echo ""
echo "Success! Output artifact:"
ls -lh "$ROOT_DIR/dist/CTracker.apk"
