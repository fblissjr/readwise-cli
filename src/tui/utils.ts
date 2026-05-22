import type { ToolDef, SchemaProperty } from "../config.js";
import { style, screenSize, ansiSlice, fitWidth } from "./term.js";
import type { FormField, CardItem, CardKind } from "./state.js";

export { fitWidth };


export type FieldKind = "arrayObj" | "date" | "arrayEnum" | "enum" | "bool" | "arrayText" | "text";
export type DateFormat = "date" | "date-time";

export const RESET = "\x1b[0m";
export const EMPTY_LIST_SENTINEL = "\x00__EMPTY_LIST__";
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export const shuffledLoadingMessages = (() => {
  const msgs = [
    "Fetching data…", "Processing…", "Reaching out to Readwise…",
    "Loading…", "Crunching…", "Almost there…", "Querying…",
    "Thinking…", "Connecting…", "Gathering results…", "Brewing…",
    "Searching…", "Talking to the API…", "Hang tight…",
    "One moment…", "Just a sec…",
  ];
  for (let i = msgs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [msgs[i], msgs[j]] = [msgs[j]!, msgs[i]!];
  }
  return msgs;
})();

export function isArrayOfObjects(prop: SchemaProperty): boolean {
  return prop.type === "array" && !!prop.items?.properties;
}

export function humanLabel(toolName: string, prefix: string): string {
  return toolName
    .replace(prefix + "_", "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function toolPrefix(tool: ToolDef): string {
  return tool.name.startsWith("reader_") ? "reader" : "readwise";
}

export function truncateVisible(s: string, maxWidth: number): string {
  if (s.length <= maxWidth) return s;
  if (maxWidth <= 1) return "\u2026";
  return s.slice(0, maxWidth - 1) + "\u2026";
}

export function missingRequiredFields(fields: FormField[], values: Record<string, string>): FormField[] {
  return fields.filter((f) => {
    if (!f.required) return false;
    const val = values[f.name]?.trim();
    if (!val) return true;
    if (isArrayOfObjects(f.prop)) {
      try { return JSON.parse(val).length === 0; } catch { return true; }
    }
    return false;
  });
}

export function defaultFormCursor(fields: FormField[], filtered: number[], values: Record<string, string>): number {
  const missing = new Set(missingRequiredFields(fields, values).map((f) => f.name));
  const firstBlank = filtered.findIndex((idx) => idx >= 0 && missing.has(fields[idx]!.name));
  const execIdx = filtered.indexOf(-1);
  return firstBlank >= 0 ? firstBlank : (execIdx >= 0 ? execIdx : 0);
}

export function classifyField(prop: SchemaProperty): FieldKind {
  if (isArrayOfObjects(prop)) return "arrayObj";
  if (dateFieldFormat(prop)) return "date";
  const eVals = prop.enum || prop.items?.enum;
  if (prop.type === "boolean") return "bool";
  if (eVals && prop.type === "array") return "arrayEnum";
  if (eVals) return "enum";
  if (prop.type === "array") return "arrayText";
  return "text";
}

export function fieldTypeBadge(prop: SchemaProperty): string {
  const badges: Record<FieldKind, string> = {
    arrayObj: "form", date: "date", bool: "yes/no", arrayEnum: "multi",
    enum: "select", arrayText: "list", text: "text",
  };
  const badge = badges[classifyField(prop)];
  if (badge !== "text") return badge;
  if (prop.type === "integer" || prop.type === "number") return "number";
  return "text";
}

export function footerForFieldKind(kind: FieldKind): string {
  switch (kind) {
    case "arrayObj": return "\u2191\u2193 navigate \u00B7 enter add/edit \u00B7 backspace delete \u00B7 esc back";
    case "date": return "\u2190\u2192 part \u00B7 \u2191\u2193 adjust \u00B7 t today \u00B7 enter confirm \u00B7 esc cancel";
    case "arrayEnum": return "space toggle \u00B7 enter confirm \u00B7 esc cancel";
    case "arrayText": return "\u2191\u2193 navigate \u00B7 enter add/edit \u00B7 backspace delete \u00B7 esc confirm";
    case "enum":
    case "bool": return "\u2191\u2193 navigate \u00B7 enter confirm \u00B7 esc cancel";
    case "text": return "enter confirm \u00B7 esc cancel";
  }
}

export function formFieldValueDisplay(value: string, maxWidth: number): string {
  if (!value) return style.dim("–");
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return style.dim(`[${parsed.length} item${parsed.length !== 1 ? "s" : ""}]`);
    }
  } catch { /* not JSON */ }
  const lines = value.split("\n");
  if (lines.length > 1) {
    const first = truncateVisible(lines[0]!, Math.max(1, maxWidth - 12));
    return first + " " + style.dim(`[+${lines.length - 1} lines]`);
  }
  return truncateVisible(value, maxWidth);
}

