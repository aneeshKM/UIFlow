import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { ArtifactValidator } from "./ArtifactValidator.js";
import type { CapabilityArtifact } from "./types.js";

export class ArtifactStore {
  private readonly directory: string;

  constructor(directory = "artifacts", private readonly validator = new ArtifactValidator()) {
    this.directory = resolve(directory);
  }

  validate(input: unknown): CapabilityArtifact {
    return this.validator.validate(input);
  }

  async save(artifactInput: unknown, filename?: string): Promise<string> {
    const artifact = this.validate(artifactInput);
    const outputName = filename ?? `${artifact.capability.id}.v${artifact.capability.version}.json`;
    const path = this.artifactPath(outputName);
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    await mkdir(this.directory, { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, path);
    return path;
  }

  async load(filename: string): Promise<CapabilityArtifact> {
    const path = this.artifactPath(filename);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(`Artifact file is not valid JSON: ${path}`, { cause: error });
      throw error;
    }
    return this.validate(parsed);
  }

  async list(): Promise<string[]> {
    try {
      return (await readdir(this.directory))
        .filter((filename) => filename.endsWith(".json"))
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private artifactPath(filename: string): string {
    if (basename(filename) !== filename || !filename.endsWith(".json")) {
      throw new Error("Artifact filename must be a plain .json filename without directory components.");
    }
    return join(this.directory, filename);
  }
}
