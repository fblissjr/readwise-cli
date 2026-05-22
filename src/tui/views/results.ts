import { style, ansiSlice } from "../term.js";
import type { AppState, CardItem } from "../state.js";
import {
  getBoxDimensions,
  fitWidth,
  truncateVisible,
  renderLayout,
  toolPrefix,
  humanLabel,
  wrapText,
  snippetAroundMatch,
  highlightTerms,
  computeCardScroll,
  cardLineCount,
  shuffledLoadingMessages,
  SPINNER_FRAMES,
  EMPTY_LIST_SENTINEL
} from "../utils.js";

const SUCCESS_ICON = [
  " ██████╗ ██╗  ██╗",
  "██╔═══██╗██║ ██╔╝",
  "██║   ██║█████╔╝ ",
  "██║   ██║██╔═██╗ ",
  "╚██████╔╝██║  ██╗",
  " ╚═════╝ ╚═╝  ╚═╝",
];

function cardLine(text: string, innerW: number, borderFn: (s: string) => string): string {
  return "  " + borderFn("│") + " " + fitWidth(text, innerW) + " " + borderFn("│");
}

export function buildCardLines(card: CardItem, ci: number, selected: boolean, cardWidth: number, searchQuery?: string): string[] {
  const borderColor = selected ? style.cyan : style.dim;
  const innerW = Math.max(1, cardWidth - 4);
  const lines: string[] = [];

  lines.push("  " + borderColor("╭" + "─".repeat(cardWidth - 2) + "╮"));

  if (card.kind === "highlight") {
    const quotePrefix = "\u201c ";
    const quoteSuffix = "\u201d";
    const passage = card.summary || "\u2026";
    const maxQuoteW = innerW - quotePrefix.length;
    const wrapped = wrapText(passage, maxQuoteW);
    const showLines = wrapped.slice(0, 6);
    if (wrapped.length > 6) {
      const last = showLines[5]!;
      showLines[5] = truncateVisible(last, maxQuoteW - 1) + "…";
    }
    for (let i = 0; i < showLines.length; i++) {
      let lineText: string;
      if (i === 0) {
        lineText = quotePrefix + showLines[i]!;
        if (showLines.length === 1) lineText += quoteSuffix;
      } else if (i === showLines.length - 1) {
        lineText = "  " + showLines[i]! + quoteSuffix;
      } else {
        lineText = "  " + showLines[i]!;
      }
      const styled = selected ? style.cyan(lineText) : lineText;
      lines.push(cardLine(styled, innerW, borderColor));
    }

    if (card.note) {
      const noteText = "✏ " + truncateVisible(card.note, innerW - 2);
      lines.push(cardLine(style.yellow(noteText), innerW, borderColor));
    }

    if (card.meta) {
      lines.push(cardLine(style.dim(truncateVisible(card.meta, innerW)), innerW, borderColor));
    }
  } else {
    const titleText = truncateVisible(card.title || "Untitled", innerW);
    const titleStyled = selected ? style.bold(style.cyan(titleText)) : style.bold(titleText);
    lines.push(cardLine(titleStyled, innerW, borderColor));

    if (card.summary) {
      const snippet = searchQuery
        ? snippetAroundMatch(card.summary, searchQuery, innerW * 3)
        : card.summary;
      const wrapped = wrapText(snippet, innerW);
      const showLines = wrapped.slice(0, 3);
      if (wrapped.length > 3) {
        const last = showLines[2]!;
        showLines[2] = truncateVisible(last, innerW - 1) + "…";
      }
      for (const sl of showLines) {
        const highlighted = searchQuery ? highlightTerms(sl, searchQuery) : sl;
        lines.push(cardLine(style.dim(highlighted), innerW, borderColor));
      }
    }

    if (card.meta) {
      lines.push(cardLine(style.dim(truncateVisible(card.meta, innerW)), innerW, borderColor));
    }
  }

  lines.push("  " + borderColor("╰" + "─".repeat(cardWidth - 2) + "╯"));
  return lines;
}

export function renderCardView(state: AppState): string[] {
  const { contentHeight, innerWidth } = getBoxDimensions();
  const tool = state.selectedTool;
  const title = tool ? humanLabel(tool.name, toolPrefix(tool)) : "";
  const cards = state.resultCards;
  const cardWidth = Math.min(innerWidth - 4, 72);

  const content: string[] = [];

  const countInfo = style.dim(` (${state.resultCursor + 1} of ${cards.length})`);
  content.push("  " + style.bold("Results") + countInfo);
  content.push("");

  const searchQuery = state.formValues["query"] || state.formValues["vector_search_term"] || state.formValues["search"] || "";

  const allLines: { line: string; cardIdx: number }[] = [];
  for (let ci = 0; ci < cards.length; ci++) {
    const cardContentLines = buildCardLines(cards[ci]!, ci, ci === state.resultCursor, cardWidth, searchQuery || undefined);
    for (const line of cardContentLines) {
      allLines.push({ line, cardIdx: ci });
    }
    if (ci < cards.length - 1) {
      allLines.push({ line: "", cardIdx: ci });
    }
  }

  const availableHeight = Math.max(1, contentHeight - content.length);
  const scroll = state.resultCardScroll;
  const visible = allLines.slice(scroll, scroll + availableHeight);
  for (const entry of visible) {
    content.push(entry.line);
  }

  const hasUrl = cards[state.resultCursor]?.url;
  const footerParts = ["↑↓ navigate"];
  if (hasUrl) footerParts.push("enter open");
  footerParts.push("esc back", "q quit");

  return renderLayout({
    breadcrumb: style.boldYellow("Readwise") + style.dim(" › ") + style.bold(title) + style.dim(" › results"),
    content,
    footer: state.quitConfirm
      ? style.yellow("Press q again to quit")
      : style.dim(footerParts.join(" · ")),
  });
}

