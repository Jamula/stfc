#!/usr/bin/env node
/**
 * Validates discord/commands.json against Discord's CHAT_INPUT command schema.
 * https://discord.com/developers/docs/interactions/application-commands#application-command-object
 *
 * Exit 0 — valid
 * Exit 1 — invalid (errors printed to stderr)
 *
 * Usage: node scripts/validate-discord-commands.mjs [path/to/commands.json]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_PATH = resolve(REPO_ROOT, "discord/commands.json");

const filePath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_PATH;

// Discord CHAT_INPUT command name: 1–32 chars, lowercase letters/numbers/hyphens/underscores.
// Unicode letters and numbers are allowed per Discord docs.
const NAME_PATTERN = "^[-_\\p{L}\\p{N}]{1,32}$";

/** @type {import('ajv').JSONSchemaType<unknown>} */
const commandSchema = {
  type: "object",
  required: ["name", "description"],
  additionalProperties: true,
  properties: {
    name: {
      type: "string",
      minLength: 1,
      maxLength: 32,
      pattern: NAME_PATTERN,
    },
    description: {
      type: "string",
      minLength: 1,
      maxLength: 100,
    },
    type: {
      type: "integer",
      enum: [1, 2, 3],
      description: "1=CHAT_INPUT, 2=USER, 3=MESSAGE",
    },
    default_member_permissions: {
      type: "string",
      description: "Permissions bitmask as a string (e.g. '8' for ADMINISTRATOR)",
    },
    options: {
      type: "array",
    },
  },
};

const rootSchema = {
  type: "array",
  minItems: 1,
  items: commandSchema,
};

let raw;
try {
  raw = readFileSync(filePath, "utf8");
} catch (err) {
  process.stderr.write(`ERROR: Cannot read ${filePath}: ${err.message}\n`);
  process.exit(1);
}

let commands;
try {
  commands = JSON.parse(raw);
} catch (err) {
  process.stderr.write(`ERROR: Invalid JSON in ${filePath}: ${err.message}\n`);
  process.exit(1);
}

const ajv = new Ajv({ allErrors: true, unicodeRegExp: true });
const validate = ajv.compile(rootSchema);

if (validate(commands)) {
  process.stdout.write(`OK: ${commands.length} command(s) valid in ${filePath}\n`);
  process.exit(0);
} else {
  process.stderr.write(`INVALID: ${filePath}\n`);
  for (const err of validate.errors ?? []) {
    process.stderr.write(`  ${err.instancePath || "/"} ${err.message}\n`);
  }
  process.exit(1);
}
