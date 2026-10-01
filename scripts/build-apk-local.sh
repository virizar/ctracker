#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

echo "==============================================="
echo "Building CTracker Android APK Locally..."
echo "==============================================="

# Verify Java is available
if ! command -v java &> /dev/null; then
  echo "Error: Java is not installed. Please install OpenJDK 17."
  exit 1
fi

# Detect or setup Android SDK
if [ -z "$ANDROID_HOME" ]; then
  if [ -d "$HOME/Android/Sdk" ]; then
    export ANDROID_HOME="$HOME/Android/Sdk"
  elif [ -d "$HOME/.android-sdk" ]; then
    export ANDROID_HOME="$HOME/.android-sdk"
  fi
fi

if [ -z "$ANDROID_HOME" ] || [ ! -d "$ANDROID_HOME" ]; then
  echo "Notice: ANDROID_HOME is not set or not found."
  echo "If you have Android SDK installed, export ANDROID_HOME=/path/to/sdk."
  echo "Or use './scripts/build-apk-docker.sh' to build inside an isolated Docker container."
  exit 1
fi

export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
export NODE_OPTIONS="--max-old-space-size=4096"
export GRADLE_OPTS="-Xmx3072m -XX:MetaspaceSize=512m -XX:MaxMetaspaceSize=1024m -XX:+UseG1GC"

mkdir -p "$ROOT_DIR/dist"

echo "1. Generating native Android project via Expo prebuild..."
npx expo prebuild --platform android --clean

echo "2. Compiling standalone release APK with Gradle (capped workers & expanded Metaspace)..."
cd android
./gradlew assembleRelease \
  --no-daemon \
  --max-workers=2 \
  -Dorg.gradle.jvmargs="-Xmx3072m -XX:MetaspaceSize=512m -XX:MaxMetaspaceSize=1024m -XX:+UseG1GC"

echo "3. Copying APK to dist/..."
cp app/build/outputs/apk/release/app-release.apk "$ROOT_DIR/dist/CTracker.apk"

echo ""
echo "Success! Standalone APK built at:"
ls -lh "$ROOT_DIR/dist/CTracker.apk"
