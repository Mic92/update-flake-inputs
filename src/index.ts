import * as core from '@actions/core';
import * as github from '@actions/github';
import * as exec from '@actions/exec';
import { FlakeService, Flake } from './services/flakeService';
import { GitHubService } from './services/githubService';

export async function processFlakeUpdates(
  flakeService: FlakeService,
  githubService: GitHubService,
  excludePatterns: string,
  baseBranch: string
): Promise<void> {

    // Discover all flake.nix files
    const flakes = await flakeService.discoverFlakeFiles(excludePatterns);
    core.info(`Found ${flakes.length} flake.nix files: ${flakes.map((f: Flake) => f.filePath).join(', ')}`);

    // Process each flake file
    for (const flake of flakes) {
      try {
        core.info(`Processing flake file: ${flake.filePath}`);
        if (flake.excludedOutputs.length > 0) {
          core.info(`Excluded outputs for ${flake.filePath}: ${flake.excludedOutputs.join(', ')}`);
        }
        
        // Inputs are already populated from discoverFlakeFiles
        core.info(`Found ${flake.inputs.length} inputs in ${flake.filePath}: ${flake.inputs.join(', ')}`);

        // Create a pull request for each input
        for (const input of flake.inputs) {
          try {
            core.info(`Processing flake input: ${input} in ${flake.filePath}`);
            
            // Create branch for this input - use simpler name for main flake.nix
            let branchName: string;
            if (flake.filePath === 'flake.nix') {
              branchName = `update-${input}`;
            } else {
              branchName = `update-${input}-${flake.filePath.replace(/[^a-zA-Z0-9]/g, '-')}`;
            }
            
            const worktreePath = await githubService.createBranch(branchName, baseBranch);
            
            try {
              // Update the specific flake input in the worktree
              await flakeService.updateFlakeInput(input, flake.filePath, worktreePath);
              
              // Commit changes with appropriate message
              const commitMessage = flake.filePath === 'flake.nix' 
                ? `Update flake input: ${input}`
                : `Update flake input: ${input} in ${flake.filePath}`;
              const hasChanges = await githubService.commitChanges(branchName, commitMessage, worktreePath);
              
              if (hasChanges) {
                // Create pull request with appropriate title and body
                const prTitle = flake.filePath === 'flake.nix'
                  ? `Update flake input: ${input}`
                  : `Update flake input: ${input} in ${flake.filePath}`;
                const prBody = flake.filePath === 'flake.nix'
                  ? `This PR updates the flake input \`${input}\` to the latest version.`
                  : `This PR updates the flake input \`${input}\` in \`${flake.filePath}\` to the latest version.`;
                
                await githubService.createPullRequest(
                  branchName,
                  baseBranch,
                  prTitle,
                  prBody
                );
                
                core.info(`Successfully created PR for flake input: ${input} in ${flake.filePath}`);
              } else {
                core.info(`No changes detected for flake input: ${input} in ${flake.filePath} - skipping PR creation`);
              }
            } finally {
              // Clean up the worktree
              await githubService.cleanupWorktree(worktreePath);
            }
          } catch (error) {
            core.error(`Failed to process flake input ${input} in ${flake.filePath}: ${error}`);
            // Continue with other inputs even if one fails
          }
        }
      } catch (error) {
        core.error(`Failed to process flake file ${flake.filePath}: ${error}`);
        // Continue with other flake files even if one fails
      }
    }
}

async function run(): Promise<void> {
  let githubService: GitHubService | undefined;
  
  try {
    // Get inputs
    const githubToken = core.getInput('github-token', { required: true });
    const excludePatterns = core.getInput('exclude-patterns') || '';
    
    // Auto-detect the current branch
    let baseBranch = 'main'; // fallback
    try {
      let output = '';
      await exec.exec('git', ['branch', '--show-current'], {
        listeners: {
          stdout: (data: Buffer) => {
            output += data.toString();
          }
        }
      });
      baseBranch = output.trim();
      core.info(`Auto-detected base branch: ${baseBranch}`);
    } catch (error) {
      core.warning(`Failed to auto-detect branch, using fallback 'main': ${error}`);
    }

    const octokit = github.getOctokit(githubToken);
    const context = github.context;

    const flakeService = new FlakeService();
    githubService = new GitHubService(octokit, context);

    await processFlakeUpdates(flakeService, githubService, excludePatterns, baseBranch);
  } catch (error) {
    core.setFailed(`Action failed: ${error}`);
  } finally {
    // Clean up all worktrees at the end
    if (githubService) {
      await githubService.cleanupAllWorktrees();
    }
  }
}

run();
