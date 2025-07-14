"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const exec = __importStar(require("@actions/exec"));
const flakeService_1 = require("./services/flakeService");
const githubService_1 = require("./services/githubService");
async function run() {
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
                    stdout: (data) => {
                        output += data.toString();
                    }
                }
            });
            baseBranch = output.trim();
            core.info(`Auto-detected base branch: ${baseBranch}`);
        }
        catch (error) {
            core.warning(`Failed to auto-detect branch, using fallback 'main': ${error}`);
        }
        const octokit = github.getOctokit(githubToken);
        const context = github.context;
        const flakeService = new flakeService_1.FlakeService();
        const githubService = new githubService_1.GitHubService(octokit, context);
        // Discover all flake.nix files
        const flakeFileInfos = await flakeService.discoverFlakeFiles(excludePatterns);
        core.info(`Found ${flakeFileInfos.length} flake.nix files: ${flakeFileInfos.map((f) => f.filePath).join(', ')}`);
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
                        let branchName;
                        if (flakeFileInfo.filePath === 'flake.nix') {
                            branchName = `update-${input}`;
                        }
                        else {
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
                        await githubService.createPullRequest(branchName, baseBranch, prTitle, prBody);
                        core.info(`Successfully created PR for flake input: ${input} in ${flakeFileInfo.filePath}`);
                    }
                    catch (error) {
                        core.error(`Failed to process flake input ${input} in ${flakeFileInfo.filePath}: ${error}`);
                        // Continue with other inputs even if one fails
                    }
                }
            }
            catch (error) {
                core.error(`Failed to process flake file ${flakeFileInfo.filePath}: ${error}`);
                // Continue with other flake files even if one fails
            }
        }
    }
    catch (error) {
        core.setFailed(`Action failed: ${error}`);
    }
}
run();
//# sourceMappingURL=index.js.map