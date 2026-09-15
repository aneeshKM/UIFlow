import type { InputDefinition, StepValue } from "../artifact/types.js";
import type { RuntimeInputs } from "./types.js";

const TEMPLATE_REFERENCE = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;

export class InputValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Runtime inputs are invalid:\n- ${issues.join("\n- ")}`);
    this.name = "InputValidationError";
  }
}

export class InputResolver {
  validate(definitions: InputDefinition[], runtimeInputs: RuntimeInputs): void {
    if (runtimeInputs === null || Array.isArray(runtimeInputs) || typeof runtimeInputs !== "object") {
      throw new InputValidationError(["runtime inputs must be an object"]);
    }

    const issues: string[] = [];
    const definitionsByName = new Map(definitions.map((definition) => [definition.name, definition]));

    for (const name of Object.keys(runtimeInputs)) {
      if (!definitionsByName.has(name)) issues.push(`unknown input "${name}"`);
    }

    for (const definition of definitions) {
      const present = Object.prototype.hasOwnProperty.call(runtimeInputs, definition.name);
      if (!present) {
        if (definition.required) issues.push(`required input "${definition.name}" is missing`);
        continue;
      }

      const value = runtimeInputs[definition.name];
      if (definition.type === "string" && typeof value !== "string") {
        issues.push(`input "${definition.name}" must be a string`);
      }
    }

    if (issues.length > 0) throw new InputValidationError(issues);
  }

  resolve(value: StepValue, runtimeInputs: RuntimeInputs, definitions: InputDefinition[]): string {
    const definitionsByName = new Map(definitions.map((definition) => [definition.name, definition]));

    if ("literal" in value) return value.literal;

    if ("input" in value) {
      return this.resolveReference(value.input, runtimeInputs, definitionsByName);
    }

    return value.template.replace(TEMPLATE_REFERENCE, (_match, name: string) =>
      this.resolveReference(name, runtimeInputs, definitionsByName));
  }

  private resolveReference(
    name: string,
    runtimeInputs: RuntimeInputs,
    definitions: Map<string, InputDefinition>,
  ): string {
    const definition = definitions.get(name);
    if (!definition) throw new InputValidationError([`unknown input "${name}"`]);
    if (!Object.prototype.hasOwnProperty.call(runtimeInputs, name)) {
      throw new InputValidationError([`input "${name}" is missing`]);
    }

    const value = runtimeInputs[name];
    if (definition.type === "string" && typeof value !== "string") {
      throw new InputValidationError([`input "${name}" must be a string`]);
    }
    return value as string;
  }
}

