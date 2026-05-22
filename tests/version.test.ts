import { expect, test, describe } from "bun:test";
import { VERSION } from "../src/version.ts";
import pkg from "../package.json" assert { type: "json" };

describe("Version", () => {
  test("should export the correct version from package.json", () => {
    // Red step: we can deliberately write a failing expectation first if we want to watch it fail,
    // e.g. expect(VERSION).toBe("incorrect-version");
    expect(VERSION).toBe(pkg.version);
  });
});
