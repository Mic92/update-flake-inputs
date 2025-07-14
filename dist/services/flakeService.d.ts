export declare class Flake {
    readonly filePath: string;
    readonly inputs: string[];
    readonly excludedOutputs: string[];
    constructor(filePath: string, inputs?: string[], excludedOutputs?: string[]);
}
export declare class FlakeService {
    discoverFlakeFiles(excludePatterns?: string): Promise<Flake[]>;
    getFlakeInputs(flake: Flake): Promise<string[]>;
    updateFlakeInput(inputName: string, flakeFile: string): Promise<void>;
    getFlakeLockPath(flakeFile: string): Promise<string>;
}
