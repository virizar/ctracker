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

TARGET_REF="${1:-}"

if [ -n "$TARGET_REF" ]; then
  if ! git rev-parse --verify "$TARGET_REF" >/dev/null 2>&1; then
    echo "Error: Git reference '$TARGET_REF' not found."
    echo ""
    echo "Available tags:"
    git tag -l | tail -n 10
    exit 1
  fi

  RESOLVED_COMMIT=$(git rev-parse --short "$TARGET_REF")
  echo "==============================================="
  echo "Target ref: $TARGET_REF ($RESOLVED_COMMIT)"
  echo "Extracting code to clean temporary build context..."
  echo "==============================================="

  BUILD_CONTEXT=$(mktemp -d /tmp/ctracker-build-XXXXXX)
  trap 'rm -rf "$BUILD_CONTEXT"' EXIT

  git archive "$TARGET_REF" | tar -x -C "$BUILD_CONTEXT"

  # Ensure docker config is present in the build context
  if [ -d "$ROOT_DIR/docker" ]; then
    cp -r "$ROOT_DIR/docker" "$BUILD_CONTEXT/"
  fi

  BUILD_VER=$(node -e "try { console.log(require('$BUILD_CONTEXT/app.json').expo.version); } catch(e) { console.log('$RESOLVED_COMMIT'); }")
else
  BUILD_CONTEXT="$ROOT_DIR"
  BUILD_VER=$(node -e "try { console.log(require('$ROOT_DIR/app.json').expo.version); } catch(e) { console.log('latest'); }")
  echo "==============================================="
  echo "Building CTracker Android APK from current working tree (v$BUILD_VER)..."
  echo "==============================================="
fi

docker build -t ctracker-android-builder -f "$ROOT_DIR/docker/Dockerfile.android" "$BUILD_CONTEXT"
docker run --rm --init --shm-size=2g -v "$ROOT_DIR/dist:/output" ctracker-android-builder

# Rename generic artifact to versioned APK name
VERSIONED_APK="CTracker-v${BUILD_VER}.apk"
cp "$ROOT_DIR/dist/CTracker.apk" "$ROOT_DIR/dist/$VERSIONED_APK"

echo ""
echo "==============================================="
echo "Success! Output artifacts:"
ls -lh "$ROOT_DIR/dist/$VERSIONED_APK"
ls -lh "$ROOT_DIR/dist/CTracker.apk"
echo ""
echo "To install on connected Android device via ADB:"
echo "  adb install -r dist/$VERSIONED_APK"
echo "==============================================="