export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

export function prevWordBoundary(buf: string, pos: number): number {
  if (pos <= 0) return 0;
  let i = pos - 1;
  while (i > 0 && /\s/.test(buf[i]!)) i--;
  if (i >= 0 && /\w/.test(buf[i]!)) {
    while (i > 0 && /\w/.test(buf[i - 1]!)) i--;
  } else {
    while (i > 0 && !/\w/.test(buf[i - 1]!) && !/\s/.test(buf[i - 1]!)) i--;
  }
  return i;
}

export function nextWordBoundary(buf: string, pos: number): number {
  const len = buf.length;
  if (pos >= len) return len;
  let i = pos;
  if (/\w/.test(buf[i]!)) {
    while (i < len && /\w/.test(buf[i]!)) i++;
  } else if (!/\s/.test(buf[i]!)) {
    while (i < len && !/\w/.test(buf[i]!) && !/\s/.test(buf[i]!)) i++;
  }
  while (i < len && /\s/.test(buf[i]!)) i++;
  return i;
}

export function dateFieldFormat(prop: SchemaProperty): DateFormat | null {
  if (prop.format === "date") return "date";
  if (prop.format === "date-time") return "date-time";
  return null;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function todayParts(fmt: DateFormat): number[] {
  const now = new Date();
  const parts = [now.getFullYear(), now.getMonth() + 1, now.getDate()];
  if (fmt === "date-time") parts.push(now.getHours(), now.getMinutes());
  return parts;
}

export function parseDateParts(value: string, fmt: DateFormat): number[] | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (fmt === "date-time") {
    const tm = value.match(/T(\d{2}):(\d{2})/);
    parts.push(tm ? Number(tm[1]) : 0, tm ? Number(tm[2]) : 0);
  }
  return parts;
}

