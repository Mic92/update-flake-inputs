import { FlakeService } from './services/flakeService';
import { GitHubService } from './services/githubService';
export type AutoMergeMethod = "MERGE" | "SQUASH" | "REBASE";
export declare function processFlakeUpdates(flakeService: FlakeService, githubService: GitHubService, excludePatterns: string, baseBranch: string, labels: string[], enableAutoMerge: boolean, autoMergeMethod: AutoMergeMethod, deleteBranchOnMerge: boolean): Promise<void>;
