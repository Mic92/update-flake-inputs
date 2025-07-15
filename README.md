# Update Flake Inputs GitHub Action

A GitHub Action that automatically discovers all `flake.nix` files in your repository and creates pull requests for each Nix flake input update.

## Features

- Automatically discovers all `flake.nix` files in the repository
- Supports excluding specific flake files using glob patterns
- Parses each `flake.nix` file to identify all inputs
- Creates a separate branch for each flake input update
- Updates each input individually using `nix flake update`
- Creates a pull request for each updated input
- Handles existing branches and pull requests gracefully

## Usage

### Workflow File

Create a workflow file (e.g., `.github/workflows/update-flake-inputs.yml`):

```yaml
name: Update Flake Inputs

on:
  schedule:
    # Run weekly on Sundays at 2 AM UTC
    - cron: '0 2 * * 0'
  workflow_dispatch: # Allow manual triggering

jobs:
  update-flake-inputs:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Setup Nix
        uses: cachix/install-nix-action@v31

      - name: Update flake inputs
        uses: mic92/update-flake-inputs@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          # Optional: exclude specific files or inputs
          # exclude-patterns: 'tests/**/flake.nix,examples/**/flake.nix#home-manager'
          # Optional: add custom labels (default: 'dependencies')
          # pr-labels: 'dependencies,automated'
          # Optional: enable auto-merge (default: false)
          # auto-merge: 'true'
```

### Using with GitHub App Token

To trigger CI workflows on the created pull requests, you need to use a GitHub App token instead of `GITHUB_TOKEN` (since `GITHUB_TOKEN` doesn't trigger workflows to prevent infinite loops).

#### 🚀 Easy GitHub App Setup

**Use our web interface to create your GitHub App:**
👉 **[Create GitHub App](https://mic92.github.io/update-flake-inputs/)**

#### Manual Setup

Alternatively, you can create the GitHub App manually:

```yaml
name: Update Flake Inputs

on:
  schedule:
    - cron: '0 2 * * 0'
  workflow_dispatch:

jobs:
  update-flake-inputs:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    
    steps:
      - name: Generate GitHub App Token
        id: app-token
        uses: actions/create-github-app-token@v1
        with:
          app-id: ${{ secrets.APP_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}

      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          token: ${{ steps.app-token.outputs.token }}

      - name: Setup Nix
        uses: cachix/install-nix-action@v31

      - name: Update flake inputs
        uses: mic92/update-flake-inputs@main
        with:
          github-token: ${{ steps.app-token.outputs.token }}
          # Optional: exclude specific files or inputs
          # exclude-patterns: 'tests/**/flake.nix,examples/**/flake.nix#home-manager'
          # Optional: add custom labels (default: 'dependencies')
          # pr-labels: 'dependencies,automated'
          # Optional: enable auto-merge (default: false)
          # auto-merge: 'true'
```

The GitHub App needs the following permissions:
- **Repository permissions:**
  - Contents: Write (to create branches and commits)
  - Pull requests: Write (to create pull requests)
  - Metadata: Read (to access repository information)

### Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `github-token` | GitHub token for creating pull requests | Yes | - |
| `exclude-patterns` | Comma-separated list of glob patterns to exclude flake.nix files or specific inputs using `pattern#inputname` syntax | No | `''` |
| `pr-labels` | Comma-separated list of labels to add to created pull requests (labels will be created if they don't exist) | No | `'dependencies'` |
| `auto-merge` | Enable auto-merge for created pull requests (requires auto-merge to be enabled in repository settings) | No | `'false'` |
| `delete-branch` | Delete branch after pull request is merged | No | `'true'` |
| `signoff` | Add sign-off to commits | No | `'true'` |
| `git-author-name` | Git author name for commits | No | `'github-actions[bot]'` |
| `git-author-email` | Git author email for commits | No | `'41898282+github-actions[bot]@users.noreply.github.com'` |
| `git-committer-name` | Git committer name for commits | No | `'github-actions[bot]'` |
| `git-committer-email` | Git committer email for commits | No | `'41898282+github-actions[bot]@users.noreply.github.com'` |

## Development

### Prerequisites

- Node.js 20+
- npm
- Nix with flakes enabled

### Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the action:
   ```bash
   npm run build
   ```

### Testing

The action will automatically discover all `flake.nix` files in your repository. It will:

1. Scan the repository for all `flake.nix` files (excluding `node_modules` and `.git` directories)
2. Apply any exclude patterns you've specified
3. For each discovered flake file, parse the inputs section
4. For each input in each flake file, create a branch named `update-{input-name}` (for main flake.nix) or `update-{input-name}-{flake-path}` (for subdirectories)
5. Update that specific input using `nix flake update` in the correct directory
6. Commit the changes and push the branch
7. Create a pull request for the update

### Example exclude patterns:

**File-level exclusions (exclude entire flake files):**
- `tests/**/flake.nix` - Exclude all flake.nix files in any tests directory
- `examples/**/flake.nix` - Exclude all flake.nix files in any examples directory  
- `**/template/flake.nix` - Exclude flake.nix files in template directories
- `vendor/**` - Exclude everything in vendor directories

**Input-level exclusions (exclude specific inputs from matching files):**
- `**/flake.nix#nixpkgs` - Exclude the `nixpkgs` input from all flake.nix files
- `examples/**/flake.nix#home-manager` - Exclude the `home-manager` input from flake.nix files in examples directories
- `tests/**/flake.nix#devshell` - Exclude the `devshell` input from flake.nix files in tests directories

## License

MIT
