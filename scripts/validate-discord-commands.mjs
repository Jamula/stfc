#!/usr/bin/env node
/**
 * Validates discord/commands.json against Discord command schema essentials.
 * https://discord.com/developers/docs/interactions/application-commands#application-command-object
 *
 * NOTE: `options` are intentionally rejected for now (even if structurally valid).
 * Follow-up issue should add full recursive option-schema validation before enabling them.
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

// Discord command naming rules: lowercase letters, numbers, hyphens, underscores.
// Using \p{Ll} (lowercase letter in any script) per docs:
// https://discord.com/developers/docs/interactions/application-commands#application-command-object-application-command-naming
const NAME_CHARS = "[-_\\p{Ll}\\p{N}]";
const NAME_REGEX = new RegExp(`^${NAME_CHARS}+$`, "u");
const NAME_PATTERN = `^${NAME_CHARS}{1,32}$`;

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
  const seenTypeAndName = new Set();
  for (const [index, command] of commands.entries()) {
    const type = command.type ?? 1;
    const key = `${type}:${command.name}`;
    if (seenTypeAndName.has(key)) {
      process.stderr.write(
        `INVALID: ${filePath}\n  duplicate command for (type=${type}, name="${command.name}") at index ${index}\n`,
      );
      process.exit(1);
    }
    seenTypeAndName.add(key);

    if (Array.isArray(command.options)) {
      // Allowlist (v1): only STRING (type 3) and ATTACHMENT (type 11) options are accepted.
      // Full recursive validation of subcommands, subcommand groups, and choices is deferred.
      // Ref: https://discord.com/developers/docs/interactions/application-commands#application-command-object-application-command-option-structure
      // Expand to recursive validation in a follow-up once the handler tier supports it.
      const ALLOWED_OPTION_TYPES = new Set([3, 11]);
      for (const [optIndex, opt] of command.options.entries()) {
        if (typeof opt.type !== "number" || !ALLOWED_OPTION_TYPES.has(opt.type)) {
          process.stderr.write(
            `INVALID: ${filePath}\n  command "${command.name}" option[${optIndex}].type=${opt.type} not supported; ` +
              `allowed: STRING(3), ATTACHMENT(11). Complex options (subcommands, choices) are not yet supported.\n`,
          );
          process.exit(1);
        }
        if (
          typeof opt.name !== "string" ||
          opt.name.length < 1 ||
          opt.name.length > 32 ||
          !NAME_REGEX.test(opt.name)
        ) {
          process.stderr.write(
            `INVALID: ${filePath}\n  command "${command.name}" option[${optIndex}].name must be a string (1-32 chars, lowercase letters/digits/dashes/underscores)\n`,
          );
          process.exit(1);
        }
        if (typeof opt.description !== "string" || opt.description.length < 1 || opt.description.length > 100) {
          process.stderr.write(
            `INVALID: ${filePath}\n  command "${command.name}" option[${optIndex}].description must be a string (1-100 chars)\n`,
          );
          process.exit(1);
        }
        if (Object.hasOwn(opt, "required") && typeof opt.required !== "boolean") {
          process.stderr.write(
            `INVALID: ${filePath}\n  command "${command.name}" option[${optIndex}].required must be a boolean\n`,
          );
          process.exit(1);
        }
      }
    }
  }
  process.stdout.write(`OK: ${commands.length} command(s) valid in ${filePath}\n`);
  process.exit(0);
} else {
  process.stderr.write(`INVALID: ${filePath}\n`);
  for (const err of validate.errors ?? []) {
    process.stderr.write(`  ${err.instancePath || "/"} ${err.message}\n`);
  }
  process.exit(1);
}
