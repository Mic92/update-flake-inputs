import { FlakeService } from './services/flakeService';
import { GitHubService } from './services/githubService';
export declare function processFlakeUpdates(flakeService: FlakeService, githubService: GitHubService, excludePatterns: string, baseBranch: string, labels: string[], enableAutoMerge: boolean, deleteBranchOnMerge: boolean): Promise<void>;
