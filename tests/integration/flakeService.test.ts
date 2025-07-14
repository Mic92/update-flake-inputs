import { FlakeService } from '../../src/services/flakeService';
import * as path from 'path';
import * as fs from 'fs';
import * as exec from '@actions/exec';

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
      
      // Should find both simple/flake.nix and subflake/flake.nix and subflake/sub/flake.nix
      expect(flakes.length).toBeGreaterThanOrEqual(3);
      
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
      expect(flakes.length).toBeGreaterThanOrEqual(3);
      
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
    beforeEach(async () => {
      // Create a copy of the simple flake for testing updates
      const testUpdateDir = path.join(fixturesPath, 'test-update');
      if (fs.existsSync(testUpdateDir)) {
        fs.rmSync(testUpdateDir, { recursive: true });
      }
      fs.mkdirSync(testUpdateDir);
      
      // Copy flake.nix and flake.lock
      fs.copyFileSync(
        path.join(fixturesPath, 'simple/flake.nix'),
        path.join(testUpdateDir, 'flake.nix')
      );
      fs.copyFileSync(
        path.join(fixturesPath, 'simple/flake.lock'),
        path.join(testUpdateDir, 'flake.lock')
      );
    });

    afterEach(() => {
      // Clean up test directory
      const testUpdateDir = path.join(fixturesPath, 'test-update');
      if (fs.existsSync(testUpdateDir)) {
        fs.rmSync(testUpdateDir, { recursive: true });
      }
    });

    it('should update a flake input and modify the lock file', async () => {
      const testFlakePath = 'test-update/flake.nix';
      const lockFilePath = path.join(fixturesPath, 'test-update/flake.lock');
      
      // Get the original lock file content
      const originalLockContent = fs.readFileSync(lockFilePath, 'utf8');
      const originalLock = JSON.parse(originalLockContent);
      const originalNixpkgsRev = originalLock.nodes.nixpkgs.locked.rev;
      
      // Update nixpkgs input
      await flakeService.updateFlakeInput('nixpkgs', testFlakePath);
      
      // Check that the lock file was modified
      const updatedLockContent = fs.readFileSync(lockFilePath, 'utf8');
      const updatedLock = JSON.parse(updatedLockContent);
      
      // The lock file should have changed
      expect(updatedLockContent).not.toBe(originalLockContent);
      
      // The nixpkgs input should still exist
      expect(updatedLock.nodes.nixpkgs).toBeDefined();
      
      // The structure should be maintained
      expect(updatedLock.nodes.nixpkgs.locked.owner).toBe('NixOS');
      expect(updatedLock.nodes.nixpkgs.locked.repo).toBe('nixpkgs');
      
      // Since we're updating to latest, the rev might have changed
      // (or might be the same if it was already latest)
      expect(updatedLock.nodes.nixpkgs.locked.rev).toBeDefined();
      expect(updatedLock.nodes.nixpkgs.locked.narHash).toBeDefined();
    });

    it('should handle updating a non-existent input gracefully', async () => {
      const testFlakePath = 'test-update/flake.nix';
      
      // This should throw an error since 'nonexistent' is not a valid input
      await expect(
        flakeService.updateFlakeInput('nonexistent', testFlakePath)
      ).rejects.toThrow(/Failed to update flake input nonexistent/);
    });
  });
});