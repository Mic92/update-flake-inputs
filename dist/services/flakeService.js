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
exports.FlakeService = exports.Flake = void 0;
const exec = __importStar(require("@actions/exec"));
const core = __importStar(require("@actions/core"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const glob = __importStar(require("glob"));
class Flake {
    filePath;
    inputs;
    excludedOutputs;
    constructor(filePath, inputs = [], excludedOutputs = []) {
        this.filePath = filePath;
        this.inputs = inputs;
        this.excludedOutputs = excludedOutputs;
    }
}
exports.Flake = Flake;
class FlakeService {
    async discoverFlakeFiles(excludePatterns = "") {
        try {
            // Find all flake.nix files in the repository
            const allFlakeFiles = glob.sync("**/flake.nix", {
                ignore: ["node_modules/**", ".git/**"],
                dot: false,
            });
            const excludeList = excludePatterns
                ? excludePatterns.split(",").map((pattern) => pattern.trim())
                : [];
            core.info(`Exclude patterns: ${excludeList.join(", ")}`);
            const flakes = [];
            for (const file of allFlakeFiles) {
                // Check if this file should be completely excluded
                const shouldExcludeFile = excludeList.some((pattern) => {
                    const [filePattern, outputName] = pattern.split("#");
                    // Only exclude the file if there's no output name specified
                    if (!outputName) {
                        const regex = new RegExp(filePattern.replace(/\*/g, ".*").replace(/\?/g, "."));
                        return regex.test(file);
                    }
                    return false;
                });
                if (!shouldExcludeFile) {
                    // Check if lock file exists
                    const lockFilePath = await this.getFlakeLockPath(file);
                    if (!fs.existsSync(lockFilePath)) {
                        core.info(`Skipping ${file} - no lock file found at ${lockFilePath}`);
                        continue;
                    }
                    // Collect excluded outputs for this file
                    const excludedOutputs = excludeList
                        .filter((pattern) => {
                        const [filePattern, outputName] = pattern.split("#");
                        if (outputName) {
                            const regex = new RegExp(filePattern.replace(/\*/g, ".*").replace(/\?/g, "."));
                            return regex.test(file);
                        }
                        return false;
                    })
                        .map((pattern) => pattern.split("#")[1]);
                    // Get inputs for this flake
                    const tempFlake = new Flake(file, [], excludedOutputs);
                    const inputs = await this.getFlakeInputs(tempFlake);
                    flakes.push(new Flake(file, inputs, excludedOutputs));
                }
            }
            core.info(`Found ${flakes.length} flake files after exclusions`);
            return flakes;
        }
        catch (error) {
            throw new Error(`Failed to discover flake files: ${error}`);
        }
    }
    async getFlakeInputs(flake) {
        try {
            const flakeDir = path.dirname(flake.filePath);
            // Use nix flake metadata to get inputs
            const output = await exec.getExecOutput("nix", ["flake", "metadata", "--json", "--no-write-lock-file"], {
                cwd: flakeDir,
                silent: true,
            });
            if (output.exitCode !== 0) {
                throw new Error(`nix flake metadata failed for ${flake.filePath}: ${output.stderr}`);
            }
            const metadata = JSON.parse(output.stdout);
            const inputNames = [];
            // Extract input names from the locks section
            if (metadata.locks && metadata.locks.nodes) {
                for (const nodeName of Object.keys(metadata.locks.nodes)) {
                    // Skip the root node
                    if (nodeName === "root")
                        continue;
                    // Check if this is a direct input of root
                    const rootNode = metadata.locks.nodes.root;
                    if (rootNode && rootNode.inputs && rootNode.inputs[nodeName]) {
                        inputNames.push(nodeName);
                    }
                }
            }
            core.info(`Found inputs in ${flake.filePath}: ${inputNames.join(", ")}`);
            // Filter out excluded outputs for this specific file
            const filteredInputs = inputNames.filter((inputName) => {
                return !flake.excludedOutputs.includes(inputName);
            });
            return filteredInputs;
        }
        catch (error) {
            throw new Error(`Failed to parse flake inputs from ${flake.filePath}: ${error}`);
        }
    }
    async updateFlakeInput(inputName, flakeFile, workDir) {
        try {
            core.info(`Updating flake input: ${inputName} in ${flakeFile}`);
            // If workDir is provided, resolve the flake file relative to it
            const absoluteFlakePath = workDir
                ? path.join(workDir, flakeFile)
                : flakeFile;
            const flakeDir = path.dirname(absoluteFlakePath);
            // Use nix flake update to update specific input
            await exec.exec("nix", ["flake", "update", inputName], {
                cwd: flakeDir,
            });
            core.info(`Successfully updated flake input: ${inputName} in ${flakeFile}`);
        }
        catch (error) {
            throw new Error(`Failed to update flake input ${inputName} in ${flakeFile}: ${error}`);
        }
    }
    async getFlakeLockPath(flakeFile) {
        const flakeDir = path.dirname(flakeFile);
        return path.join(flakeDir, "flake.lock");
    }
}
exports.FlakeService = FlakeService;
//# sourceMappingURL=flakeService.js.map