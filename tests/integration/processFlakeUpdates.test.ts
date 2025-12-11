import { processFlakeUpdates } from "../../src/index";
import { FlakeService } from "../../src/services/flakeService";
import { GitHubService, GitConfig } from "../../src/services/githubService";
import * as path from "path";
import * as fs from "fs";
import * as exec from "@actions/exec";
import * as os from "os";
import * as github from "@actions/github";
import * as core from "@actions/core";

// Mock @actions/core just for logging
jest.mock("@actions/core", () => ({
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  setFailed: jest.fn(),
}));

// Create a custom GitHubService that prevents actual PR creation
class TestGitHubService extends GitHubService {
  public prCreationAttempts: Array<{
    branchName: string;
    baseBranch: string;
    title: string;
    body: string;
  }> = [];
  public commitResults: Array<{ branchName: string; hasChanges: boolean }> = [];

  async commitChanges(
    branchName: string,
    commitMessage: string,
    worktreePath: string,
  ): Promise<boolean> {
    const hasChanges = await super.commitChanges(
      branchName,
      commitMessage,
      worktreePath,
    );
    this.commitResults.push({ branchName, hasChanges });
    return hasChanges;
  }

  async createPullRequest(
    branchName: string,
    baseBranch: string,
    title: string,
    body: string,
    labels: string[] = [],
    enableAutoMerge = false,
    autoMergeMethod?: "MERGE" | "SQUASH" | "REBASE",
    deleteBranchOnMerge = true,
  ): Promise<void> {
    // Record the attempt but don't actually create a PR
    this.prCreationAttempts.push({ branchName, baseBranch, title, body });
    core.info(`[TEST] Would have created PR: ${title}`);
  }
}

