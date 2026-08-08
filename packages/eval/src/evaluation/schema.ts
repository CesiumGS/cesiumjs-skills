/** JSON-Schema (Draft-07) validation matching the Python jsonschema usage. */
import { Ajv, type ValidateFunction } from "ajv";
import { readJson } from "../lib/json.js";
import { fromRepoRoot } from "../lib/paths.js";

export const SCHEMAS_ROOT = () => fromRepoRoot("evaluation", "schemas");

function newAjv(): Ajv {
  return new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
}

export interface SchemaError {
  location: string;
  message: string;
}

function formatErrors(validate: ValidateFunction): SchemaError[] {
  const errors = validate.errors ?? [];
  const out: SchemaError[] = errors.map((error) => {
    const location = error.instancePath.split("/").filter(Boolean).join(".") || "<root>";
    const message = error.message ?? "invalid";
    return { location, message: error.keyword === "additionalProperties" ? `${message} (${JSON.stringify(error.params)})` : message };
  });
  out.sort((a, b) => (a.location < b.location ? -1 : a.location > b.location ? 1 : 0));
  return out;
}

export class SchemaValidator {
  private validateFn: ValidateFunction;

  constructor(schema: Record<string, any>) {
    this.validateFn = newAjv().compile(schema);
  }

  errors(value: unknown): SchemaError[] {
    if (this.validateFn(value)) return [];
    return formatErrors(this.validateFn);
  }
}

/** Scorecard schema with the cross-file check_result $ref spliced inline. */
export function loadScorecardValidator(): SchemaValidator {
  const schema = readJson(`${SCHEMAS_ROOT()}/scorecard.schema.json`);
  const resultSchema = readJson(`${SCHEMAS_ROOT()}/result.schema.json`);
  schema.definitions.case_result.properties.checks.items = resultSchema.definitions.check_result;
  return new SchemaValidator(schema);
}

export function loadVisualReviewValidator(): SchemaValidator {
  return new SchemaValidator(readJson(`${SCHEMAS_ROOT()}/visual-review.schema.json`));
}

/** Case schema with per-check validation delegated to check.schema.json. */
export function loadCaseValidator(): SchemaValidator {
  const schema = readJson(`${SCHEMAS_ROOT()}/case.schema.json`);
  schema.properties.checks.items = { type: "object" };
  return new SchemaValidator(schema);
}

export function loadCheckValidator(): SchemaValidator {
  return new SchemaValidator(readJson(`${SCHEMAS_ROOT()}/check.schema.json`));
}

export function loadEvidenceValidator(): SchemaValidator {
  return new SchemaValidator(readJson(`${SCHEMAS_ROOT()}/evidence.schema.json`));
}

/**
 * Validator for a single `CaseResult` as emitted by `runCase`.
 *
 * `result.schema.json` was previously only compiled and asserted as a
 * well-formed schema; nothing ever validated a real result against it.
 * `verify-fixtures` does, which is what closes the corresponding hardened
 * acceptance criterion in evaluation/docs/deterministic-evaluation-plan.md.
 */
export function loadResultValidator(): SchemaValidator {
  return new SchemaValidator(readJson(`${SCHEMAS_ROOT()}/result.schema.json`));
}

/** `Draft7Validator.check_schema` analog: throws when the schema is invalid. */
export function assertValidSchema(name: string, schema: Record<string, any>): void {
  try {
    newAjv().compile(structuredClone(schema));
  } catch (exc: any) {
    throw new Error(`${name}: invalid JSON schema: ${exc.message}`);
  }
}
