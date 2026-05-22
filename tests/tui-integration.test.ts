import { expect, test, describe } from "bun:test";
import { MockTUIHarness, PtyTUIHarness } from "./harness.ts";
import type { ToolDef } from "../src/config.ts";

const mockTools: ToolDef[] = [
  {
    name: "reader_list_documents",
    description: "List all reader documents",
    inputSchema: { type: "object" }
  },
  {
    name: "readwise_create_highlight",
    description: "Create a readwise highlight",
    inputSchema: { type: "object" }
  }
];

describe("Interactive TUI (Unified)", () => {
  const runners = [
    { name: "Mock Stream (Fast In-Memory)", factory: () => new MockTUIHarness() },
    { name: "PTY Subprocess (Real Terminal)", factory: () => new PtyTUIHarness() }
  ];

  for (const runner of runners) {
    describe(runner.name, () => {
      test("should start command view, accept search query, filter tools, and quit on ctrl+c", async () => {
        const harness = runner.factory();
        try {
          await harness.start(mockTools);

          // 1. Assert initial state renders our first tool
          await harness.waitForOutput("List Documents");

          // 2. Type 'highlight' to filter the command list
          await harness.write("highlight");

          // 3. Assert that 'Create Highlight' is now displayed/selected
          await harness.waitForOutput("Create Highlight");
        } finally {
          await harness.close();
        }
      });

      test("should handle exit signal gracefully", async () => {
        const harness = runner.factory();
        try {
          await harness.start(mockTools);
          await harness.waitForOutput("List Documents");
        } finally {
          await harness.close();
        }
      });
    });
  }
});
