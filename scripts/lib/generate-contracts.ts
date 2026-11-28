/**
 * Shared contract-generation utilities.
 */

import { compile, type JSONSchema } from "json-schema-to-typescript";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, "..", "..");
export const SCHEMAS_DIR = path.join(ROOT, "specs", "005-web-control-panel", "contracts");
export const OUTPUT_DIR = path.join(ROOT, "shared", "contracts");

export const SCHEMAS: ReadonlyArray<{ readonly file: string; readonly output: string }> = [
  { file: "run-result.json", output: "run-result.ts" },
  { file: "audit-event.json", output: "audit-event.ts" },
  { file: "chat-tool-call.json", output: "chat-tool-call.ts" },
];

const COMPILE_OPTIONS = {
  bannerComment: "",
  unknownAny: false,
  additionalProperties: false,
  style: { singleQuote: true, printWidth: 100 },
};

interface SchemaBranch {
  properties?: Record<string, { const?: string } & Record<string, unknown>>;
  [key: string]: unknown;
}

interface ContractJsonSchema extends Record<string, unknown> {
  title?: string;
  properties?: Record<string, Record<string, unknown>>;
  oneOf?: SchemaBranch[];
}

function banner(schemaFile: string): string {
  return [
    `// AUTO-GENERATED — do not hand-edit.`,
    `// Source of truth: specs/005-web-control-panel/contracts/${schemaFile}`,
    `// Regenerate:      npm run build:contracts`,
    `// Schema is the source of truth.`,
    ``,
  ].join("\n");
}

function toPascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function detectDiscriminant(schema: ContractJsonSchema): string | null {
  if (!Array.isArray(schema.oneOf) || schema.oneOf.length === 0) return null;
  const first = schema.oneOf[0];
  if (!first?.properties) return null;
  for (const propName of Object.keys(first.properties)) {
    if (first.properties[propName]?.const !== undefined) {
      const allBranchesHaveConst = schema.oneOf.every(
        (b) => b.properties?.[propName]?.const !== undefined,
      );
      if (allBranchesHaveConst) return propName;
    }
  }
  return null;
}

export async function compileSchema(
  schema: Record<string, unknown>,
  schemaFile: string,
): Promise<string> {
  const typedSchema = schema as ContractJsonSchema;
  const title = String(typedSchema.title ?? "GeneratedContract");
  const discriminant = detectDiscriminant(typedSchema);

  if (!discriminant || !typedSchema.oneOf) {
    const ts = await compile(typedSchema as JSONSchema, title, {
      ...COMPILE_OPTIONS,
      bannerComment: banner(schemaFile).trimEnd(),
    });
    return ts;
  }

  const branchSpecificProps = new Set(
    typedSchema.oneOf.flatMap((b) => (b.properties ? Object.keys(b.properties) : [])),
  );

  const baseProperties = typedSchema.properties ?? {};
  const commonProps = Object.fromEntries(
    Object.entries(baseProperties).filter(([k]) => !branchSpecificProps.has(k)),
  );

  const branchOutputs: Array<{ variantName: string; ts: string }> = [];

  for (const branch of typedSchema.oneOf) {
    const discriminantConst = String(branch.properties?.[discriminant]?.const ?? "");
    const variantName = toPascalCase(discriminantConst) + title;

    const { oneOf: _oneOf, ...baseRest } = typedSchema;
    const mergedSchema = {
      ...baseRest,
      title: variantName,
      description: `${title} variant for ${discriminant} = "${discriminantConst}".`,
      properties: {
        ...commonProps,
        ...branch.properties,
        [discriminant]: {
          ...baseProperties[discriminant],
          ...branch.properties?.[discriminant],
        },
      },
    };

    const ts = await compile(mergedSchema as JSONSchema, variantName, COMPILE_OPTIONS);
    branchOutputs.push({ variantName, ts: ts.trim() });
  }

  const variantNames = branchOutputs.map((b) => b.variantName);
  const unionComment = [
    `/**`,
    ` * Discriminated union of all ${title} variants.`,
    ` * Narrow by \`${discriminant}\`: ${variantNames.map((n) => `"${toDiscriminantValue(n, title)}"`).join(" | ")}.`,
    ` */`,
  ].join("\n");

  return [
    banner(schemaFile),
    ...branchOutputs.map((b) => b.ts),
    "",
    unionComment,
    `export type ${title} = ${variantNames.join(" | ")};`,
    "",
  ].join("\n");
}

function toDiscriminantValue(variantName: string, title: string): string {
  const base = variantName.slice(0, variantName.length - title.length);
  return base
    .replace(/([A-Z])/g, (_m, l: string, i: number) => (i > 0 ? "-" : "") + l.toLowerCase())
    .replace(/^-/, "");
}

export async function generateTypes(schemaFile: string): Promise<string> {
  const schemaPath = path.join(SCHEMAS_DIR, schemaFile);
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8")) as Record<string, unknown>;
  return compileSchema(schema, schemaFile);
}
