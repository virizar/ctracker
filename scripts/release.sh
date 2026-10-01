#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

# 1. Pre-flight checks
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Working directory has uncommitted changes. Please commit or stash first."
  git status --short
  exit 1
fi

echo "Running typecheck and unit tests..."
npm run typecheck
npm test

# 2. Determine bump
BUMP="${1:-auto}"
LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")

if [ -z "$LATEST_TAG" ]; then
  CURRENT_VER="1.0.0"
  REV_RANGE="HEAD"
else
  CURRENT_VER="${LATEST_TAG#v}"
  REV_RANGE="${LATEST_TAG}..HEAD"
fi

if [ "$BUMP" = "auto" ]; then
  COMMITS=$(git log $REV_RANGE --pretty=format:"%s")
  if echo "$COMMITS" | grep -qE "BREAKING CHANGE|!: "; then
    BUMP="major"
  elif echo "$COMMITS" | grep -qE "^feat(\(.*\))?:"; then
    BUMP="minor"
  else
    BUMP="patch"
  fi
fi

echo "Current version: $CURRENT_VER"
echo "Bumping ($BUMP)..."

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VER"

case "$BUMP" in
  major)
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
    ;;
  minor)
    MINOR=$((MINOR + 1))
    PATCH=0
    ;;
  patch)
    PATCH=$((PATCH + 1))
    ;;
  *)
    echo "Unknown bump type: $BUMP (use patch, minor, or major)"
    exit 1
    ;;
esac

NEW_VER="${MAJOR}.${MINOR}.${PATCH}"
NEW_TAG="v${NEW_VER}"

echo "New Version: $NEW_VER ($NEW_TAG)"

# 3. Update package.json and app.json
npm version "$NEW_VER" --no-git-tag-version

node -e "
  const fs = require('fs');
  const app = JSON.parse(fs.readFileSync('app.json', 'utf8'));
  app.expo.version = '$NEW_VER';
  fs.writeFileSync('app.json', JSON.stringify(app, null, 2) + '\n');
"

# 4. Commit and Tag
git add package.json package-lock.json app.json
git commit -m "chore(release): bump version to $NEW_TAG"
git tag "$NEW_TAG"

echo "==============================================="
echo "Successfully released $NEW_TAG locally!"
echo "To build your APK now, run:"
echo "  npm run build:apk"
echo "To push your release tag to GitHub, run:"
echo "  git push origin main --tags"
echo "==============================================="
