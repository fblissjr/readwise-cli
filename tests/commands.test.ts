import { expect, test, describe, spyOn, afterEach } from "bun:test";
import {
  toolNameToCommand,
  resolveRef,
  resolveProperty,
  displayResult
} from "../src/commands.ts";
import type { SchemaProperty } from "../src/config.ts";

describe("Commands", () => {
  afterEach(() => {
    spyOn(process.stdout, "write").mockRestore();
    spyOn(process.stderr, "write").mockRestore();
  });

  test("toolNameToCommand should replace underscores with dashes", () => {
    expect(toolNameToCommand("reader_list_documents")).toBe("reader-list-documents");
    expect(toolNameToCommand("readwise_create_highlight")).toBe("readwise-create-highlight");
  });

  test("resolveRef should resolve recursive definitions", () => {
    const prop: SchemaProperty = { $ref: "#/$defs/MyDef", description: "custom desc" };
    const defs = {
      MyDef: { type: "string", description: "base desc" }
    };
    const resolved = resolveRef(prop, defs);
    expect(resolved.type).toBe("string");
    expect(resolved.description).toBe("custom desc"); // Custom description overrides base description
  });

  test("resolveProperty should resolve anyOf and arrays", () => {
    const prop: SchemaProperty = {
      anyOf: [
        { type: "null" },
        { $ref: "#/$defs/MyDef" }
      ]
    };
    const defs = {
      MyDef: { type: "string", description: "hello" }
    };
    const resolved = resolveProperty(prop, defs);
    expect(resolved.type).toBe("string");
    expect(resolved.description).toBe("hello");

    const arrayProp: SchemaProperty = {
      type: "array",
      items: {
        anyOf: [
          { type: "null" },
          { $ref: "#/$defs/MyDef" }
        ]
      }
    };
    const resolvedArray = resolveProperty(arrayProp, defs);
    expect(resolvedArray.type).toBe("array");
    expect(resolvedArray.items?.type).toBe("string");
  });

  test("displayResult should handle errors correctly", () => {
    const errResult = {
      content: [{ type: "text", text: "Something went wrong" }],
      isError: true
    };

    let stderrOutput = "";
    spyOn(process.stderr, "write").mockImplementation((str) => {
      stderrOutput += str;
      return true;
    });

    const originalExitCode = process.exitCode;
    displayResult(errResult, false);
    expect(stderrOutput).toContain("Something went wrong");
    expect(process.exitCode).toBe(1);

    // Reset exitCode to 0 to prevent test runner from exiting with code 1
    process.exitCode = 0;
  });

  test("displayResult should display text results in standard and JSON modes", () => {
    const resultObj = {
      content: [{ type: "text", text: '{"ok": true}' }]
    };

    let stdoutOutput = "";
    spyOn(process.stdout, "write").mockImplementation((str) => {
      stdoutOutput += str;
      return true;
    });

    displayResult(resultObj, true);
    expect(stdoutOutput).toBe('{"ok": true}\n');
  });

  test("displayResult should fall back to plain text logging for primitive JSON values in non-json mode", () => {
    const resultObj = {
      content: [{ type: "text", text: "123" }]
    };

    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    displayResult(resultObj, false);
    expect(consoleSpy).toHaveBeenCalledWith("123");
    consoleSpy.mockRestore();
  });

  test("displayResult should display structuredContent when text content is empty", () => {
    const resultObj = {
      content: [],
      structuredContent: { id: "123", value: "foo" }
    };

    let stdoutOutput = "";
    spyOn(process.stdout, "write").mockImplementation((str) => {
      stdoutOutput += str;
      return true;
    });

    displayResult(resultObj, true);
    expect(stdoutOutput).toBe(JSON.stringify(resultObj.structuredContent) + "\n");
  });
});
