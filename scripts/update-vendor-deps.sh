#!/usr/bin/env nix-shell
#!nix-shell -i bash -p nodejs

set -exuo pipefail

npm install
npm run build
