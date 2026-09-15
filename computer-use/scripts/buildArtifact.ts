import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { DiscoveryRun } from "../src/agent/types.js";
import { ArtifactBuilder } from "../src/artifact/ArtifactBuilder.js";
import { ArtifactStore } from "../src/artifact/ArtifactStore.js";

async function main(): Promise<void> {
  const [evidencePath, ...extraArguments] = process.argv.slice(2);
  if (evidencePath === undefined || extraArguments.length > 0) {
    throw new Error("Usage: npm run artifact:build -- <discovery-evidence.json>");
  }

  let input: unknown;
  try {
    input = JSON.parse(await readFile(evidencePath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Discovery evidence is not valid JSON: ${evidencePath}`, { cause: error });
    throw error;
  }

  const artifact = new ArtifactBuilder().build(input as DiscoveryRun);
  const path = await new ArtifactStore().save(artifact);
  console.log(`Built ${artifact.capability.id} v${artifact.capability.version} from ${basename(evidencePath)}.`);
  console.log(path);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
