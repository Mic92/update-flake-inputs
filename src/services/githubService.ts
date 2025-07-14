import * as github from "@actions/github";
import * as exec from "@actions/exec";
import * as core from "@actions/core";

export class GitHubService {
  private octokit: ReturnType<typeof github.getOctokit>;
  private context: typeof github.context;

  constructor(
    octokit: ReturnType<typeof github.getOctokit>,
    context: typeof github.context,
  ) {
    this.octokit = octokit;
    this.context = context;
  }

  async createBranch(branchName: string, baseBranch: string): Promise<void> {
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

      // Create new branch
      await this.octokit.rest.git.createRef({
        owner: this.context.repo.owner,
        repo: this.context.repo.repo,
        ref: `refs/heads/${branchName}`,
        sha: baseBranchData.commit.sha,
      });

      // Checkout the new branch locally
      await exec.exec("git", ["checkout", "-b", branchName]);

      core.info(`Created and checked out branch: ${branchName}`);
    } catch (error) {
      throw new Error(`Failed to create branch ${branchName}: ${error}`);
    }
  }

  async commitChanges(
    branchName: string,
    commitMessage: string,
  ): Promise<boolean> {
    try {
      // Add all changes
      await exec.exec("git", ["add", "."]);

      // Check if there are changes to commit
      let hasChanges = false;
      await exec
        .exec("git", ["diff", "--cached", "--quiet"], {
          ignoreReturnCode: true,
          listeners: {
            stdout: () => {},
            stderr: () => {},
          },
        })
        .then(() => {
          hasChanges = false;
        })
        .catch(() => {
          hasChanges = true;
        });

      if (!hasChanges) {
        core.info("No changes to commit");
        return false;
      }

      // Commit changes
      await exec.exec("git", ["commit", "-m", commitMessage]);

      // Push to remote
      await exec.exec("git", ["push", "origin", branchName]);

      core.info(`Committed and pushed changes to branch: ${branchName}`);
      return true;
    } catch (error) {
      throw new Error(`Failed to commit changes: ${error}`);
    }
  }

  async createPullRequest(
    branchName: string,
    baseBranch: string,
    title: string,
    body: string,
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
    } catch (error) {
      throw new Error(`Failed to create pull request: ${error}`);
    }
  }
}
