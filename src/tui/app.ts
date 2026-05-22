import { exec } from "node:child_process";
import type { ToolDef } from "../config.js";
import { loadConfig, saveConfig, getAllConfigEntries, setConfigValue, filterReadOnlyTools } from "../config.js";
import { callTool } from "../mcp.js";
import { ensureValidToken } from "../auth.js";
import { style, paint, parseKey } from "./term.js";
import type { AppState } from "./state.js";
import { buildCommandList, selectableIndices, renderCommandList } from "./views/commands.js";
import { renderForm } from "./views/form.js";
import { renderLoading, renderResults } from "./views/results.js";
import { renderSettings, settingsChoices } from "./views/settings.js";
import { handleInput } from "./input.js";
import { formValuesToArgs, extractCards, isEmptyListResult, formatJsonPretty, EMPTY_LIST_SENTINEL } from "./utils.js";

// --- Render State Coordinator ---

function renderState(state: AppState): string[] {
  switch (state.view) {
    case "commands": return renderCommandList(state);
    case "form": return renderForm(state);
    case "loading": return renderLoading(state);
    case "results": return renderResults(state);
    case "settings": return renderSettings(state);
  }
}

// --- Execute Tool Command ---

async function executeTool(state: AppState): Promise<AppState> {
  const tool = state.selectedTool!;
  const args = formValuesToArgs(state.fields, state.formValues);
  try {
    const { token, authType } = await ensureValidToken();
    const res = await callTool(token, authType, tool.name, args);

    if (res.isError) {
      const errMsg = res.content.map((c) => c.text || "").filter(Boolean).join("\n");
      return {
        ...state,
        view: "results",
        error: errMsg || "Unknown error",
        result: "",
        resultScroll: 0,
        resultScrollX: 0,
        resultCards: [],
        resultCursor: 0,
        resultCardScroll: 0,
      };
    }

    const text = res.content.filter((c) => c.type === "text" && c.text).map((c) => c.text!).join("\n");
    const structured = (res as Record<string, unknown>).structuredContent;
    let formatted: string;
    let emptyList = false;
    let parsedData: unknown = undefined;

    if (!text && structured !== undefined) {
      parsedData = structured;
      emptyList = isEmptyListResult(structured);
      formatted = formatJsonPretty(structured);
    } else {
      try {
        parsedData = JSON.parse(text);
        emptyList = isEmptyListResult(parsedData);
        formatted = formatJsonPretty(parsedData);
      } catch {
        formatted = text;
      }
    }

    const cards = parsedData !== undefined ? extractCards(parsedData) || [] : [];
    return {
      ...state,
      view: "results",
      result: emptyList ? EMPTY_LIST_SENTINEL : formatted,
      error: "",
      resultScroll: 0,
      resultScrollX: 0,
      resultCards: cards,
      resultCursor: 0,
      resultCardScroll: 0,
    };
  } catch (err) {
    return {
      ...state,
      view: "results",
      error: (err as Error).message,
      result: "",
      resultScroll: 0,
      resultScrollX: 0,
      resultCards: [],
      resultCursor: 0,
      resultCardScroll: 0,
    };
  }
}

// --- Main TUI App Loop ---