describe("processFlakeUpdates Integration Tests", () => {
  const fixturesPath = path.join(__dirname, "..", "fixtures");

  describe("with up-to-date flake input", () => {
    let tempDir: string;
    let originalCwd: string;

    beforeEach(async () => {
      // Save original working directory
      originalCwd = process.cwd();

      // Create a temporary directory
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "process-updates-test-"));

      // Copy test files to temp directory
      const flakeContent = fs.readFileSync(
        path.join(fixturesPath, "up-to-date/flake.nix"),
        "utf8",
      );

      // Replace the relative path with an absolute path to the local-flake-repo
      const absolutePath = path.join(fixturesPath, "local-flake-repo");
      const patchedFlakeContent = flakeContent.replace(
        "path:../local-flake-repo",
        `path:${absolutePath}`,
      );

      fs.writeFileSync(path.join(tempDir, "flake.nix"), patchedFlakeContent);

      // Generate a fresh lock file with the absolute path
      await exec.exec("nix", ["flake", "lock"], { cwd: tempDir });

      // Initialize git repo in temp directory
      await exec.exec("git", ["init", "-b", "main"], { cwd: tempDir });
      await exec.exec("git", ["add", "."], { cwd: tempDir });
      await exec.exec("git", ["commit", "-m", "Initial commit"], {
        cwd: tempDir,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Test User",
          GIT_AUTHOR_EMAIL: "test@example.com",
          GIT_COMMITTER_NAME: "Test User",
          GIT_COMMITTER_EMAIL: "test@example.com",
        },
      });

      // Change to temp directory for the test
      process.chdir(tempDir);
    }, 15000);

    afterEach(() => {
      // Restore original working directory
      process.chdir(originalCwd);

      // Clean up temp directory
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true });
      }

      jest.clearAllMocks();
    });

    it("should skip PR creation when flake input has no updates", async () => {
      // Create a fake octokit that simulates API responses
      const mockOctokit = {
        rest: {
          repos: {
            getBranch: async () => ({ data: { commit: { sha: "abc123" } } }),
          },
          git: {
            createRef: async () => ({}),
            deleteRef: async () => ({}),
          },
          pulls: {
            list: async () => ({ data: [] }),
            create: async () => {
              throw new Error("Should not create PR in this test");
            },
          },
        },
      };

      const flakeService = new FlakeService();
      const gitConfig: GitConfig = {
        authorName: "Test User",
        authorEmail: "test@example.com",
        committerName: "Test User",
        committerEmail: "test@example.com",
        signoff: true,
      };
      const testGitHubService = new TestGitHubService(
        mockOctokit as any,
        {
          repo: { owner: "test", repo: "test-repo" },
        } as any,
        gitConfig,
      );

      // Process flake updates
      await processFlakeUpdates(
        flakeService,
        testGitHubService,
        "",
        "main",
        [],
        false,
        "MERGE",
        true,
        "Update flake input: {{input}}{{in}}",
      );

      // Verify NO pull request creation was attempted
      expect(testGitHubService.prCreationAttempts).toHaveLength(0);

      // Verify the log message indicates no changes
      expect(core.info).toHaveBeenCalledWith(
        "No changes detected for flake input: local-test in flake.nix - skipping PR creation",
      );

      // With worktrees, we stay on the main branch
      const currentBranch = await exec.getExecOutput("git", [
        "branch",
        "--show-current",
      ]);
      expect(currentBranch.stdout.trim()).toBe("main");

      // Verify no new commits were made on main
      const logOutput = await exec.getExecOutput("git", ["log", "--oneline"]);
      const commits = logOutput.stdout.trim().split("\n");
      expect(commits).toHaveLength(1);
      expect(commits[0]).toContain("Initial commit");
    }, 15000);
  });

  describe("with updatable flake input", () => {
    let tempDir: string;
    let remoteDir: string;
    let originalCwd: string;

    beforeEach(async () => {
      // Save original working directory
      originalCwd = process.cwd();

      // Create a temporary directory for the remote
      remoteDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "process-updates-remote-"),
      );

      // Initialize bare git repo for the remote
      await exec.exec("git", ["init", "--bare", "-b", "main"], {
        cwd: remoteDir,
      });

      // Create a temporary directory for the working repo
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "process-updates-test-"));

      // Create a flake with an input that can be updated
      const flakeContent = `{
  inputs = {
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, flake-utils }: {
    # Test flake with updatable input
  };
}`;

      fs.writeFileSync(path.join(tempDir, "flake.nix"), flakeContent);

      // Copy the old lock file from minimal fixture (which has an older flake-utils)
      fs.copyFileSync(
        path.join(fixturesPath, "minimal/flake.lock"),
        path.join(tempDir, "flake.lock"),
      );

      // Initialize git repo in temp directory
      await exec.exec("git", ["init", "-b", "main"], { cwd: tempDir });
      await exec.exec("git", ["add", "."], { cwd: tempDir });
      await exec.exec("git", ["commit", "-m", "Initial commit"], {
        cwd: tempDir,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Test User",
          GIT_AUTHOR_EMAIL: "test@example.com",
          GIT_COMMITTER_NAME: "Test User",
          GIT_COMMITTER_EMAIL: "test@example.com",
        },
      });

      // Add the remote
      await exec.exec("git", ["remote", "add", "origin", remoteDir], {
        cwd: tempDir,
      });

      // Push to the remote
      await exec.exec("git", ["push", "-u", "origin", "main"], {
        cwd: tempDir,
      });

      // Change to temp directory for the test
      process.chdir(tempDir);
    }, 15000);

    afterEach(() => {
      // Restore original working directory
      process.chdir(originalCwd);

      // Clean up temp directories
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true });
      }
      if (fs.existsSync(remoteDir)) {
        fs.rmSync(remoteDir, { recursive: true });
      }

      jest.clearAllMocks();
    });

    it("should create PR when flake input has updates", async () => {
      // Create a fake octokit that simulates API responses
      const mockOctokit = {
        rest: {
          repos: {
            getBranch: async () => ({ data: { commit: { sha: "abc123" } } }),
          },
          git: {
            createRef: async () => ({}),
            deleteRef: async () => ({}),
          },
          pulls: {
            list: async () => ({ data: [] }),
            create: async () => {
              throw new Error("Should not create PR in this test");
            },
          },
        },
      };

      const flakeService = new FlakeService();
      const gitConfig: GitConfig = {
        authorName: "Test User",
        authorEmail: "test@example.com",
        committerName: "Test User",
        committerEmail: "test@example.com",
        signoff: true,
      };
      const testGitHubService = new TestGitHubService(
        mockOctokit as any,
        {
          repo: { owner: "test", repo: "test-repo" },
        } as any,
        gitConfig,
      );

      // Process flake updates
      await processFlakeUpdates(
        flakeService,
        testGitHubService,
        "",
        "main",
        [],
        false,
        "MERGE",
        true,
        "Update flake input: {{input}}{{in}}",
      );

      // Verify pull request creation was attempted
      expect(testGitHubService.prCreationAttempts).toHaveLength(1);

      const prAttempt = testGitHubService.prCreationAttempts[0];
      expect(prAttempt.branchName).toBe("update-flake-utils");
      expect(prAttempt.baseBranch).toBe("main");
      expect(prAttempt.title).toBe("Update flake input: flake-utils");
      expect(prAttempt.body).toBe(
        "This PR updates the flake input `flake-utils` to the latest version.",
      );

      // Verify the success log message
      expect(core.info).toHaveBeenCalledWith(
        "Successfully created PR for flake input: flake-utils in flake.nix",
      );

      // With worktrees, we stay on the main branch
      const currentBranch = await exec.getExecOutput("git", [
        "branch",
        "--show-current",
      ]);
      expect(currentBranch.stdout.trim()).toBe("main");

      // Verify a commit was made on the update branch
      const logOutput = await exec.getExecOutput("git", [
        "log",
        "--oneline",
        "update-flake-utils",
      ]);
      const commits = logOutput.stdout.trim().split("\n");
      expect(commits).toHaveLength(2);
      expect(commits[0]).toContain("Update flake input: flake-utils");
      expect(commits[1]).toContain("Initial commit");
    }, 15000);
  });
});
