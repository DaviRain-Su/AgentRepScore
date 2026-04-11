/**
 * Lightweight JSON structured logger for skill and keeper layers.
 *
 * Outputs newline-delimited JSON logs with level, message, and metadata.
 * Error objects in metadata include stack traces.
 */

export type LogLevel = "info" | "warn" | "error" | "fatal";

export interface LogMeta {
  [key: string]: unknown;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  meta?: LogMeta;
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  return { value: err };
}

function sanitizeMeta(meta: LogMeta): LogMeta {
  const out: LogMeta = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value instanceof Error || (value && typeof value === "object" && "message" in value)) {
      out[key] = serializeError(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function log(level: LogLevel, message: string, meta?: LogMeta): void {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
  };
  if (meta && Object.keys(meta).length > 0) {
    entry.meta = sanitizeMeta(meta);
  }

  const line = JSON.stringify(entry);

  if (level === "error" || level === "fatal") {
    // eslint-disable-next-line no-console
    console.error(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

export const logger = {
  info(message: string, meta?: LogMeta): void {
    log("info", message, meta);
  },
  warn(message: string, meta?: LogMeta): void {
    log("warn", message, meta);
  },
  error(message: string, meta?: LogMeta): void {
    log("error", message, meta);
  },
  fatal(message: string, meta?: LogMeta): void {
    log("fatal", message, meta);
  },
};
