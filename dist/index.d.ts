import { FlakeService } from './services/flakeService.js';
import { GitHubService } from './services/githubService.js';
export type AutoMergeMethod = "MERGE" | "SQUASH" | "REBASE";
export declare function processFlakeUpdates(flakeService: FlakeService, githubService: GitHubService, excludePatterns: string, baseBranch: string, labels: string[], enableAutoMerge: boolean, autoMergeMethod: AutoMergeMethod, deleteBranchOnMerge: boolean, commitMessageTemplate: string): Promise<void>;
