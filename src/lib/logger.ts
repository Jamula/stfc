// Tiny env logger. Stays out of the way unless DEBUG_STFC=1 is set.
// Account names appear in output; tokens never do (use lib/redact for any
// formatted value that might contain a JWT).

export type LogLevel = "debug" | "info" | "warn" | "error";

const ACTIVE: ReadonlyArray<LogLevel> = process.env.DEBUG_STFC
  ? ["debug", "info", "warn", "error"]
  : ["info", "warn", "error"];

function emit(level: LogLevel, prefix: string | undefined, parts: unknown[]): void {
  if (!ACTIVE.includes(level)) return;
  const tag = prefix ? `[${prefix}]` : "";
  const stream = level === "error" || level === "warn" ? console.error : console.log;
  stream(`${level.toUpperCase()} ${tag}`.trim(), ...parts);
}

export interface Logger {
  debug(...parts: unknown[]): void;
  info(...parts: unknown[]): void;
  warn(...parts: unknown[]): void;
  error(...parts: unknown[]): void;
  child(prefix: string): Logger;
}

export function createLogger(prefix?: string): Logger {
  return {
    debug: (...parts) => emit("debug", prefix, parts),
    info:  (...parts) => emit("info",  prefix, parts),
    warn:  (...parts) => emit("warn",  prefix, parts),
    error: (...parts) => emit("error", prefix, parts),
    child(suffix: string): Logger {
      const next = prefix ? `${prefix}/${suffix}` : suffix;
      return createLogger(next);
    },
  };
}
