import type { ToolDef } from "../../config.js";
import { VERSION } from "../../version.js";
import { style } from "../term.js";
import { LOGO } from "../logo.js";
import type { AppState, ListItem } from "../state.js";
import {
  getBoxDimensions,
  fitWidth,
  truncateVisible,
  renderLayout,
  humanLabel,
  toolPrefix
} from "../utils.js";

export function buildCommandList(tools: ToolDef[]): ListItem[] {
  const groups: Record<string, { label: string; items: ListItem[] }> = {};
  for (const tool of tools) {
    let groupKey: string;
    let prefix: string;
    if (tool.name.startsWith("readwise_")) { groupKey = "Readwise"; prefix = "readwise"; }
    else if (tool.name.startsWith("reader_")) { groupKey = "Reader"; prefix = "reader"; }
    else { groupKey = "Other"; prefix = ""; }

    if (!groups[groupKey]) groups[groupKey] = { label: groupKey, items: [] };
    groups[groupKey].items.push({
      label: prefix ? humanLabel(tool.name, prefix) : tool.name,
      value: tool.name,
      description: tool.description,
    });
  }
  const order = ["Reader", "Readwise", "Other"];
  const result: ListItem[] = [];
  for (const key of order) {
    const group = groups[key];
    if (group) {
      result.push({ label: group.label, value: "", isSeparator: true });
      result.push(...group.items);
    }
  }
  result.push({ label: "CLI", value: "", isSeparator: true });
  result.push({ label: "Settings", value: "__settings__", description: "Configure CLI options" });
  return result;
}

export function selectableIndices(items: ListItem[]): number[] {
  return items.map((item, i) => item.isSeparator ? -1 : i).filter((i) => i >= 0);
}

export function filterCommands(tools: ToolDef[], query: string): ListItem[] {
  if (!query) return buildCommandList(tools);
  const q = query.toLowerCase();
  const items: ListItem[] = [];
  for (const tool of tools) {
    const prefix = toolPrefix(tool);
    const label = prefix ? humanLabel(tool.name, prefix) : tool.name;
    const haystack = (label + " " + tool.name + " " + (tool.description || "")).toLowerCase();
    if (haystack.includes(q)) {
      items.push({ label, value: tool.name, description: tool.description });
    }
  }
  if ("settings configure cli options".includes(q)) {
    items.push({ label: "Settings", value: "__settings__", description: "Configure CLI options" });
  }
  return items;
}

export function renderCommandList(state: AppState): string[] {
  const { contentHeight, innerWidth } = getBoxDimensions();
  const items = state.filteredItems;
  const content: string[] = [];

  // Logo
  for (let i = 0; i < LOGO.length; i++) {
    const logoLine = style.blue(LOGO[i]!);
    if (i === Math.floor(LOGO.length / 2) - 1) {
      content.push(` ${logoLine}  ${style.boldYellow("Readwise")} ${style.dim("v" + VERSION)}`);
    } else if (i === Math.floor(LOGO.length / 2)) {
      content.push(` ${logoLine}  ${style.dim("Built for AI agents · This TUI is just for fun/learning")}`);
    } else {
      content.push(` ${logoLine}`);
    }
  }
  content.push("");

  // Search input line
  const queryText = state.searchQuery;
  const before = queryText.slice(0, state.searchCursorPos);
  const cursorChar = state.searchCursorPos < queryText.length
    ? queryText[state.searchCursorPos]
    : " ";
  const after = state.searchCursorPos < queryText.length
    ? queryText.slice(state.searchCursorPos + 1)
    : "";
  const searchLine = " " + style.yellow("❯") + " " + before + style.inverse(cursorChar) + after;
  content.push(searchLine);
  content.push("");

  // List area
  const logoUsed = content.length;
  const listHeight = Math.max(1, contentHeight - logoUsed);

  if (items.length === 0) {
    content.push("   " + style.dim("No matching commands"));
  } else {
    const labelWidths = items.filter((it) => !it.isSeparator).map((it) => it.label.length);
    const maxLabelWidth = Math.max(...labelWidths, 0);
    const descAvail = Math.max(0, innerWidth - 3 - maxLabelWidth - 2);

    const hiddenBelow = Math.max(0, items.length - (state.listScrollTop + listHeight));
    const visibleSlots = hiddenBelow > 0 ? listHeight - 1 : listHeight;
    const visible = items.slice(state.listScrollTop, state.listScrollTop + visibleSlots);
    for (let i = 0; i < visible.length; i++) {
      const item = visible[i]!;
      const realIdx = state.listScrollTop + i;
      if (item.isSeparator) {
        content.push(`   ${style.dim("── " + item.label + " ──")}`);
      } else {
        const selected = realIdx === state.listCursor;
        const prefix = selected ? " ❯ " : "   ";
        const paddedLabel = item.label.padEnd(maxLabelWidth);
        const desc = item.description && descAvail > 3
          ? "  " + style.dim(truncateVisible(item.description, descAvail))
          : "";
        if (selected) {
          content.push(style.boldYellow(prefix + paddedLabel) + desc);
        } else {
          content.push(prefix + paddedLabel + desc);
        }
      }
    }
    if (hiddenBelow > 0) {
      content.push("   " + style.dim(`(${hiddenBelow} more)`));
    }
  }

  const footer = state.quitConfirm
    ? style.yellow("Press again to quit")
    : style.dim("type to search · ↑↓ navigate · enter select · esc/ctrl+c quit");

  return renderLayout({
    breadcrumb: style.boldYellow("Readwise"),
    content,
    footer,
  });
}