export function renderLoading(state: AppState): string[] {
  const { contentHeight } = getBoxDimensions();
  const tool = state.selectedTool;
  const title = tool ? humanLabel(tool.name, toolPrefix(tool)) : "";
  const content: string[] = [];

  const midRow = Math.floor(contentHeight / 2);
  while (content.length < midRow) content.push("");

  const msgIdx = Math.floor(state.spinnerFrame / 13) % shuffledLoadingMessages.length;
  const loadingMsg = shuffledLoadingMessages[msgIdx]!;
  const frame = SPINNER_FRAMES[state.spinnerFrame % SPINNER_FRAMES.length]!;
  content.push(`   ${style.cyan(frame)} ${loadingMsg}`);

  return renderLayout({
    breadcrumb: style.boldYellow("Readwise") + style.dim(" › ") + style.bold(title) + style.dim(" › running…"),
    content,
    footer: "",
  });
}

export function renderResults(state: AppState): string[] {
  const { contentHeight } = getBoxDimensions();
  const tool = state.selectedTool;
  const title = tool ? humanLabel(tool.name, toolPrefix(tool)) : "";
  const isError = !!state.error;
  const isEmptyList = !isError && state.result === EMPTY_LIST_SENTINEL;
  const isEmpty = !isError && !isEmptyList && !state.result.trim();

  if (!isError && !isEmptyList && !isEmpty && state.resultCards.length > 0) {
    return renderCardView(state);
  }

  if (isEmptyList) {
    const ghost = [
      "  ╔══════════╗  ",
      " ╔╝░░░░░░░░░░╚╗ ",
      "╔╝░░╔══╗░╔══╗░░╚╗",
      "║░░░║  ║░║  ║░░░║",
      "║░░░╚══╝░╚══╝░░░║",
      "║░░░░░░░░░░░░░░░║",
      "║░░░░╔══════╗░░░║",
      "╚╗░░╚╝░░░░░░╚╝░╔╝",
      " ╚╗░░╗░╔╗░╔╗░╔╝ ",
      "  ╚══╝░╚╝░╚╝░╚╝  ",
    ];
    const content: string[] = [];
    const midRow = Math.floor(contentHeight / 2) - Math.floor(ghost.length / 2) - 2;
    while (content.length < midRow) content.push("");
    for (const line of ghost) {
      content.push("  " + style.dim(line));
    }
    content.push("");
    content.push("  " + "No results found");
    content.push("");
    content.push("  " + style.dim("Try adjusting your search parameters."));

    return renderLayout({
      breadcrumb: style.boldYellow("Readwise") + style.dim(" › ") + style.bold(title) + style.dim(" › done"),
      content,
      footer: state.quitConfirm
        ? style.yellow("Press q again to quit")
        : style.dim("enter/esc back · q quit"),
    });
  }

  if (isEmpty) {
    const content: string[] = [];
    const toolLabel = tool ? humanLabel(tool.name, toolPrefix(tool)) : "Command";
    const midRow = Math.floor(contentHeight / 2) - Math.floor(SUCCESS_ICON.length / 2) - 1;
    while (content.length < midRow) content.push("");
    for (const line of SUCCESS_ICON) {
      content.push("  " + style.green(line));
    }
    content.push("");
    content.push("  " + style.bold(style.green(toolLabel + " completed successfully")));

    return renderLayout({
      breadcrumb: style.boldYellow("Readwise") + style.dim(" › ") + style.bold(title) + style.dim(" › done"),
      content,
      footer: state.quitConfirm
        ? style.yellow("Press q again to quit")
        : style.dim("enter/esc back · q quit"),
    });
  }

  const rawContent = state.error || state.result;
  const contentLines = rawContent.split("\n");
  const content: string[] = [];

  let resultHeader = isError ? style.red(style.bold("  Error")) : style.bold("  Results");
  const visibleCount = Math.max(1, contentHeight - 3);
  if (contentLines.length > visibleCount) {
    const from = state.resultScroll + 1;
    const to = Math.min(state.resultScroll + visibleCount, contentLines.length);
    resultHeader += style.dim(` (${from}–${to} of ${contentLines.length})`);
  }
  content.push(resultHeader);
  content.push("");

  const visible = contentLines.slice(state.resultScroll, state.resultScroll + visibleCount);
  for (const line of visible) {
    const shifted = state.resultScrollX > 0 ? ansiSlice(line, state.resultScrollX) : line;
    content.push("  " + (isError ? style.red(shifted) : shifted));
  }

  const scrollHint = state.resultScrollX > 0 ? `←${state.resultScrollX} ` : "";
  return renderLayout({
    breadcrumb: style.boldYellow("Readwise") + style.dim(" › ") + style.bold(title) + style.dim(" › results"),
    content,
    footer: state.quitConfirm
      ? style.yellow("Press q again to quit")
      : style.dim(scrollHint + "↑↓←→ scroll · esc back · q quit"),
  });
}