export function datePartsToString(parts: number[], fmt: DateFormat): string {
  const y = String(parts[0]).padStart(4, "0");
  const mo = String(parts[1]).padStart(2, "0");
  const d = String(parts[2]).padStart(2, "0");
  if (fmt === "date") return `${y}-${mo}-${d}`;
  const h = String(parts[3] ?? 0).padStart(2, "0");
  const mi = String(parts[4] ?? 0).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${mi}:00Z`;
}

export function renderDateParts(parts: number[], cursor: number, fmt: DateFormat): string {
  const segments: string[] = [
    String(parts[0]).padStart(4, "0"),
    String(parts[1]).padStart(2, "0"),
    String(parts[2]).padStart(2, "0"),
  ];
  if (fmt === "date-time") {
    segments.push(
      String(parts[3] ?? 0).padStart(2, "0"),
      String(parts[4] ?? 0).padStart(2, "0"),
    );
  }
  const labels = fmt === "date" ? ["Y", "M", "D"] : ["Y", "M", "D", "h", "m"];
  const seps = fmt === "date" ? ["-", "-"] : ["-", "-", " ", ":"];
  let out = "";
  for (let i = 0; i < segments.length; i++) {
    if (i > 0) out += style.dim(seps[i - 1]!);
    const seg = segments[i]!;
    if (i === cursor) {
      out += style.inverse(style.cyan(seg));
    } else {
      out += style.cyan(seg);
    }
  }
  out += "  " + style.dim("←→ part  ↑↓ adjust  " + labels.map((l, i) => (i === cursor ? `[${l}]` : l)).join(" "));
  return out;
}

export function adjustDatePart(parts: number[], cursor: number, delta: number, fmt: DateFormat): number[] {
  const p = [...parts];
  if (cursor === 0) {
    p[0] = Math.max(1900, Math.min(2100, p[0]! + delta));
  } else if (cursor === 1) {
    p[1] = ((p[1]! - 1 + delta + 120) % 12) + 1;
  } else if (cursor === 2) {
    const max = daysInMonth(p[0]!, p[1]!);
    p[2] = ((p[2]! - 1 + delta + max * 100) % max) + 1;
  } else if (cursor === 3 && fmt === "date-time") {
    p[3] = ((p[3]! + delta + 240) % 24);
  } else if (cursor === 4 && fmt === "date-time") {
    p[4] = ((p[4]! + delta + 600) % 60);
  }
  const maxDay = daysInMonth(p[0]!, p[1]!);
  if (p[2]! > maxDay) p[2] = maxDay;
  return p;
}

export function datePartCount(fmt: DateFormat): number {
  return fmt === "date" ? 3 : 5;
}

export function getBoxDimensions(): { innerWidth: number; fillWidth: number; contentHeight: number } {
  const { cols, rows } = screenSize();
  return {
    innerWidth: Math.max(0, cols - 5),
    fillWidth: Math.max(0, cols - 3),
    contentHeight: Math.max(1, rows - 4),
  };
}

export function renderLayout(opts: {
  breadcrumb: string;
  content: string[];
  footer: string;
}): string[] {
  const { innerWidth, fillWidth, contentHeight } = getBoxDimensions();
  const lines: string[] = [];

  lines.push("  " + opts.breadcrumb);
  lines.push(` ╭${"─".repeat(fillWidth)}╮`);

  for (let i = 0; i < contentHeight; i++) {
    const raw = i < opts.content.length ? opts.content[i] ?? "" : "";
    lines.push(` │ ${fitWidth(raw, innerWidth)}${RESET} │`);
  }

  lines.push(` ╰${"─".repeat(fillWidth)}╯`);
  lines.push("  " + opts.footer);

  return lines;
}

export function str(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val);
}

export function isHighlightObj(obj: Record<string, unknown>): boolean {
  if (obj.category === "highlight") return true;
  const attrs = obj.attributes;
  if (typeof attrs === "object" && attrs !== null && "highlight_plaintext" in (attrs as Record<string, unknown>)) return true;
  if (typeof obj.text === "string" &&
    ("highlighted_at" in obj || "color" in obj || "book_id" in obj || "location_type" in obj)) {
    return true;
  }
  if (typeof obj.text === "string" && "note" in obj) return true;
  return false;
}

export function extractHighlightMeta(obj: Record<string, unknown>): string {
  const attrs = (typeof obj.attributes === "object" && obj.attributes !== null)
    ? obj.attributes as Record<string, unknown> : null;
  const parts: string[] = [];

  const author = str(attrs?.document_author || obj.author || obj.book_author);
  if (author && !author.startsWith("http")) parts.push(author);

  const category = str(attrs?.document_category || obj.category);
  if (category) parts.push(category);

  const color = str(obj.color);
  if (color) parts.push(color);

  const tags = attrs?.highlight_tags || obj.tags;
  if (Array.isArray(tags) && tags.length > 0) {
    const tagNames = tags.map((t: unknown) =>
      typeof t === "object" && t !== null ? str((t as Record<string, unknown>).name) : str(t)
    ).filter(Boolean);
    if (tagNames.length > 0) parts.push(tagNames.join(", "));
  }

  const date = str(obj.highlighted_at || obj.created_at);
  if (date) {
    const d = new Date(date);
    if (!isNaN(d.getTime())) {
      parts.push(d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }));
    }
  }

  return parts.join(" · ");
}

export function extractCardUrl(obj: Record<string, unknown>): string {
  for (const key of ["highlights_url", "url", "source_url", "reader_url", "readwise_url"]) {
    if (obj[key] && typeof obj[key] === "string") return obj[key] as string;
  }
  return "";
}

export function extractDocTitle(obj: Record<string, unknown>): string {
  for (const key of ["title", "readable_title", "name"]) {
    const val = obj[key];
    if (val && typeof val === "string" && !String(val).startsWith("http")) return val as string;
  }
  const url = str(obj.url || obj.source_url);
  if (url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { /* */ }
  }
  return "Untitled";
}

export function extractDocSummary(obj: Record<string, unknown>): string {
  if (Array.isArray(obj.matches) && obj.matches.length > 0) {
    const first = obj.matches[0] as Record<string, unknown> | undefined;
    if (first?.plaintext && typeof first.plaintext === "string") return first.plaintext;
  }
  for (const key of ["summary", "description", "note", "notes", "content"]) {
    const val = obj[key];
    if (val && typeof val === "string") return val;
  }
  return "";
}

export function extractDocMeta(obj: Record<string, unknown>): string {
  const parts: string[] = [];

  const siteName = str(obj.site_name);
  if (siteName) parts.push(siteName);

  const author = str(obj.author);
  if (author && author !== siteName) parts.push(author);

  const category = str(obj.category);
  if (category) parts.push(category);

  const wordCount = Number(obj.word_count);
  if (wordCount > 0) {
    const mins = Math.ceil(wordCount / 250);
    parts.push(`${mins} min`);
  }

  const progress = Number(obj.reading_progress);
  if (progress > 0 && progress < 1) {
    parts.push(`${Math.round(progress * 100)}% read`);
  } else if (progress >= 1) {
    parts.push("finished");
  }

  const date = str(obj.created_at || obj.saved_at || obj.published_date);
  if (date) {
    const d = new Date(date);
    if (!isNaN(d.getTime())) {
      parts.push(d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }));
    }
  }

  return parts.join(" · ");
}

export function extractCards(data: unknown): CardItem[] | null {
  let items: unknown[];
  if (Array.isArray(data)) {
    items = data;
  } else if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    const arrayKey = Object.keys(obj).find((k) => Array.isArray(obj[k]) && (obj[k] as unknown[]).length > 0);
    if (arrayKey) {
      items = obj[arrayKey] as unknown[];
    } else {
      return null;
    }
  } else {
    return null;
  }

  if (items.length === 0) return null;
  if (typeof items[0] !== "object" || items[0] === null || Array.isArray(items[0])) return null;

  const cards = items.map((item) => {
    const obj = item as Record<string, unknown>;
    const kind = isHighlightObj(obj) ? "highlight" : "document";
    if (kind === "highlight") {
      const attrs = (typeof obj.attributes === "object" && obj.attributes !== null)
        ? obj.attributes as Record<string, unknown> : null;
      return {
        kind,
        title: str(attrs?.document_title || obj.title || obj.readable_title || ""),
        summary: str(attrs?.highlight_plaintext || obj.text || obj.summary || obj.content || ""),
        note: str(attrs?.highlight_note || obj.note || obj.notes || ""),
        meta: extractHighlightMeta(obj),
        url: obj.id ? `https://readwise.io/open/${obj.id}` : extractCardUrl(obj),
        raw: obj,
      };
    }
    return {
      kind,
      title: extractDocTitle(obj),
      summary: extractDocSummary(obj),
      note: "",
      meta: extractDocMeta(obj),
      url: extractCardUrl(obj),
      raw: obj,
    };
  }) as CardItem[];

  const hasContent = cards.filter((c) => c.summary || c.note || (c.kind === "document" && c.title !== "Untitled" && !c.raw.url?.toString().includes(c.title)));
  if (hasContent.length < cards.length / 2) return null;

  return cards;
}

