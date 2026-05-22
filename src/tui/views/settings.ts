import { style } from "../term.js";
import type { AppState } from "../state.js";
import { getBoxDimensions, renderLayout } from "../utils.js";

export function settingsChoices(entry: { key: string; value: unknown }): string[] {
  return ["on", "off"];
}

export function settingsValueLabel(value: unknown): string {
  if (value === true) return "on";
  if (value === false) return "off";
  return String(value);
}

export function renderSettings(state: AppState): string[] {
  const entries = state.settingsEntries;
  const content: string[] = [];
  content.push("");

  if (entries.length === 0) {
    content.push("   " + style.dim("Loading settings..."));
  } else {
    const maxKeyWidth = Math.max(...entries.map((e) => e.key.length), 0);
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      const selected = i === state.settingsCursor;
      const prefix = selected ? " " + style.yellow("❯") + " " : "   ";
      const label = e.key.padEnd(maxKeyWidth);
      const valueStr = e.value === true ? style.green("on") : e.value === false ? style.dim("off") : String(e.value);
      const line = prefix + (selected ? style.bold(label) : label) + "  " + valueStr;
      content.push(line);

      if (selected && state.settingsEditing) {
        const choices = settingsChoices(e);
        for (let ci = 0; ci < choices.length; ci++) {
          const isCursor = ci === state.settingsEditCursor;
          const choiceLine = (isCursor ? "   › " : "     ") + choices[ci]!;
          content.push(isCursor ? style.cyan(style.bold(choiceLine)) : choiceLine);
        }
      }
    }
  }

  const footer = state.settingsEditing
    ? style.dim("↑↓ navigate · enter confirm · esc cancel")
    : style.dim("↑↓ navigate · enter edit · esc back");

  return renderLayout({
    breadcrumb: style.boldYellow("Readwise") + style.dim(" › ") + style.bold("Settings"),
    content,
    footer,
  });
}
