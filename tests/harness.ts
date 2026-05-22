import { join } from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { spyOn } from "bun:test";
import { runApp } from "../src/tui/app.ts";
import type { ToolDef } from "../src/config.ts";

export interface TUIHarness {
  start(tools: ToolDef[]): Promise<void>;
  write(data: string): Promise<void>;
  waitForOutput(pattern: string, timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
  getOutput(): string;
}

class MockStdin extends EventEmitter {
  isRaw = false;
  setRawMode(value: boolean) {
    this.isRaw = value;
    return this;
  }
  resume() { return this; }
  pause() { return this; }
}

export class MockTUIHarness implements TUIHarness {
  private originalStdin: any;
  private mockStdin!: MockStdin;
  private stdoutWriteSpy: any;
  private stdoutFrames: string[] = [];
  private appPromise?: Promise<void>;

  async start(tools: ToolDef[]): Promise<void> {
    this.originalStdin = process.stdin;
    this.mockStdin = new MockStdin();
    Object.defineProperty(process, "stdin", {
      value: this.mockStdin,
      writable: true,
      configurable: true
    });

    this.stdoutFrames = [];
    this.stdoutWriteSpy = spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
      this.stdoutFrames.push(chunk.toString());
      return true;
    });

    this.appPromise = runApp(tools, tools);
    await Bun.sleep(15); // Wait a tiny tick to paint first frame
  }

  async write(data: string): Promise<void> {
    for (const char of data) {
      this.mockStdin.emit("data", Buffer.from(char));
    }
    await Bun.sleep(15);
  }

  async waitForOutput(pattern: string, timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.getOutput().includes(pattern)) {
        return;
      }
      await Bun.sleep(20);
    }
    throw new Error(`Timed out waiting for mock TUI output containing: "${pattern}". Current output:\n${this.getOutput()}`);
  }

  async close(): Promise<void> {
    if (this.mockStdin) {
      this.mockStdin.emit("data", Buffer.from("\x03")); // ctrl+c to exit
    }
    if (this.appPromise) {
      await this.appPromise;
    }
    Object.defineProperty(process, "stdin", {
      value: this.originalStdin,
      writable: true,
      configurable: true
    });
    if (this.stdoutWriteSpy) {
      this.stdoutWriteSpy.mockRestore();
    }
  }

  getOutput(): string {
    return this.stdoutFrames.join("");
  }
}

export class PtyTUIHarness implements TUIHarness {
  private tempHome!: string;
  private output = "";
  private proc: any;

  async start(tools: ToolDef[]): Promise<void> {
    this.tempHome = join(process.cwd(), "tests/tmp", `.readwise-pty-test-${Math.random().toString(36).slice(2, 9)}`);
    await mkdir(this.tempHome, { recursive: true });

    const mockConfigPath = join(this.tempHome, ".readwise-cli.json");
    const mockConfig = {
      access_token: "mock-token-12345",
      auth_type: "token",
      tools_cache: {
        tools,
        fetched_at: Date.now(),
        version: 2
      }
    };

    await writeFile(mockConfigPath, JSON.stringify(mockConfig, null, 2), "utf-8");
    this.output = "";

    this.proc = Bun.spawn([process.execPath, "src/index.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: this.tempHome,
        READWISE_OFFLINE: "true",
        FORCE_COLOR: "1",
        FORCE_TTY: "true",
      },
      terminal: {
        cols: 80,
        rows: 24,
        data: (terminal, data) => {
          this.output += data.toString();
        }
      }
    });

    await Bun.sleep(100); // Wait for the terminal process to boot and print initial frame
  }

  async write(data: string): Promise<void> {
    if (this.proc && this.proc.terminal) {
      this.proc.terminal.write(data);
    }
    await Bun.sleep(50);
  }

  async waitForOutput(pattern: string, timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.output.includes(pattern)) {
        return;
      }
      await Bun.sleep(50);
    }
    throw new Error(`Timed out waiting for PTY output containing: "${pattern}". Current output:\n${this.output}`);
  }

  async close(): Promise<void> {
    if (this.proc) {
      try {
        if (this.proc.terminal) {
          this.proc.terminal.write("\x03"); // send Ctrl+C to terminate TUI gracefully
        }
        await Bun.sleep(50);
        this.proc.kill();
        await this.proc.exited;
      } catch {
        // Ignore
      }
    }
    try {
      await rm(this.tempHome, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }

  getOutput(): string {
    return this.output;
  }
}