export async function runApp(tools: ToolDef[], allTools: ToolDef[]): Promise<void> {
  const items = buildCommandList(tools);
  const selectable = selectableIndices(items);

  let state: AppState = {
    view: "commands",
    tools,
    allTools,
    listCursor: selectable[0] ?? 0,
    listScrollTop: 0,
    quitConfirm: false,
    searchQuery: "",
    searchCursorPos: 0,
    filteredItems: buildCommandList(tools),
    selectedTool: null,
    fields: [],
    nameColWidth: 6,
    formSearchQuery: "",
    formSearchCursorPos: 0,
    formFilteredIndices: [],
    formListCursor: 0,
    formScrollTop: 0,
    formEditFieldIdx: -1,
    formEditing: false,
    formInputBuf: "",
    formInputCursorPos: 0,
    formEnumCursor: 0,
    formEnumSelected: new Set(),
    formValues: {},
    formShowRequired: false,
    formShowOptional: false,
    formStack: [],
    dateParts: [],
    datePartCursor: 0,
    result: "",
    error: "",
    resultScroll: 0,
    resultScrollX: 0,
    resultCards: [],
    resultCursor: 0,
    resultCardScroll: 0,
    spinnerFrame: 0,
    settingsCursor: 0,
    settingsEntries: [],
    settingsEditing: false,
    settingsEditCursor: 0,
  };

  paint(renderState(state));

  process.stdout.on("resize", () => {
    paint(renderState(state));
  });

  const spinnerInterval = setInterval(() => {
    if (state.view === "loading") {
      state = { ...state, spinnerFrame: state.spinnerFrame + 1 };
      paint(renderState(state));
    }
  }, 80);

  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise<void>((resolve) => {
    let quitTimer: ReturnType<typeof setTimeout> | null = null;

    const resetQuitTimer = () => {
      if (quitTimer) {
        clearTimeout(quitTimer);
        quitTimer = null;
      }
      if (state.quitConfirm) {
        quitTimer = setTimeout(() => {
          quitTimer = null;
          state = { ...state, quitConfirm: false };
          paint(renderState(state));
        }, 2000);
      }
    };

    const cleanup = () => {
      clearInterval(spinnerInterval);
      if (quitTimer) clearTimeout(quitTimer);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      resolve();
    };

    const runTool = (loadingState: AppState) => {
      executeTool(loadingState).then((resultState) => {
        if (state.view !== "loading") return;
        state = resultState;
        paint(renderState(state));
        resetQuitTimer();
      });
    };

    const onData = (data: Buffer) => {
      const key = parseKey(data);

      if (key.ctrl && key.name === "c") {
        cleanup();
        return;
      }

      if (state.view === "loading") return;

      const result = handleInput(state, key);

      if (result === "exit") {
        cleanup();
        return;
      }

      if (result === "openUrl") {
        const card = state.resultCards[state.resultCursor];
        if (card?.url) {
          const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
          exec(`${cmd} ${JSON.stringify(card.url)}`);
        }
        return;
      }

      if (result === "settingsToggle") {
        const entry = state.settingsEntries[state.settingsCursor];
        if (entry) {
          const choices = settingsChoices(entry);
          const picked = choices[state.settingsEditCursor] ?? "off";
          const rawValue = picked === "on" ? "true" : "false";
          loadConfig().then((config) => {
            setConfigValue(config, entry.key, rawValue);
            return saveConfig(config).then(() => {
              const entries = Object.entries(getAllConfigEntries(config)).map(([key, value]) => ({ key, value }));
              const visibleTools = config.config?.readonly
                ? filterReadOnlyTools(state.allTools)
                : state.allTools;
              state = {
                ...state,
                tools: visibleTools,
                settingsEntries: entries,
                settingsEditing: false,
              };
              paint(renderState(state));
            });
          });
        }
        return;
      }

      if (result === "submit") {
        state = { ...state, view: "loading", spinnerFrame: 0 };
        paint(renderState(state));
        runTool(state);
        return;
      }

      if (result.view === "loading") {
        state = { ...result, spinnerFrame: 0 };
        paint(renderState(state));
        runTool(state);
        return;
      }

      state = result;

      if (state.view === "settings" && state.settingsEntries.length === 0) {
        loadConfig().then((config) => {
          const entries = Object.entries(getAllConfigEntries(config)).map(([key, value]) => ({ key, value }));
          state = { ...state, settingsEntries: entries };
          paint(renderState(state));
        });
      }

      paint(renderState(state));
      resetQuitTimer();
    };

    process.stdin.on("data", onData);
  });
}
