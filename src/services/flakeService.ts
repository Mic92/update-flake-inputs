import * as exec from "@actions/exec";
import * as core from "@actions/core";
import * as path from "path";
import * as glob from "glob";

export class Flake {
  constructor(
    public readonly filePath: string,
    public readonly inputs: string[] = [],
    public readonly excludedOutputs: string[] = [],
  ) {}
}

export class FlakeService {
  async discoverFlakeFiles(excludePatterns = ""): Promise<Flake[]> {
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

      const flakes: Flake[] = [];

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

          // Get inputs for this flake
          const tempFlake = new Flake(file, [], excludedOutputs);
          const inputs = await this.getFlakeInputs(tempFlake);

          flakes.push(new Flake(file, inputs, excludedOutputs));
        }
      }

      core.info(`Found ${flakes.length} flake files after exclusions`);
      return flakes;
    } catch (error) {
      throw new Error(`Failed to discover flake files: ${error}`);
    }
  }

  async getFlakeInputs(flake: Flake): Promise<string[]> {
    try {
      const flakeDir = path.dirname(flake.filePath);

      // Use nix flake metadata to get inputs
      const output = await exec.getExecOutput(
        "nix",
        ["flake", "metadata", "--json", "--no-write-lock-file"],
        {
          cwd: flakeDir,
          silent: true,
        },
      );

      if (output.exitCode !== 0) {
        throw new Error(
          `nix flake metadata failed for ${flake.filePath}: ${output.stderr}`,
        );
      }

      const metadata = JSON.parse(output.stdout);
      const inputNames: string[] = [];

      // Extract input names from the locks section
      if (metadata.locks && metadata.locks.nodes) {
        for (const nodeName of Object.keys(metadata.locks.nodes)) {
          // Skip the root node
          if (nodeName === "root") continue;

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
    } catch (error) {
      throw new Error(
        `Failed to parse flake inputs from ${flake.filePath}: ${error}`,
      );
    }
  }

  async updateFlakeInput(
    inputName: string,
    flakeFile: string,
    workDir?: string,
  ): Promise<void> {
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
