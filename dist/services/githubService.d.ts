import * as github from "@actions/github";
export interface GitConfig {
    authorName: string;
    authorEmail: string;
    committerName: string;
    committerEmail: string;
    signoff: boolean;
}
export declare class GitHubService {
    private octokit;
    private context;
    private worktreesDir;
    private gitConfig;
    constructor(octokit: ReturnType<typeof github.getOctokit>, context: typeof github.context, gitConfig: GitConfig);
    createBranch(branchName: string, baseBranch: string): Promise<string>;
    commitChanges(branchName: string, commitMessage: string, worktreePath: string): Promise<boolean>;
    ensureLabelsExist(labels: string[]): Promise<void>;
    enableAutoMerge(pullRequestNodeId: string, pullRequestNumber: number, headSha: string, mergeMethod: "MERGE" | "SQUASH" | "REBASE"): Promise<boolean>;
    createPullRequest(branchName: string, baseBranch: string, title: string, body: string, labels?: string[], enableAutoMerge?: boolean, autoMergeMethod?: "MERGE" | "SQUASH" | "REBASE", deleteBranchOnMerge?: boolean): Promise<void>;
    cleanupWorktree(worktreePath: string): Promise<void>;
    cleanupAllWorktrees(): Promise<void>;
}
