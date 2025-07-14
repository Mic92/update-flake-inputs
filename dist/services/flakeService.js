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
exports.FlakeService = exports.FlakeFileInfo = void 0;
const exec = __importStar(require("@actions/exec"));
const core = __importStar(require("@actions/core"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const glob = __importStar(require("glob"));
class FlakeFileInfo {
    constructor(filePath, excludedOutputs = []) {
        this.filePath = filePath;
        this.excludedOutputs = excludedOutputs;
    }
}
exports.FlakeFileInfo = FlakeFileInfo;
class FlakeService {
    async discoverFlakeFiles(excludePatterns = '') {
        try {
            // Find all flake.nix files in the repository
            const allFlakeFiles = glob.sync('**/flake.nix', {
                ignore: ['node_modules/**', '.git/**'],
                dot: false,
            });
            const excludeList = excludePatterns
                ? excludePatterns.split(',').map((pattern) => pattern.trim())
                : [];
            core.info(`Exclude patterns: ${excludeList.join(', ')}`);
            const flakeFileInfos = [];
            for (const file of allFlakeFiles) {
                // Check if this file should be completely excluded
                const shouldExcludeFile = excludeList.some((pattern) => {
                    const [filePattern, outputName] = pattern.split('#');
                    // Only exclude the file if there's no output name specified
                    if (!outputName) {
                        const regex = new RegExp(filePattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
                        return regex.test(file);
                    }
                    return false;
                });
                if (!shouldExcludeFile) {
                    // Collect excluded outputs for this file
                    const excludedOutputs = excludeList
                        .filter((pattern) => {
                        const [filePattern, outputName] = pattern.split('#');
                        if (outputName) {
                            const regex = new RegExp(filePattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
                            return regex.test(file);
                        }
                        return false;
                    })
                        .map((pattern) => pattern.split('#')[1]);
                    flakeFileInfos.push(new FlakeFileInfo(file, excludedOutputs));
                }
            }
            core.info(`Found ${flakeFileInfos.length} flake files after exclusions`);
            return flakeFileInfos;
        }
        catch (error) {
            throw new Error(`Failed to discover flake files: ${error}`);
        }
    }
    async getFlakeInputs(flakeFileInfo) {
        try {
            // Read flake.nix file
            const flakeContent = fs.readFileSync(flakeFileInfo.filePath, 'utf8');
            // Parse inputs from flake.nix
            const inputsRegex = /inputs\s*=\s*{([^}]+)}/s;
            const match = flakeContent.match(inputsRegex);
            if (!match) {
                core.warning(`No inputs section found in ${flakeFileInfo.filePath}`);
                return [];
            }
            const inputsSection = match[1];
            const inputNames = [];
            // Extract input names (simplified parsing)
            const lines = inputsSection.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    const nameMatch = trimmed.match(/^(\w+)\s*=/);
                    if (nameMatch) {
                        inputNames.push(nameMatch[1]);
                    }
                }
            }
            // Filter out excluded outputs for this specific file
            const filteredInputs = inputNames.filter((inputName) => {
                return !flakeFileInfo.excludedOutputs.includes(inputName);
            });
            return filteredInputs;
        }
        catch (error) {
            throw new Error(`Failed to parse flake inputs from ${flakeFileInfo.filePath}: ${error}`);
        }
    }
    async updateFlakeInput(inputName, flakeFile) {
        try {
            core.info(`Updating flake input: ${inputName} in ${flakeFile}`);
            const flakeDir = path.dirname(flakeFile);
            // Use nix flake update to update specific input
            await exec.exec('nix', ['flake', 'update', inputName], {
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
        return path.join(flakeDir, 'flake.lock');
    }
}
exports.FlakeService = FlakeService;
//# sourceMappingURL=flakeService.js.map