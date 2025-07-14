export declare class FlakeFileInfo {
    readonly filePath: string;
    readonly excludedOutputs: string[];
    constructor(filePath: string, excludedOutputs?: string[]);
}
export declare class FlakeService {
    discoverFlakeFiles(excludePatterns?: string): Promise<FlakeFileInfo[]>;
    getFlakeInputs(flakeFileInfo: FlakeFileInfo): Promise<string[]>;
    updateFlakeInput(inputName: string, flakeFile: string): Promise<void>;
    getFlakeLockPath(flakeFile: string): Promise<string>;
}
//# sourceMappingURL=flakeService.d.ts.map