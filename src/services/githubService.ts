import * as github from "@actions/github";
import * as exec from "@actions/exec";
import * as core from "@actions/core";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

export interface GitConfig {
  authorName: string;
  authorEmail: string;
  committerName: string;
  committerEmail: string;
  signoff: boolean;
}

export class GitHubService {
  private octokit: ReturnType<typeof github.getOctokit>;
  private context: typeof github.context;
  private worktreesDir: string;
  private gitConfig: GitConfig;

  constructor(
    octokit: ReturnType<typeof github.getOctokit>,
    context: typeof github.context,
    gitConfig: GitConfig,
  ) {
    this.octokit = octokit;
    this.context = context;
    this.gitConfig = gitConfig;
    // Create a temporary directory for worktrees
    this.worktreesDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "flake-update-worktrees-"),
    );
  }

  async createBranch(branchName: string, baseBranch: string): Promise<string> {
    try {
      // Get the SHA of the base branch
      const { data: baseBranchData } = await this.octokit.rest.repos.getBranch({
        owner: this.context.repo.owner,
        repo: this.context.repo.repo,
        branch: baseBranch,
      });

      // Check if branch already exists
      try {
        await this.octokit.rest.repos.getBranch({
          owner: this.context.repo.owner,
          repo: this.context.repo.repo,
          branch: branchName,
        });

        // Branch exists, delete it first
        await this.octokit.rest.git.deleteRef({
          owner: this.context.repo.owner,
          repo: this.context.repo.repo,
          ref: `heads/${branchName}`,
        });

        core.info(`Deleted existing branch: ${branchName}`);
      } catch {
        // Branch doesn't exist, which is fine
      }

      // Create new branch on remote
      await this.octokit.rest.git.createRef({
        owner: this.context.repo.owner,
        repo: this.context.repo.repo,
        ref: `refs/heads/${branchName}`,
        sha: baseBranchData.commit.sha,
      });

      // Create worktree for this branch
      const worktreePath = path.join(this.worktreesDir, branchName);

      // Remove worktree if it already exists
      try {
        await exec.exec(
          "git",
          ["worktree", "remove", "--force", worktreePath],
          {
            ignoreReturnCode: true,
          },
        );
      } catch {
        // Ignore errors, worktree might not exist
      }

      // Create new worktree from the current HEAD
      await exec.exec("git", [
        "worktree",
        "add",
        worktreePath,
        "-b",
        branchName,
      ]);

      core.info(`Created worktree for branch ${branchName} at ${worktreePath}`);

      return worktreePath;
    } catch (error) {
      throw new Error(`Failed to create branch ${branchName}: ${error}`);
    }
  }

  async commitChanges(
    branchName: string,
    commitMessage: string,
    worktreePath: string,
  ): Promise<boolean> {
    try {
      // Add all changes in the worktree
      await exec.exec("git", ["add", "."], { cwd: worktreePath });

      // Check if there are changes to commit
      const exitCode = await exec.exec("git", ["diff", "--cached", "--quiet"], {
        cwd: worktreePath,
        ignoreReturnCode: true,
        listeners: {
          stdout: () => {},
          stderr: () => {},
        },
      });

      // Exit code 0 = no changes, exit code 1 = has changes
      const hasChanges = exitCode !== 0;

      if (!hasChanges) {
        core.info("No changes to commit");
        return false;
      }

      // Build commit command
      const commitArgs = ["commit", "-m", commitMessage];
      if (this.gitConfig.signoff) {
        commitArgs.push("--signoff");
      }

      // Commit changes
      await exec.exec("git", commitArgs, {
        cwd: worktreePath,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: this.gitConfig.authorName,
          GIT_AUTHOR_EMAIL: this.gitConfig.authorEmail,
          GIT_COMMITTER_NAME: this.gitConfig.committerName,
          GIT_COMMITTER_EMAIL: this.gitConfig.committerEmail,
        },
      });

      // Push to remote
      await exec.exec("git", ["push", "origin", branchName], {
        cwd: worktreePath,
      });

      core.info(`Committed and pushed changes to branch: ${branchName}`);
      return true;
    } catch (error) {
      throw new Error(`Failed to commit changes: ${error}`);
    }
  }

  async ensureLabelsExist(labels: string[]): Promise<void> {
    for (const label of labels) {
      try {
        // Check if label exists
        await this.octokit.rest.issues.getLabel({
          owner: this.context.repo.owner,
          repo: this.context.repo.repo,
          name: label,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          "status" in error &&
          (error as { status: number }).status === 404
        ) {
          // Label doesn't exist, create it
          try {
            await this.octokit.rest.issues.createLabel({
              owner: this.context.repo.owner,
              repo: this.context.repo.repo,
              name: label,
              color: label === "dependencies" ? "0366d6" : "ededed",
              description:
                label === "dependencies"
                  ? "Pull requests that update a dependency"
                  : "",
            });
            core.info(`Created label: ${label}`);
          } catch (createError) {
            core.warning(`Failed to create label ${label}: ${createError}`);
          }
        }
      }
    }
  }

  async createPullRequest(
    branchName: string,
    baseBranch: string,
    title: string,
    body: string,
    labels: string[] = [],
    enableAutomerge = false,
    deleteBranchOnMerge = true,
  ): Promise<void> {
    try {
      // Check if PR already exists
      const { data: existingPRs } = await this.octokit.rest.pulls.list({
        owner: this.context.repo.owner,
        repo: this.context.repo.repo,
        head: `${this.context.repo.owner}:${branchName}`,
        base: baseBranch,
        state: "open",
      });

      if (existingPRs.length > 0) {
        core.info(`Pull request already exists for branch: ${branchName}`);
        return;
      }

      // Ensure labels exist before creating PR
      if (labels.length > 0) {
        await this.ensureLabelsExist(labels);
      }

      // Create pull request
      const { data: pr } = await this.octokit.rest.pulls.create({
        owner: this.context.repo.owner,
        repo: this.context.repo.repo,
        title,
        body,
        head: branchName,
        base: baseBranch,
      });

      core.info(`Created pull request #${pr.number}: ${pr.html_url}`);

      // Add labels to the PR
      if (labels.length > 0) {
        try {
          await this.octokit.rest.issues.addLabels({
            owner: this.context.repo.owner,
            repo: this.context.repo.repo,
            issue_number: pr.number,
            labels: labels,
          });
          core.info(`Added labels to PR #${pr.number}: ${labels.join(", ")}`);
        } catch (error) {
          core.warning(`Failed to add labels to PR #${pr.number}: ${error}`);
        }
      }

      // Enable automerge if requested (requires GraphQL API)
      if (enableAutomerge) {
        try {
          // GitHub only supports auto-merge through GraphQL API
          await this.octokit.graphql(
            `
            mutation($pullRequestId: ID!) {
              enablePullRequestAutoMerge(input: {
                pullRequestId: $pullRequestId,
                mergeMethod: MERGE
              }) {
                pullRequest {
                  autoMergeRequest {
                    enabledAt
                  }
                }
              }
            }
          `,
            {
              pullRequestId: pr.node_id,
            },
          );
          core.info(`Enabled automerge for PR #${pr.number}`);
        } catch (error) {
          core.warning(
            `Failed to enable automerge for PR #${pr.number}: ${error}`,
          );
          core.warning(
            `Note: Auto-merge must be enabled in repository settings and the PR must meet all merge requirements`,
          );
        }
      }

      // Set delete branch on merge if needed
      if (deleteBranchOnMerge) {
        try {
          // Update PR to delete branch on merge
          await this.octokit.rest.pulls.update({
            owner: this.context.repo.owner,
            repo: this.context.repo.repo,
            pull_number: pr.number,
            maintainer_can_modify: true,
          });
          core.info(`Branch will be deleted when PR #${pr.number} is merged`);
        } catch (error) {
          core.warning(
            `Failed to set delete-branch-on-merge for PR #${pr.number}: ${error}`,
          );
        }
      }
    } catch (error) {
      throw new Error(`Failed to create pull request: ${error}`);
    }
  }

  async cleanupWorktree(worktreePath: string): Promise<void> {
    try {
      await exec.exec("git", ["worktree", "remove", "--force", worktreePath], {
        ignoreReturnCode: true,
      });
      core.info(`Cleaned up worktree at ${worktreePath}`);
    } catch (error) {
      core.warning(`Failed to cleanup worktree at ${worktreePath}: ${error}`);
    }
  }

  async cleanupAllWorktrees(): Promise<void> {
    try {
      if (fs.existsSync(this.worktreesDir)) {
        fs.rmSync(this.worktreesDir, { recursive: true });
      }
      core.info("Cleaned up all worktrees");
    } catch (error) {
      core.warning(`Failed to cleanup worktrees directory: ${error}`);
    }
  }
}
