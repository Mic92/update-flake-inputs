import * as github from "@actions/github";
export declare class GitHubService {
    private octokit;
    private context;
    constructor(octokit: ReturnType<typeof github.getOctokit>, context: typeof github.context);
    createBranch(branchName: string, baseBranch: string): Promise<void>;
    commitChanges(branchName: string, commitMessage: string): Promise<boolean>;
    createPullRequest(branchName: string, baseBranch: string, title: string, body: string): Promise<void>;
}
