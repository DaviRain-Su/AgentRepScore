import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger, type LogEntry } from "../../src/skill/logger.ts";

describe("logger", () => {
  let logs: string[] = [];
  let errors: string[] = [];

  beforeEach(() => {
    logs = [];
    errors = [];
    vi.spyOn(console, "log").mockImplementation((msg: string) => {
      logs.push(msg);
    });
    vi.spyOn(console, "error").mockImplementation((msg: string) => {
      errors.push(msg);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("info outputs JSON to stdout", () => {
    logger.info("hello", { key: "value" });
    expect(logs.length).toBe(1);
    const parsed = JSON.parse(logs[0]) as LogEntry;
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("hello");
    expect(parsed.meta).toEqual({ key: "value" });
    expect(parsed.timestamp).toBeDefined();
  });

  it("warn outputs JSON to stdout", () => {
    logger.warn("watch out");
    expect(logs.length).toBe(1);
    const parsed = JSON.parse(logs[0]) as LogEntry;
    expect(parsed.level).toBe("warn");
    expect(parsed.message).toBe("watch out");
  });

  it("error outputs JSON to stderr", () => {
    logger.error("oops", { code: 500 });
    expect(errors.length).toBe(1);
    const parsed = JSON.parse(errors[0]) as LogEntry;
    expect(parsed.level).toBe("error");
    expect(parsed.message).toBe("oops");
    expect(parsed.meta).toEqual({ code: 500 });
  });

  it("fatal outputs JSON to stderr", () => {
    logger.fatal("dead", { reason: "crash" });
    expect(errors.length).toBe(1);
    const parsed = JSON.parse(errors[0]) as LogEntry;
    expect(parsed.level).toBe("fatal");
    expect(parsed.message).toBe("dead");
  });

  it("serializes errors with stack traces", () => {
    const err = new Error("something failed");
    logger.error("request failed", { err });
    expect(errors.length).toBe(1);
    const parsed = JSON.parse(errors[0]) as LogEntry;
    expect(parsed.meta).toBeDefined();
    const serialized = parsed.meta?.err as {
      name: string;
      message: string;
      stack: string;
    };
    expect(serialized.name).toBe("Error");
    expect(serialized.message).toBe("something failed");
    expect(serialized.stack).toContain("Error: something failed");
  });

  it("omits meta when not provided", () => {
    logger.info("plain");
    expect(logs.length).toBe(1);
    const parsed = JSON.parse(logs[0]) as LogEntry;
    expect(parsed.meta).toBeUndefined();
  });
});
