import * as exec from "@actions/exec";
import * as core from "@actions/core";
import * as fs from "fs";
import * as path from "path";
import * as glob from "glob";

export class FlakeFileInfo {
  constructor(
    public readonly filePath: string,
    public readonly excludedOutputs: string[] = [],
  ) {}
}

export class FlakeService {
  async discoverFlakeFiles(excludePatterns = ""): Promise<FlakeFileInfo[]> {
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

      const flakeFileInfos: FlakeFileInfo[] = [];

      for (const file of allFlakeFiles) {
        // Check if this file should be completely excluded
        const shouldExcludeFile = excludeList.some((pattern) => {
          const [filePattern, outputName] = pattern.split("#");
          // Only exclude the file if there's no output name specified
          if (!outputName) {
            const regex = new RegExp(
              filePattern.replace(/\*/g, ".*").replace(/\?/g, "."),
            );
            return regex.test(file);
          }
          return false;
        });

        if (!shouldExcludeFile) {
          // Collect excluded outputs for this file
          const excludedOutputs = excludeList
            .filter((pattern) => {
              const [filePattern, outputName] = pattern.split("#");
              if (outputName) {
                const regex = new RegExp(
                  filePattern.replace(/\*/g, ".*").replace(/\?/g, "."),
                );
                return regex.test(file);
              }
              return false;
            })
            .map((pattern) => pattern.split("#")[1]);

          flakeFileInfos.push(new FlakeFileInfo(file, excludedOutputs));
        }
      }

      core.info(`Found ${flakeFileInfos.length} flake files after exclusions`);
      return flakeFileInfos;
    } catch (error) {
      throw new Error(`Failed to discover flake files: ${error}`);
    }
  }

  async getFlakeInputs(flakeFileInfo: FlakeFileInfo): Promise<string[]> {
    try {
      // Read flake.nix file
      const flakeContent = fs.readFileSync(flakeFileInfo.filePath, "utf8");

      // Parse inputs from flake.nix
      const inputsRegex = /inputs\s*=\s*{([^}]+)}/s;
      const match = flakeContent.match(inputsRegex);

      if (!match) {
        core.warning(`No inputs section found in ${flakeFileInfo.filePath}`);
        return [];
      }

      const inputsSection = match[1];
      const inputNames: string[] = [];

      // Extract input names (simplified parsing)
      const lines = inputsSection.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
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
    } catch (error) {
      throw new Error(
        `Failed to parse flake inputs from ${flakeFileInfo.filePath}: ${error}`,
      );
    }
  }

  async updateFlakeInput(inputName: string, flakeFile: string): Promise<void> {
    try {
      core.info(`Updating flake input: ${inputName} in ${flakeFile}`);

      const flakeDir = path.dirname(flakeFile);

      // Use nix flake update to update specific input
      await exec.exec("nix", ["flake", "update", inputName], {
        cwd: flakeDir,
      });

      core.info(
        `Successfully updated flake input: ${inputName} in ${flakeFile}`,
      );
    } catch (error) {
      throw new Error(
        `Failed to update flake input ${inputName} in ${flakeFile}: ${error}`,
      );
    }
  }

  async getFlakeLockPath(flakeFile: string): Promise<string> {
    const flakeDir = path.dirname(flakeFile);
    return path.join(flakeDir, "flake.lock");
  }
}
