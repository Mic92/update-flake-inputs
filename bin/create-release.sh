#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null && pwd)"
cd "$SCRIPT_DIR/.."

version=${1:-}
if [[ -z $version ]]; then
  echo "USAGE: $0 version" >&2
  echo "Example: $0 v1.2.3" >&2
  exit 1
fi

# Ensure version has 'v' prefix
if [[ ! $version =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version must be in format vX.Y.Z (e.g., v1.2.3)" >&2
  exit 1
fi

if [[ "$(git symbolic-ref --short HEAD)" != "main" ]]; then
  echo "must be on main branch" >&2
  exit 1
fi

waitForPr() {
  local pr=$1
  while true; do
    if gh pr view "$pr" | grep -q 'MERGED'; then
      break
    fi
    echo "Waiting for PR to be merged..."
    sleep 5
  done
}

# ensure we are up-to-date
uncommitted_changes=$(git diff --compact-summary)
if [[ -n $uncommitted_changes ]]; then
  echo -e "There are uncommitted changes, exiting:\n${uncommitted_changes}" >&2
  exit 1
fi
git pull origin main
unpushed_commits=$(git log --format=oneline origin/main..main)
if [[ $unpushed_commits != "" ]]; then
  echo -e "\nThere are unpushed changes, exiting:\n$unpushed_commits" >&2
  exit 1
fi

# make sure tag does not exist
if git tag -l | grep -q "^${version}\$"; then
  echo "Tag ${version} already exists, exiting" >&2
  exit 1
fi

# Update version in package.json (remove 'v' prefix for package.json)
npm_version="${version#v}"
sed -i '' -e "s/\"version\": \".*\"/\"version\": \"${npm_version}\"/" package.json

# Build the action to ensure dist is up-to-date
npm run build

git add package.json package-lock.json dist/
git branch -D "release-${version}" 2>/dev/null || true
git checkout -b "release-${version}"
git commit -m "bump version ${version}"
git push origin "release-${version}"

pr_url=$(gh pr create \
  --base main \
  --head "release-${version}" \
  --title "Release ${version}" \
  --body "Release ${version} of update-flake-inputs action")

# Extract PR number from URL
pr_number=$(echo "$pr_url" | grep -oE '[0-9]+$')

# Enable auto-merge with specific merge method and delete branch
gh pr merge "$pr_number" --auto --merge --delete-branch
git checkout main

waitForPr "release-${version}"
git pull origin main

# Create and push the version tag
git tag -a "${version}" -m "Release ${version}"
git push origin "${version}"

echo ""
echo "Release ${version} created successfully!"
echo "The GitHub Actions workflow will now:"
echo "  1. Build and verify the action"
echo "  2. Create a draft GitHub release"
echo "  3. Update the major version tag (e.g., v1)"
echo ""
echo "Please review and publish the draft release at:"
echo "https://github.com/Mic92/update-flake-inputs/releases"
