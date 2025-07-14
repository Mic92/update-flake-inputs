import * as core from '@actions/core';
import * as github from '@actions/github';
import * as exec from '@actions/exec';
import { FlakeService, FlakeFileInfo } from './services/flakeService';
import { GitHubService } from './services/githubService';

async function run(): Promise<void> {
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
    const githubService = new GitHubService(octokit, context);

    // Discover all flake.nix files
    const flakeFileInfos = await flakeService.discoverFlakeFiles(excludePatterns);
    core.info(`Found ${flakeFileInfos.length} flake.nix files: ${flakeFileInfos.map((f: FlakeFileInfo) => f.filePath).join(', ')}`);

    // Process each flake file
    for (const flakeFileInfo of flakeFileInfos) {
      try {
        core.info(`Processing flake file: ${flakeFileInfo.filePath}`);
        if (flakeFileInfo.excludedOutputs.length > 0) {
          core.info(`Excluded outputs for ${flakeFileInfo.filePath}: ${flakeFileInfo.excludedOutputs.join(', ')}`);
        }
        
        // Get flake inputs for this specific file
        const flakeInputs = await flakeService.getFlakeInputs(flakeFileInfo);
        core.info(`Found ${flakeInputs.length} inputs in ${flakeFileInfo.filePath}: ${flakeInputs.join(', ')}`);

        // Create a pull request for each input
        for (const input of flakeInputs) {
          try {
            core.info(`Processing flake input: ${input} in ${flakeFileInfo.filePath}`);
            
            // Create branch for this input - use simpler name for main flake.nix
            let branchName: string;
            if (flakeFileInfo.filePath === 'flake.nix') {
              branchName = `update-${input}`;
            } else {
              branchName = `update-${input}-${flakeFileInfo.filePath.replace(/[^a-zA-Z0-9]/g, '-')}`;
            }
            
            await githubService.createBranch(branchName, baseBranch);
            
            // Update the specific flake input
            await flakeService.updateFlakeInput(input, flakeFileInfo.filePath);
            
            // Commit changes with appropriate message
            const commitMessage = flakeFileInfo.filePath === 'flake.nix' 
              ? `Update flake input: ${input}`
              : `Update flake input: ${input} in ${flakeFileInfo.filePath}`;
            await githubService.commitChanges(branchName, commitMessage);
            
            // Create pull request with appropriate title and body
            const prTitle = flakeFileInfo.filePath === 'flake.nix'
              ? `Update flake input: ${input}`
              : `Update flake input: ${input} in ${flakeFileInfo.filePath}`;
            const prBody = flakeFileInfo.filePath === 'flake.nix'
              ? `This PR updates the flake input \`${input}\` to the latest version.`
              : `This PR updates the flake input \`${input}\` in \`${flakeFileInfo.filePath}\` to the latest version.`;
            
            await githubService.createPullRequest(
              branchName,
              baseBranch,
              prTitle,
              prBody
            );
            
            core.info(`Successfully created PR for flake input: ${input} in ${flakeFileInfo.filePath}`);
          } catch (error) {
            core.error(`Failed to process flake input ${input} in ${flakeFileInfo.filePath}: ${error}`);
            // Continue with other inputs even if one fails
          }
        }
      } catch (error) {
        core.error(`Failed to process flake file ${flakeFileInfo.filePath}: ${error}`);
        // Continue with other flake files even if one fails
      }
    }
  } catch (error) {
    core.setFailed(`Action failed: ${error}`);
  }
}

run();
