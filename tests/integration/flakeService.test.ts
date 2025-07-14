import { FlakeService } from '../../src/services/flakeService';
import * as path from 'path';
import * as fs from 'fs';
import * as exec from '@actions/exec';
import * as os from 'os';

// Mock @actions/core
jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  setFailed: jest.fn(),
}));

describe('FlakeService Integration Tests', () => {
  let flakeService: FlakeService;
  const fixturesPath = path.join(__dirname, '..', 'fixtures');

  beforeEach(() => {
    flakeService = new FlakeService();
    // Change to fixtures directory for tests
    process.chdir(fixturesPath);
  });

  afterEach(() => {
    // Reset to original directory
    process.chdir(path.join(__dirname, '..', '..'));
  });

  describe('discoverFlakeFiles', () => {
    it('should discover all flake.nix files and their inputs', async () => {
      const flakes = await flakeService.discoverFlakeFiles();
      
      // Should find simple/flake.nix, minimal/flake.nix, subflake/flake.nix and subflake/sub/flake.nix
      expect(flakes.length).toBeGreaterThanOrEqual(4);
      
      // Find the simple flake
      const simpleFlake = flakes.find(f => f.filePath === 'simple/flake.nix');
      expect(simpleFlake).toBeDefined();
      expect(simpleFlake!.inputs).toContain('nixpkgs');
      expect(simpleFlake!.inputs).toContain('flake-utils');
      expect(simpleFlake!.inputs.length).toBe(2);
      
      // Find the root subflake
      const rootSubflake = flakes.find(f => f.filePath === 'subflake/flake.nix');
      expect(rootSubflake).toBeDefined();
      expect(rootSubflake!.inputs).toContain('nixpkgs');
      expect(rootSubflake!.inputs.length).toBe(1);
      
      // Find the nested subflake
      const nestedSubflake = flakes.find(f => f.filePath === 'subflake/sub/flake.nix');
      expect(nestedSubflake).toBeDefined();
      expect(nestedSubflake!.inputs).toContain('nixpkgs');
      expect(nestedSubflake!.inputs).toContain('home-manager');
      expect(nestedSubflake!.inputs.length).toBe(2);
      
      // Find the minimal flake
      const minimalFlake = flakes.find(f => f.filePath === 'minimal/flake.nix');
      expect(minimalFlake).toBeDefined();
      expect(minimalFlake!.inputs).toContain('flake-utils');
      expect(minimalFlake!.inputs.length).toBe(1);
    });

    it('should respect exclude patterns for files', async () => {
      const flakes = await flakeService.discoverFlakeFiles('subflake/**');
      
      // Should exclude all subflake files
      const subflakeFiles = flakes.filter(f => f.filePath.startsWith('subflake/'));
      expect(subflakeFiles.length).toBe(0);
      
      // Should still include simple/flake.nix
      const simpleFlake = flakes.find(f => f.filePath === 'simple/flake.nix');
      expect(simpleFlake).toBeDefined();
    });

    it('should respect exclude patterns for specific inputs', async () => {
      const flakes = await flakeService.discoverFlakeFiles('**/flake.nix#nixpkgs');
      
      // All flakes should still be discovered
      expect(flakes.length).toBeGreaterThanOrEqual(4);
      
      // But nixpkgs should be excluded from all inputs
      for (const flake of flakes) {
        expect(flake.inputs).not.toContain('nixpkgs');
      }
      
      // Other inputs should still be present
      const simpleFlake = flakes.find(f => f.filePath === 'simple/flake.nix');
      expect(simpleFlake!.inputs).toContain('flake-utils');
      
      const nestedSubflake = flakes.find(f => f.filePath === 'subflake/sub/flake.nix');
      expect(nestedSubflake!.inputs).toContain('home-manager');
    });

    it('should handle mixed exclude patterns', async () => {
      const flakes = await flakeService.discoverFlakeFiles('simple/**,subflake/sub/flake.nix#home-manager');
      
      // simple/flake.nix should be completely excluded
      const simpleFlake = flakes.find(f => f.filePath === 'simple/flake.nix');
      expect(simpleFlake).toBeUndefined();
      
      // subflake/sub/flake.nix should exist but without home-manager
      const nestedSubflake = flakes.find(f => f.filePath === 'subflake/sub/flake.nix');
      expect(nestedSubflake).toBeDefined();
      expect(nestedSubflake!.inputs).toContain('nixpkgs');
      expect(nestedSubflake!.inputs).not.toContain('home-manager');
    });
  });

  describe('getFlakeInputs', () => {
    it('should correctly parse inputs from root flake', async () => {
      const flake = { filePath: 'simple/flake.nix', inputs: [], excludedOutputs: [] };
      const inputs = await flakeService.getFlakeInputs(flake);
      
      expect(inputs).toContain('nixpkgs');
      expect(inputs).toContain('flake-utils');
      expect(inputs.length).toBe(2);
    });

    it('should correctly parse inputs from subflake', async () => {
      const flake = { filePath: 'subflake/sub/flake.nix', inputs: [], excludedOutputs: [] };
      const inputs = await flakeService.getFlakeInputs(flake);
      
      expect(inputs).toContain('nixpkgs');
      expect(inputs).toContain('home-manager');
      expect(inputs.length).toBe(2);
    });

    it('should exclude specified outputs', async () => {
      const flake = { filePath: 'simple/flake.nix', inputs: [], excludedOutputs: ['nixpkgs'] };
      const inputs = await flakeService.getFlakeInputs(flake);
      
      expect(inputs).not.toContain('nixpkgs');
      expect(inputs).toContain('flake-utils');
      expect(inputs.length).toBe(1);
    });
  });

  describe('updateFlakeInput', () => {
    let tempDir: string;
    let originalCwd: string;

    beforeEach(async () => {
      // Save original working directory
      originalCwd = process.cwd();
      
      // Create a temporary directory outside the git repo
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flake-update-test-'));
      
      // Copy test files to temp directory
      fs.copyFileSync(
        path.join(fixturesPath, 'minimal/flake.nix'),
        path.join(tempDir, 'flake.nix')
      );
      fs.copyFileSync(
        path.join(fixturesPath, 'minimal/flake.lock'),
        path.join(tempDir, 'flake.lock')
      );
      
      // Initialize git repo in temp directory
      await exec.exec('git', ['init'], { cwd: tempDir });
      await exec.exec('git', ['config', 'user.email', 'test@example.com'], { cwd: tempDir });
      await exec.exec('git', ['config', 'user.name', 'Test User'], { cwd: tempDir });
      await exec.exec('git', ['add', '.'], { cwd: tempDir });
      await exec.exec('git', ['commit', '-m', 'Initial commit'], { cwd: tempDir });
      
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

    it('should update a flake input and modify the lock file', async () => {
      const testFlakePath = 'flake.nix';
      const lockFilePath = path.join(tempDir, 'flake.lock');
      
      // Get the original lock file content
      const originalLockContent = fs.readFileSync(lockFilePath, 'utf8');
      const originalLock = JSON.parse(originalLockContent);
      const originalFlakeUtilsRev = originalLock.nodes['flake-utils'].locked.rev;
      
      // Create a FlakeService instance for the temp directory
      const tempFlakeService = new FlakeService();
      
      // Update flake-utils input
      await tempFlakeService.updateFlakeInput('flake-utils', testFlakePath);
      
      // Check that the lock file was modified
      const updatedLockContent = fs.readFileSync(lockFilePath, 'utf8');
      const updatedLock = JSON.parse(updatedLockContent);
      
      // The lock file should have changed
      expect(updatedLockContent).not.toBe(originalLockContent);
      
      // The flake-utils input should still exist
      expect(updatedLock.nodes['flake-utils']).toBeDefined();
      expect(updatedLock.nodes['flake-utils'].locked.owner).toBe('numtide');
      expect(updatedLock.nodes['flake-utils'].locked.repo).toBe('flake-utils');
      expect(updatedLock.nodes['flake-utils'].locked.rev).toBeDefined();
      expect(updatedLock.nodes['flake-utils'].locked.narHash).toBeDefined();
      
      // The revision should have changed from our old one
      expect(updatedLock.nodes['flake-utils'].locked.rev).not.toBe(originalFlakeUtilsRev);
    }, 30000); // 30 second timeout

    it('should handle updating a non-existent input gracefully', async () => {
      const testFlakePath = 'flake.nix';
      const tempFlakeService = new FlakeService();
      
      // This should not throw an error, just log a warning
      await expect(
        tempFlakeService.updateFlakeInput('nonexistent', testFlakePath)
      ).resolves.not.toThrow();
      
      // The lock file should remain unchanged
      const lockFilePath = path.join(tempDir, 'flake.lock');
      const lockContent = fs.readFileSync(lockFilePath, 'utf8');
      const lock = JSON.parse(lockContent);
      
      // Should still have the same structure
      expect(lock.nodes['flake-utils']).toBeDefined();
      expect(lock.nodes['nonexistent']).toBeUndefined();
    }, 30000); // 30 second timeout
  });
});