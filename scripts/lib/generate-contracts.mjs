/**
 * Shared contract-generation utilities.
 *
 * Low-level: compileSchema(schema, schemaFile) → Promise<string>
 * High-level: generateTypes(schemaFile)        → Promise<string>
 *
 * Handles two patterns:
 *  1. Simple flat schemas          → compile with json-schema-to-typescript directly.
 *  2. Discriminated-oneOf schemas  → build per-branch schemas, compile each, then
 *                                    emit a proper discriminated-union type alias.
 *     Detection heuristic: top-level oneOf where every branch has at least one
 *     property with a const value (the discriminant).
 */

import { compile } from 'json-schema-to-typescript';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..', '..');
export const SCHEMAS_DIR = path.join(ROOT, 'specs', '005-web-control-panel', 'contracts');
export const OUTPUT_DIR = path.join(ROOT, 'shared', 'contracts');

export const SCHEMAS = [
  { file: 'run-result.json', output: 'run-result.ts' },
  { file: 'audit-event.json', output: 'audit-event.ts' },
  { file: 'chat-tool-call.json', output: 'chat-tool-call.ts' },
];

/** Options forwarded to json-schema-to-typescript for every compile call. */
const COMPILE_OPTIONS = {
  bannerComment: '', // we inject our own banner below
  unknownAny: false,
  additionalProperties: false,
  style: { singleQuote: true, printWidth: 100 },
};

function banner(schemaFile) {
  return [
    `// AUTO-GENERATED — do not hand-edit.`,
    `// Source of truth: specs/005-web-control-panel/contracts/${schemaFile}`,
    `// Regenerate:      npm run build:contracts`,
    `// Schema is the source of truth.`,
    ``,
  ].join('\n');
}

/** "discord-monitor" → "DiscordMonitor", "refresh-token" → "RefreshToken" */
function toPascalCase(str) {
  return str
    .split(/[-_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

/**
 * Detect whether a schema has a discriminated top-level oneOf.
 * Returns the discriminant property name (e.g. "workflow") or null.
 */
function detectDiscriminant(schema) {
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

/**
 * Compile a JSON Schema object into a TypeScript string.
 * Exported so tests can pass mutated schemas directly (without touching disk).
 */
export async function compileSchema(schema, schemaFile) {
  const discriminant = detectDiscriminant(schema);

  if (!discriminant) {
    // Simple path: let json-schema-to-typescript do the full job.
    const ts = await compile(schema, schema.title, {
      ...COMPILE_OPTIONS,
      bannerComment: banner(schemaFile).trimEnd(),
    });
    return ts;
  }

  // Discriminated-union path.
  // Collect the property names that vary per branch so we can split base vs. branch.
  const branchSpecificProps = new Set(
    schema.oneOf.flatMap((b) => (b.properties ? Object.keys(b.properties) : [])),
  );

  // Common (non-varying) properties
  const commonProps = Object.fromEntries(
    Object.entries(schema.properties).filter(([k]) => !branchSpecificProps.has(k)),
  );

  const branchOutputs = [];

  for (const branch of schema.oneOf) {
    const discriminantConst = branch.properties[discriminant].const;
    const variantName = toPascalCase(discriminantConst) + schema.title;

    // Build a complete schema for this variant by merging common + branch props.
    const { oneOf: _oneOf, ...baseRest } = schema;
    const mergedSchema = {
      ...baseRest,
      title: variantName,
      description: `${schema.title} variant for ${discriminant} = "${discriminantConst}".`,
      properties: {
        ...commonProps,
        ...branch.properties,
        // Preserve descriptions from the base schema for overridden props.
        [discriminant]: {
          ...schema.properties[discriminant],
          ...branch.properties[discriminant],
        },
      },
    };

    const ts = await compile(mergedSchema, variantName, COMPILE_OPTIONS);
    branchOutputs.push({ variantName, ts: ts.trim() });
  }

  // Assemble final output: banner + per-variant types + union alias.
  const variantNames = branchOutputs.map((b) => b.variantName);
  const unionComment = [
    `/**`,
    ` * Discriminated union of all ${schema.title} variants.`,
    ` * Narrow by \`${discriminant}\`: ${variantNames.map((n) => `"${toDiscriminantValue(n, schema.title)}"`).join(' | ')}.`,
    ` */`,
  ].join('\n');

  return [
    banner(schemaFile),
    ...branchOutputs.map((b) => b.ts),
    '',
    unionComment,
    `export type ${schema.title} = ${variantNames.join(' | ')};`,
    '',
  ].join('\n');
}

/** Reverse "DiscordMonitorRunResult" → "discord-monitor" using the oneOf consts. */
function toDiscriminantValue(variantName, title) {
  // variantName = PascalCase(discriminantConst) + title
  // We can't reliably reverse PascalCase, so we accept it's used only for a comment.
  // Return an approximation: strip the title suffix and lower-case.
  const base = variantName.slice(0, variantName.length - title.length);
  return base
    .replace(/([A-Z])/g, (m, l, i) => (i > 0 ? '-' : '') + l.toLowerCase())
    .replace(/^-/, '');
}

/**
 * Read a schema file from SCHEMAS_DIR and return its compiled TypeScript string.
 */
export async function generateTypes(schemaFile) {
  const schemaPath = path.join(SCHEMAS_DIR, schemaFile);
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  return compileSchema(schema, schemaFile);
}
