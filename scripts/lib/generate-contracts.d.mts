/** Type declarations for scripts/lib/generate-contracts.mjs */

export declare const ROOT: string;
export declare const SCHEMAS_DIR: string;
export declare const OUTPUT_DIR: string;

export declare const SCHEMAS: ReadonlyArray<{ readonly file: string; readonly output: string }>;

/**
 * Compile a JSON Schema object directly (without reading from disk).
 * Accepts mutated schemas so tests can exercise the sync-gate logic.
 */
export declare function compileSchema(
  schema: Record<string, unknown>,
  schemaFile: string,
): Promise<string>;

/**
 * Read the named schema from SCHEMAS_DIR and compile it to TypeScript.
 */
export declare function generateTypes(schemaFile: string): Promise<string>;