export function searchTermRegex(query: string): RegExp | null {
  const words = query.trim().split(/\s+/).filter((w) => w.length >= 3);
  if (words.length === 0) return null;
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(${escaped.join("|")})`, "gi");
}

export function snippetAroundMatch(text: string, query: string, maxChars: number): string {
  const re = searchTermRegex(query);
  if (!re) return text.slice(0, maxChars);
  const m = re.exec(text);
  if (!m) return text.slice(0, maxChars);
  const matchStart = m.index;
  let start = Math.max(0, matchStart - Math.floor(maxChars / 4));
  if (start > 0) {
    const nextSpace = text.indexOf(" ", start);
    if (nextSpace !== -1 && nextSpace < matchStart) {
      start = nextSpace + 1;
    }
  }
  const snippet = text.slice(start, start + maxChars);
  return start > 0 ? "…" + snippet : snippet;
}

export function highlightTerms(line: string, query: string): string {
  const re = searchTermRegex(query);
  if (!re) return line;
  return line.replace(re, (match) => `\x1b[22;1;3;37m${match}\x1b[22;23;2;39m`);
}

export function cardLineCount(card: CardItem, cardWidth: number): number {
  const innerW = Math.max(1, cardWidth - 4);
  if (card.kind === "highlight") {
    const quoteW = innerW - 2;
    const passage = card.summary || "\u2026";
    const wrapped = wrapText(passage, quoteW);
    const textLines = Math.min(wrapped.length, 6);
    return 2 + textLines + (card.note ? 1 : 0) + (card.meta ? 1 : 0);
  }
  const summaryLines = card.summary ? Math.min(wrapText(card.summary, 60).length, 3) : 0;
  return 2 + 1 + summaryLines + (card.meta ? 1 : 0);
}

export function computeCardScroll(cards: CardItem[], cursor: number, currentScroll: number, availableHeight: number): number {
  const { innerWidth } = getBoxDimensions();
  const cardWidth = Math.min(innerWidth - 4, 72);
  let lineStart = 0;
  for (let ci = 0; ci < cards.length; ci++) {
    const card = cards[ci]!;
    const height = cardLineCount(card, cardWidth);
    const spacing = ci < cards.length - 1 ? 1 : 0;
    if (ci === cursor) {
      const lineEnd = lineStart + height + spacing;
      if (lineStart < currentScroll) return lineStart;
      if (lineEnd > currentScroll + availableHeight) return Math.max(0, lineEnd - availableHeight);
      return currentScroll;
    }
    lineStart += height + spacing;
  }
  return currentScroll;
}

export function formValuesToArgs(fields: FormField[], values: Record<string, string>): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const field of fields) {
    const val = values[field.name];
    if (!val) continue;
    const p = field.prop;
    if (p.type === "integer" || p.type === "number") {
      const n = Number(val);
      if (!isNaN(n)) args[field.name] = n;
    } else if (p.type === "boolean") {
      args[field.name] = val === "true";
    } else if (p.type === "array") {
      try {
        const parsed = JSON.parse(val);
        args[field.name] = Array.isArray(parsed) ? parsed : val.split(",").map((s) => s.trim());
      } catch {
        args[field.name] = val.split(",").map((s) => s.trim()).filter(Boolean);
      }
    } else {
      args[field.name] = val;
    }
  }
  return args;
}

export function isComplex(val: unknown): boolean {
  if (Array.isArray(val)) return val.length > 0;
  return typeof val === "object" && val !== null;
}

export function scalarStr(val: unknown): string {
  if (val === null || val === undefined) return style.dim("null");
  if (typeof val === "number") return style.cyan(String(val));
  if (typeof val === "boolean") return style.yellow(String(val));
  const s = String(val);
  if (s === "") return style.dim("–");
  return s;
}

export function emitValue(value: unknown, indent: string, lines: string[]): void {
  if (Array.isArray(value)) {
    if (value.length === 0) return;
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        if (i > 0) lines.push("");
        emitArrayObject(item as Record<string, unknown>, indent, lines);
      } else {
        lines.push(indent + style.dim("─ ") + scalarStr(item));
      }
    }
  } else if (typeof value === "object" && value !== null) {
    emitObject(value as Record<string, unknown>, indent, lines);
  } else {
    lines.push(indent + scalarStr(value));
  }
}

export function emitObject(obj: Record<string, unknown>, indent: string, lines: string[]): void {
  const keys = Object.keys(obj);
  if (keys.length === 0) return;
  const maxLen = Math.max(...keys.map((k) => k.length));
  for (const key of keys) {
    const val = obj[key];
    if (isComplex(val)) {
      lines.push(indent + style.bold(key) + style.dim(":"));
      emitValue(val, indent + "  ", lines);
    } else {
      lines.push(indent + style.bold(key.padEnd(maxLen)) + "  " + scalarStr(val));
    }
  }
}

export function emitArrayObject(obj: Record<string, unknown>, indent: string, lines: string[]): void {
  const keys = Object.keys(obj);
  if (keys.length === 0) { lines.push(indent + style.dim("─")); return; }
  const maxLen = Math.max(...keys.map((k) => k.length));
  let first = true;
  for (const key of keys) {
    const val = obj[key];
    const marker = first ? style.dim("─ ") : "  ";
    if (isComplex(val)) {
      lines.push(indent + marker + style.bold(key) + style.dim(":"));
      emitValue(val, indent + "    ", lines);
    } else {
      lines.push(indent + marker + style.bold(key.padEnd(maxLen)) + "  " + scalarStr(val));
    }
    first = false;
  }
}

export function isEmptyListResult(data: unknown): boolean {
  if (Array.isArray(data) && data.length === 0) return true;
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    const values = Object.values(obj);
    if (values.length === 0) return false;
    const hasArray = values.some((v) => Array.isArray(v));
    if (!hasArray) return false;
    return values.every((v) =>
      (Array.isArray(v) && v.length === 0) ||
      v === 0 || v === null || v === ""
    );
  }
  return false;
}

export function formatJsonPretty(data: unknown): string {
  const lines: string[] = [];
  emitValue(data, "", lines);
  return lines.join("\n");
}
