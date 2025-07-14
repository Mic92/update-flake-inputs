import * as github from "@actions/github";
export declare class GitHubService {
    private octokit;
    private context;
    private worktreesDir;
    constructor(octokit: ReturnType<typeof github.getOctokit>, context: typeof github.context);
    createBranch(branchName: string, baseBranch: string): Promise<string>;
    commitChanges(branchName: string, commitMessage: string, worktreePath: string): Promise<boolean>;
    createPullRequest(branchName: string, baseBranch: string, title: string, body: string): Promise<void>;
    cleanupWorktree(worktreePath: string): Promise<void>;
    cleanupAllWorktrees(): Promise<void>;
}
