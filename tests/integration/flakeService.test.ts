import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import * as core from "../__fixtures__/core.js";
import * as path from "path";
import * as fs from "fs";
import * as exec from "@actions/exec";
import * as os from "os";

// Mock @actions/core with fixture
jest.unstable_mockModule("@actions/core", () => core);

// Import after mock setup
const { FlakeService } = await import("../../src/services/flakeService.js");

describe("FlakeService Integration Tests", () => {
  let flakeService: InstanceType<typeof FlakeService>;
  const fixturesPath = path.join(import.meta.dirname, "..", "fixtures");

  beforeEach(() => {
    flakeService = new FlakeService();
    // Change to fixtures directory for tests
    process.chdir(fixturesPath);
  });

  afterEach(() => {
    // Reset to original directory
    process.chdir(path.join(import.meta.dirname, "..", ".."));
    jest.resetAllMocks();
  });

  describe("discoverFlakeFiles", () => {
    it("should discover all flake.nix files and their inputs", async () => {
      const flakes = await flakeService.discoverFlakeFiles();

      // Should find simple/flake.nix, minimal/flake.nix, subflake/flake.nix and subflake/sub/flake.nix
      expect(flakes.length).toBeGreaterThanOrEqual(4);

      // Find the simple flake
      const simpleFlake = flakes.find((f) => f.filePath === "simple/flake.nix");
      expect(simpleFlake).toBeDefined();
      expect(simpleFlake!.inputs).toContain("nixos-hardware");
      expect(simpleFlake!.inputs).toContain("flake-utils");
      expect(simpleFlake!.inputs.length).toBe(2);

      // Find the root subflake
      const rootSubflake = flakes.find(
        (f) => f.filePath === "subflake/flake.nix",
      );
      expect(rootSubflake).toBeDefined();
      expect(rootSubflake!.inputs).toContain("flake-utils");
      expect(rootSubflake!.inputs.length).toBe(1);

      // Find the nested subflake
      const nestedSubflake = flakes.find(
        (f) => f.filePath === "subflake/sub/flake.nix",
      );
      expect(nestedSubflake).toBeDefined();
      expect(nestedSubflake!.inputs).toContain("flake-utils");
      expect(nestedSubflake!.inputs).toContain("nixos-hardware");
      expect(nestedSubflake!.inputs.length).toBe(2);

      // Find the minimal flake
      const minimalFlake = flakes.find(
        (f) => f.filePath === "minimal/flake.nix",
      );
      expect(minimalFlake).toBeDefined();
      expect(minimalFlake!.inputs).toContain("flake-utils");
      expect(minimalFlake!.inputs.length).toBe(1);

      // Verify that flakes without lock files are skipped
      const localFlakeRepo = flakes.find(
        (f) => f.filePath === "local-flake-repo/flake.nix",
      );
      expect(localFlakeRepo).toBeUndefined();
    }, 10000);

    it("should respect exclude patterns for files", async () => {
      const flakes = await flakeService.discoverFlakeFiles("subflake/**");

      // Should exclude all subflake files
      const subflakeFiles = flakes.filter((f) =>
        f.filePath.startsWith("subflake/"),
      );
      expect(subflakeFiles.length).toBe(0);

      // Should still include simple/flake.nix
      const simpleFlake = flakes.find((f) => f.filePath === "simple/flake.nix");
      expect(simpleFlake).toBeDefined();
    }, 10000);

    it("should respect exclude patterns for specific inputs", async () => {
      const flakes = await flakeService.discoverFlakeFiles(
        "**/flake.nix#flake-utils",
      );

      // All flakes should still be discovered
      expect(flakes.length).toBeGreaterThanOrEqual(4);

      // But flake-utils should be excluded from all inputs
      for (const flake of flakes) {
        expect(flake.inputs).not.toContain("flake-utils");
      }

      // Other inputs should still be present
      const simpleFlake = flakes.find((f) => f.filePath === "simple/flake.nix");
      expect(simpleFlake!.inputs).toContain("nixos-hardware");

      const nestedSubflake = flakes.find(
        (f) => f.filePath === "subflake/sub/flake.nix",
      );
      expect(nestedSubflake!.inputs).toContain("nixos-hardware");
    }, 10000);

    it("should handle mixed exclude patterns", async () => {
      const flakes = await flakeService.discoverFlakeFiles(
        "simple/**,subflake/sub/flake.nix#nixos-hardware",
      );

      // simple/flake.nix should be completely excluded
      const simpleFlake = flakes.find((f) => f.filePath === "simple/flake.nix");
      expect(simpleFlake).toBeUndefined();

      // subflake/sub/flake.nix should exist but without nixos-hardware
      const nestedSubflake = flakes.find(
        (f) => f.filePath === "subflake/sub/flake.nix",
      );
      expect(nestedSubflake).toBeDefined();
      expect(nestedSubflake!.inputs).toContain("flake-utils");
      expect(nestedSubflake!.inputs).not.toContain("nixos-hardware");
    }, 10000);
  });

  describe("getFlakeInputs", () => {
    it("should correctly parse inputs from root flake", async () => {
      const flake = {
        filePath: "simple/flake.nix",
        inputs: [],
        excludedOutputs: [],
      };
      const inputs = await flakeService.getFlakeInputs(flake);

      expect(inputs).toContain("nixos-hardware");
      expect(inputs).toContain("flake-utils");
      expect(inputs.length).toBe(2);
    }, 10000);

    it("should correctly parse inputs from subflake", async () => {
      const flake = {
        filePath: "subflake/sub/flake.nix",
        inputs: [],
        excludedOutputs: [],
      };
      const inputs = await flakeService.getFlakeInputs(flake);

      expect(inputs).toContain("flake-utils");
      expect(inputs).toContain("nixos-hardware");
      expect(inputs.length).toBe(2);
    });

    it("should exclude specified outputs", async () => {
      const flake = {
        filePath: "simple/flake.nix",
        inputs: [],
        excludedOutputs: ["nixos-hardware"],
      };
      const inputs = await flakeService.getFlakeInputs(flake);

      expect(inputs).not.toContain("nixos-hardware");
      expect(inputs).toContain("flake-utils");
      expect(inputs.length).toBe(1);
    });
  });

  describe("updateFlakeInput", () => {
    let tempDir: string;
    let originalCwd: string;

    beforeEach(async () => {
      // Save original working directory
      originalCwd = process.cwd();

      // Create a temporary directory outside the git repo
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flake-update-test-"));

      // Copy test files to temp directory
      fs.copyFileSync(
        path.join(fixturesPath, "minimal/flake.nix"),
        path.join(tempDir, "flake.nix"),
      );
      fs.copyFileSync(
        path.join(fixturesPath, "minimal/flake.lock"),
        path.join(tempDir, "flake.lock"),
      );

      // Initialize git repo in temp directory
      await exec.exec("git", ["init"], { cwd: tempDir });
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
    });

    afterEach(() => {
      // Restore original working directory
      process.chdir(originalCwd);

      // Clean up temp directory
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true });
      }
    });

    it("should update a flake input and modify the lock file", async () => {
      const testFlakePath = "flake.nix";
      const lockFilePath = path.join(tempDir, "flake.lock");

      // Get the original lock file content
      const originalLockContent = fs.readFileSync(lockFilePath, "utf8");
      const originalLock = JSON.parse(originalLockContent);
      const originalFlakeUtilsRev =
        originalLock.nodes["flake-utils"].locked.rev;

      // Create a FlakeService instance for the temp directory
      const tempFlakeService = new FlakeService();

      // Update flake-utils input
      await tempFlakeService.updateFlakeInput("flake-utils", testFlakePath);

      // Check that the lock file was modified
      const updatedLockContent = fs.readFileSync(lockFilePath, "utf8");
      const updatedLock = JSON.parse(updatedLockContent);

      // The lock file should have changed
      expect(updatedLockContent).not.toBe(originalLockContent);

      // The flake-utils input should still exist
      expect(updatedLock.nodes["flake-utils"]).toBeDefined();
      expect(updatedLock.nodes["flake-utils"].locked.owner).toBe("numtide");
      expect(updatedLock.nodes["flake-utils"].locked.repo).toBe("flake-utils");
      expect(updatedLock.nodes["flake-utils"].locked.rev).toBeDefined();
      expect(updatedLock.nodes["flake-utils"].locked.narHash).toBeDefined();

      // The revision should have changed from our old one
      expect(updatedLock.nodes["flake-utils"].locked.rev).not.toBe(
        originalFlakeUtilsRev,
      );
    }, 10000); // 30 second timeout

    it("should handle updating a non-existent input gracefully", async () => {
      const testFlakePath = "flake.nix";
      const tempFlakeService = new FlakeService();

      // This should not throw an error, just log a warning
      await expect(
        tempFlakeService.updateFlakeInput("nonexistent", testFlakePath),
      ).resolves.not.toThrow();

      // The lock file should remain unchanged
      const lockFilePath = path.join(tempDir, "flake.lock");
      const lockContent = fs.readFileSync(lockFilePath, "utf8");
      const lock = JSON.parse(lockContent);

      // Should still have the same structure
      expect(lock.nodes["flake-utils"]).toBeDefined();
      expect(lock.nodes["nonexistent"]).toBeUndefined();
    }, 10000); // 30 second timeout
  });

  describe("updateFlakeInput with subdirectory flake in worktree", () => {
    let tempDir: string;
    let worktreePath: string;
    let originalCwd: string;

    beforeEach(async () => {
      // Save original working directory
      originalCwd = process.cwd();

      // Create a temporary directory outside the git repo
      tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "flake-update-subdir-test-"),
      );

      // Create a subdirectory for the flake (simulating dev-flake/flake.nix)
      const subDir = path.join(tempDir, "dev-flake");
      fs.mkdirSync(subDir, { recursive: true });

      // Copy test files to the subdirectory
      fs.copyFileSync(
        path.join(fixturesPath, "minimal/flake.nix"),
        path.join(subDir, "flake.nix"),
      );
      fs.copyFileSync(
        path.join(fixturesPath, "minimal/flake.lock"),
        path.join(subDir, "flake.lock"),
      );

      // Initialize git repo in temp directory (at root, not subdirectory)
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

      // Create a worktree (simulating what GitHubService.createBranch does)
      worktreePath = fs.mkdtempSync(
        path.join(os.tmpdir(), "flake-update-worktree-"),
      );
      // Remove the empty dir so git worktree can create it
      fs.rmdirSync(worktreePath);
      await exec.exec(
        "git",
        ["worktree", "add", worktreePath, "-b", "update-test-branch"],
        { cwd: tempDir },
      );

      // Change to the main repo directory for the test
      process.chdir(tempDir);
    });

    afterEach(async () => {
      // Restore original working directory
      process.chdir(originalCwd);

      // Clean up worktree
      try {
        await exec.exec(
          "git",
          ["worktree", "remove", "--force", worktreePath],
          {
            cwd: tempDir,
            ignoreReturnCode: true,
          },
        );
      } catch {
        // Ignore errors
      }

      // Clean up temp directory
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true });
      }
      if (fs.existsSync(worktreePath)) {
        fs.rmSync(worktreePath, { recursive: true });
      }
    });

    it("should update a flake input in a subdirectory when using worktree", async () => {
      // This is the regression test for https://github.com/Mic92/update-flake-inputs/issues/27
      // The bug: when flakeFile is "dev-flake/flake.nix" and workDir is the worktree path,
      // nix flake update was being called with git+file:// pointing to the subdirectory
      // instead of the git repo root with a ?dir= parameter.

      const flakeFile = "dev-flake/flake.nix";
      const lockFilePath = path.join(worktreePath, "dev-flake", "flake.lock");

      // Get the original lock file content
      const originalLockContent = fs.readFileSync(lockFilePath, "utf8");
      const originalLock = JSON.parse(originalLockContent);
      const originalFlakeUtilsRev =
        originalLock.nodes["flake-utils"].locked.rev;

      // Create a FlakeService instance
      const tempFlakeService = new FlakeService();

      // Update flake-utils input in the subdirectory flake, using worktree path
      // This should NOT throw an error about the git repository not existing
      await tempFlakeService.updateFlakeInput(
        "flake-utils",
        flakeFile,
        worktreePath,
      );

      // Check that the lock file was modified
      const updatedLockContent = fs.readFileSync(lockFilePath, "utf8");
      const updatedLock = JSON.parse(updatedLockContent);

      // The lock file should have changed
      expect(updatedLockContent).not.toBe(originalLockContent);

      // The flake-utils input should still exist and have been updated
      expect(updatedLock.nodes["flake-utils"]).toBeDefined();
      expect(updatedLock.nodes["flake-utils"].locked.owner).toBe("numtide");
      expect(updatedLock.nodes["flake-utils"].locked.repo).toBe("flake-utils");
      expect(updatedLock.nodes["flake-utils"].locked.rev).not.toBe(
        originalFlakeUtilsRev,
      );
    }, 30000);
  });
});
