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
exports.GitHubService = void 0;
const exec = __importStar(require("@actions/exec"));
const core = __importStar(require("@actions/core"));
class GitHubService {
    octokit;
    context;
    constructor(octokit, context) {
        this.octokit = octokit;
        this.context = context;
    }
    async createBranch(branchName, baseBranch) {
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
            }
            catch {
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
        }
        catch (error) {
            throw new Error(`Failed to create branch ${branchName}: ${error}`);
        }
    }
    async commitChanges(branchName, commitMessage) {
        try {
            // Add all changes
            await exec.exec("git", ["add", "."]);
            // Check if there are changes to commit
            const exitCode = await exec.exec("git", ["diff", "--cached", "--quiet"], {
                ignoreReturnCode: true,
                listeners: {
                    stdout: () => { },
                    stderr: () => { },
                },
            });
            // Exit code 0 = no changes, exit code 1 = has changes
            const hasChanges = exitCode !== 0;
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
        }
        catch (error) {
            throw new Error(`Failed to commit changes: ${error}`);
        }
    }
    async createPullRequest(branchName, baseBranch, title, body) {
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
        }
        catch (error) {
            throw new Error(`Failed to create pull request: ${error}`);
        }
    }
}
exports.GitHubService = GitHubService;
//# sourceMappingURL=githubService.js.map