import { style } from "../term.js";
import type { AppState, FormField } from "../state.js";
import { resolveProperty } from "../../commands.js";
import {
  humanLabel,
  toolPrefix,
  classifyField,
  fieldTypeBadge,
  footerForFieldKind,
  formFieldValueDisplay,
  missingRequiredFields,
  defaultFormCursor,
  dateFieldFormat,
  renderDateParts,
  todayParts,
  parseDateParts,
  datePartsToString,
  adjustDatePart,
  datePartCount,
  getBoxDimensions,
  renderLayout,
  wrapText,
  truncateVisible,
  isArrayOfObjects
} from "../utils.js";

export function filterFormFields(fields: FormField[], query: string): number[] {
  if (!query) {
    const indices = fields.map((_, i) => i);
    indices.push(-1); // Execute sentinel
    return indices;
  }
  const q = query.toLowerCase();
  const indices: number[] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!;
    const haystack = f.name.toLowerCase();
    if (haystack.includes(q)) indices.push(i);
  }
  indices.push(-1); // Execute sentinel always present
  return indices;
}

export function executeIndex(filtered: number[]): number {
  return filtered.indexOf(-1);
}

export function popFormStack(state: AppState): AppState {
  const stack = [...state.formStack];
  const entry = stack.pop()!;
  const subObj: Record<string, unknown> = {};
  for (const f of state.fields) {
    const val = state.formValues[f.name];
    if (!val) continue;
    if (f.prop.type === "integer" || f.prop.type === "number") {
      const n = Number(val);
      if (!isNaN(n)) subObj[f.name] = n;
    } else if (f.prop.type === "boolean") {
      subObj[f.name] = val === "true";
    } else if (f.prop.type === "array") {
      try {
        const parsed = JSON.parse(val);
        subObj[f.name] = Array.isArray(parsed) ? parsed : val.split(",").map((s) => s.trim()).filter(Boolean);
      } catch {
        subObj[f.name] = val.split(",").map((s) => s.trim()).filter(Boolean);
      }
    } else {
      subObj[f.name] = val;
    }
  }

  const parentVal = entry.parentValues[entry.parentFieldName] || "[]";
  let parentArr: unknown[] = [];
  try { parentArr = JSON.parse(parentVal); } catch { /* */ }
  if (entry.editIndex >= 0) {
    parentArr[entry.editIndex] = subObj;
  } else {
    parentArr.push(subObj);
  }
  const newParentValues = { ...entry.parentValues, [entry.parentFieldName]: JSON.stringify(parentArr) };
  const parentFiltered = filterFormFields(entry.parentFields, "");
  const parentFieldIdx = entry.parentFields.findIndex((f) => f.name === entry.parentFieldName);
  return {
    ...state,
    formStack: stack,
    fields: entry.parentFields,
    nameColWidth: entry.parentNameColWidth,
    formValues: newParentValues,
    formEditing: true,
    formEditFieldIdx: parentFieldIdx,
    formEnumCursor: parentArr.length,
    formEnumSelected: new Set(),
    formSearchQuery: "",
    formSearchCursorPos: 0,
    formFilteredIndices: parentFiltered,
    formListCursor: defaultFormCursor(entry.parentFields, parentFiltered, newParentValues),
    formScrollTop: 0,
    formShowRequired: false, formShowOptional: false,
    formInputBuf: "",
    formInputCursorPos: 0,
  };
}

export function renderForm(state: AppState): string[] {
  const { contentHeight, innerWidth } = getBoxDimensions();
  const tool = state.selectedTool!;
  const fields = state.fields;
  const toolTitle = humanLabel(tool.name, toolPrefix(tool));

  if (state.formStack.length > 0) {
    const stackParts = state.formStack.map((e) => e.parentFieldName);
    const title = toolTitle + " › " + stackParts.join(" › ");
    if (state.formEditing && state.formEditFieldIdx >= 0) {
      return renderFormEditMode(state, title, fields, contentHeight, innerWidth);
    }
    return renderFormPaletteMode(state, title, fields, contentHeight, innerWidth);
  }

  return renderCommandBuilder(state, toolTitle, fields, contentHeight, innerWidth);
}

export function renderCommandBuilder(
  state: AppState, title: string, fields: FormField[],
  contentHeight: number, innerWidth: number,
): string[] {
  const tool = state.selectedTool!;
  const cmdName = tool.name.replace(/_/g, "-");
  const content: string[] = [];
  const editField = state.formEditing && state.formEditFieldIdx >= 0
    ? fields[state.formEditFieldIdx]!
    : null;

  content.push("");
  content.push("  " + style.bold(title));
  if (tool.description) {
    const wrapped = wrapText(tool.description, innerWidth - 4);
    for (const line of wrapped) {
      content.push("  " + style.dim(line));
    }
  }
  content.push("");

  const editKind = editField ? classifyField(editField.prop) : null;
  const isTextLikeEdit = editKind === "text";

  const argLines: string[] = [];
  for (const field of fields) {
    const flagName = field.name.replace(/_/g, "-");
    if (field === editField) {
      if (isTextLikeEdit) {
        const buf = state.formInputBuf;
        const before = buf.slice(0, state.formInputCursorPos);
        const cursorChar = state.formInputCursorPos < buf.length ? buf[state.formInputCursorPos]! : " ";
        const after = state.formInputCursorPos < buf.length ? buf.slice(state.formInputCursorPos + 1) : "";
        argLines.push("    --" + flagName + "=" + style.cyan(before) + style.inverse(cursorChar) + style.cyan(after));
      } else if (isArrayOfObjects(field.prop)) {
        const existing = state.formValues[field.name] || "[]";
        let items: unknown[] = [];
        try { items = JSON.parse(existing); } catch { /* */ }
        const label = items.length > 0 ? `[${items.length} item${items.length > 1 ? "s" : ""}]` : "[...]";
        argLines.push("    --" + flagName + "=" + style.yellow(label));
      } else {
        argLines.push("    --" + flagName + "=" + style.inverse(" "));
      }
    } else {
      const val = state.formValues[field.name];
      if (val) {
        const needsQuotes = val.includes(" ") || val.includes(",");
        const displayVal = needsQuotes ? '"' + val + '"' : val;
        argLines.push("    --" + flagName + "=" + style.cyan(displayVal));
      }
    }
  }

  const cmdPrefix = "  " + style.dim("$") + " " + style.dim("readwise") + " " + cmdName;
  if (argLines.length === 0) {
    content.push(cmdPrefix);
  } else {
    content.push(cmdPrefix + " \\");
    for (let i = 0; i < argLines.length; i++) {
      const isLast = i === argLines.length - 1;
      content.push(argLines[i]! + (isLast ? "" : " \\"));
    }
  }

  content.push("");

  if (editField) {
    if (editField.prop.description) {
      content.push("  " + style.dim(editField.prop.description));
    }
    if (editField.prop.examples?.length) {
      const exStr = editField.prop.examples.map((e: unknown) => typeof e === "string" ? e : JSON.stringify(e)).join(", ");
      content.push("  " + style.dim("e.g. ") + style.cyan(truncateVisible(exStr, innerWidth - 10)));
    }
    if (editField.prop.default != null) {
      content.push("  " + style.dim("default: " + editField.prop.default));
    }

    const eVals = editField.prop.enum || editField.prop.items?.enum;

    if (editKind === "bool") {
      content.push("");
      const choices = ["true", "false"];
      for (let ci = 0; ci < choices.length; ci++) {
        const sel = ci === state.formEnumCursor;
        content.push(sel ? "  " + style.cyan(style.bold("\u203A " + choices[ci]!)) : "    " + choices[ci]!);
      }
    } else if (editKind === "enum" && eVals) {
      content.push("");
      for (let ci = 0; ci < eVals.length; ci++) {
        const sel = ci === state.formEnumCursor;
        content.push(sel ? "  " + style.cyan(style.bold("\u203A " + eVals[ci]!)) : "    " + eVals[ci]!);
      }
    } else if (editKind === "arrayEnum" && eVals) {
      content.push("");
      for (let ci = 0; ci < eVals.length; ci++) {
        const sel = ci === state.formEnumCursor;
        const checked = state.formEnumSelected.has(ci);
        const check = checked ? style.cyan("[x]") : style.dim("[ ]");
        content.push((sel ? "  \u203A " : "    ") + check + " " + eVals[ci]!);
      }
    } else if (editKind === "date") {
      const dateFmt = dateFieldFormat(editField.prop)!;
      content.push("");
      content.push("  " + renderDateParts(state.dateParts, state.datePartCursor, dateFmt));
    } else if (editKind === "arrayText") {
      const existing = state.formValues[editField.name] || "";
      const items = existing ? existing.split(",").map((s: string) => s.trim()).filter(Boolean) : [];
      content.push("");
      for (let i = 0; i < items.length; i++) {
        const isCursor = i === state.formEnumCursor;
        content.push((isCursor ? "  \u276F " : "    ") + style.cyan(items[i]!));
      }
      const onInput = state.formEnumCursor === items.length;
      content.push((onInput ? "  \u276F " : "    ") + style.cyan(state.formInputBuf) + (onInput ? style.inverse(" ") : ""));
    } else if (editKind === "arrayObj") {
      const existing = state.formValues[editField.name] || "[]";
      let items: unknown[] = [];
      try { items = JSON.parse(existing); } catch { /* */ }
      content.push("");
      for (let i = 0; i < items.length; i++) {
        const item = items[i] as Record<string, unknown>;
        const summary = Object.entries(item)
          .filter(([, v]) => v != null && v !== "")
          .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
          .join(", ");
        const isCursor = i === state.formEnumCursor;
        content.push((isCursor ? "  \u276F " : "    ") + truncateVisible(summary || "(empty)", innerWidth - 6));
      }
      if (items.length > 0) content.push("");
      const addCursor = state.formEnumCursor === items.length;
      content.push(addCursor
        ? "  " + style.inverse(style.green(" + Add new item "))
        : "  " + style.dim("+") + " Add new item");
    } else if (isTextLikeEdit) {
      if (!state.formInputBuf) {
        content.push("");
        content.push("  " + style.dim("Type a value and press enter"));
      }
    }
  } else {
    const missing = missingRequiredFields(fields, state.formValues);
    if (missing.length > 0) {
      content.push("  " + style.red("Missing: " + missing.map((f) => f.name).join(", ")));
    } else {
      content.push("  " + style.dim("Press enter to run"));
    }

    const optionalFields = fields
      .map((f, i) => ({ field: f, idx: i }))
      .filter(({ field }) => !field.required);
    if (optionalFields.length > 0) {
      content.push("");
      content.push("  " + style.dim("Optional parameters (tab to add)"));
      content.push("");
      const maxFlagWidth = Math.max(...optionalFields.map(({ field }) => field.name.length), 0) + 2;
      for (let i = 0; i < optionalFields.length; i++) {
        const { field } = optionalFields[i]!;
        const flagName = field.name.replace(/_/g, "-");
        const hasValue = !!state.formValues[field.name]?.trim();
        const sel = state.formShowOptional && i === state.formListCursor;
        const prefix = sel ? " \u276F " : "   ";
        const paddedName = flagName.padEnd(maxFlagWidth);
        const desc = field.prop.description
          ? style.dim(truncateVisible(field.prop.description, innerWidth - maxFlagWidth - 8))
          : "";
        if (sel) {
          content.push(style.boldYellow(prefix + paddedName) + "  " + desc);
        } else if (hasValue) {
          content.push(prefix + style.green(paddedName) + "  " + desc);
        } else {
          content.push(prefix + style.dim(paddedName) + "  " + desc);
        }
      }
    }
  }

  const footer = editKind
    ? style.dim(footerForFieldKind(editKind))
    : state.formShowOptional
    ? style.dim("\u2191\u2193 select \u00B7 enter add \u00B7 esc done")
    : style.dim("enter run \u00B7 tab add option \u00B7 esc back");

  return renderLayout({
    breadcrumb: style.boldYellow("Readwise") + style.dim(" \u203A ") + style.bold(title),
    content,
    footer,
  });
}

export function renderFormPaletteMode(
  state: AppState, title: string, fields: FormField[],
  contentHeight: number, innerWidth: number,
): string[] {
  const content: string[] = [];

  content.push("");
  content.push("  " + style.bold(title));
  const headerDesc = state.formStack.length > 0
    ? state.formStack[state.formStack.length - 1]!.parentFields
        .find((f) => f.name === state.formStack[state.formStack.length - 1]!.parentFieldName)
        ?.prop.items?.description
    : state.selectedTool!.description;
  if (headerDesc) {
    const wrapped = wrapText(headerDesc, innerWidth - 4);
    for (const line of wrapped) {
      content.push("  " + style.dim(line));
    }
  }

  const requiredFields = fields.filter((f) => f.required);
  if (requiredFields.length > 0) {
    const filledRequired = requiredFields.filter((f) => {
      const val = state.formValues[f.name]?.trim();
      if (!val) return false;
      if (isArrayOfObjects(f.prop)) {
        try { return JSON.parse(val).length > 0; } catch { return false; }
      }
      return true;
    });
    const allFilled = filledRequired.length === requiredFields.length;
    const progressText = `${filledRequired.length} of ${requiredFields.length} required`;
    content.push("  " + (allFilled ? style.green("✓ " + progressText) : style.dim(progressText)));
  }

  content.push("");

  const queryText = state.formSearchQuery;
  if (queryText || fields.length > 6) {
    const before = queryText.slice(0, state.formSearchCursorPos);
    const cursorChar = state.formSearchCursorPos < queryText.length
      ? queryText[state.formSearchCursorPos]!
      : " ";
    const after = state.formSearchCursorPos < queryText.length
      ? queryText.slice(state.formSearchCursorPos + 1)
      : "";
    content.push("  " + style.dim("/") + " " + before + style.inverse(cursorChar) + after);
    content.push("");
  } else {
    content.push("");
  }

  const maxLabelWidth = Math.max(
    ...fields.map((f) => f.name.length + (f.required ? 2 : 0)),
    6,
  ) + 1;

  const badgeWidth = 8;
  const valueAvail = Math.max(0, innerWidth - 3 - maxLabelWidth - 2 - badgeWidth);

  const headerUsed = content.length;
  const listHeight = Math.max(1, contentHeight - headerUsed - 8);

  const filtered = state.formFilteredIndices;
  const hasOnlyExecute = filtered.length === 1 && filtered[0] === -1;

  const requiredIdxs = filtered.filter((idx) => idx >= 0 && idx < fields.length && fields[idx]!.required);
  const optionalIdxs = filtered.filter((idx) => idx >= 0 && idx < fields.length && !fields[idx]!.required);
  const hasOptional = optionalIdxs.length > 0;
  const showingOptional = state.formShowOptional || state.formSearchQuery;
  const filledOptionalCount = optionalIdxs.filter((idx) => !!state.formValues[fields[idx]!.name]?.trim()).length;

  const renderField = (fieldIdx: number) => {
    const field = fields[fieldIdx]!;
    const val = state.formValues[field.name] || "";
    const isFilled = !!val.trim();
    const listPos = filtered.indexOf(fieldIdx);
    const selected = listPos === state.formListCursor;

    const valStr = formFieldValueDisplay(val, valueAvail);
    const badge = style.dim(fieldTypeBadge(field.prop));
    const cursor = selected ? " ❯ " : "   ";
    if (selected) {
      const label = field.name + (field.required ? " *" : "");
      content.push(style.boldYellow(cursor) + style.boldYellow(label.padEnd(maxLabelWidth)) + "  " + valStr + "  " + badge);
    } else if (isFilled) {
      const label = field.name + (field.required ? " *" : "");
      content.push(cursor + style.green(label.padEnd(maxLabelWidth)) + "  " + valStr + "  " + badge);
    } else {
      const namePart = field.name;
      const starPart = field.required ? " *" : "";
      const plainLabel = namePart + starPart;
      const padAmount = Math.max(0, maxLabelWidth - plainLabel.length);
      const displayLabel = field.required ? namePart + style.red(" *") + " ".repeat(padAmount) : plainLabel.padEnd(maxLabelWidth);
      content.push(cursor + displayLabel + "  " + style.dim("–") + "  " + badge);
    }
  };

  if (hasOnlyExecute && state.formSearchQuery) {
    content.push("   " + style.dim("No matching parameters"));
    content.push("");
  } else {
    for (const fieldIdx of requiredIdxs) {
      renderField(fieldIdx);
    }

    if (hasOptional) {
      if (showingOptional) {
        if (requiredIdxs.length > 0) content.push("");
        content.push("   " + style.dim("── optional ──"));
        const visibleOptional = optionalIdxs.slice(0, listHeight - requiredIdxs.length - 2);
        for (const fieldIdx of visibleOptional) {
          renderField(fieldIdx);
        }
      } else {
        content.push("");
        const optLabel = filledOptionalCount > 0
          ? `── ${optionalIdxs.length} optional (${filledOptionalCount} set) · 'o' to show ──`
          : `── ${optionalIdxs.length} optional · 'o' to show ──`;
        content.push("   " + style.dim(optLabel));
      }
    }
  }

  const inSubForm = state.formStack.length > 0;
  const isEditing = inSubForm && state.formStack[state.formStack.length - 1]!.editIndex >= 0;
  const actionLabel = inSubForm ? (isEditing ? "Save" : "Add") : "Execute";
  const actionIcon = inSubForm ? (isEditing ? "✓" : "+") : "▶";
  content.push("");
  const executeListPos = filtered.indexOf(-1);
  const executeSelected = executeListPos === state.formListCursor;
  if (executeSelected) {
    content.push(" " + style.inverse(style.green(` ${actionIcon} ${actionLabel} `)));
  } else {
    content.push(" " + style.dim(actionIcon) + " " + actionLabel);
  }

  if (state.formShowRequired) {
    const missing = missingRequiredFields(fields, state.formValues);
    if (missing.length > 0) {
      content.push("");
      const names = missing.map((f) => f.name).join(", ");
      content.push("   " + style.red("Required: " + names));
    }
  }

  const highlightedIdx = filtered[state.formListCursor];
  if (highlightedIdx !== undefined && highlightedIdx >= 0 && highlightedIdx < fields.length) {
    const prop = fields[highlightedIdx]!.prop;
    if (prop.description) {
      content.push("");
      const wrapped = wrapText(prop.description, innerWidth - 4);
      for (const line of wrapped) {
        content.push("   " + style.dim(line));
      }
    }
    if (prop.examples?.length) {
      const exStr = prop.examples.map((e) => typeof e === "string" ? e : JSON.stringify(e)).join(", ");
      content.push("   " + style.dim("e.g. ") + style.dim(style.cyan(truncateVisible(exStr, innerWidth - 10))));
    }
  } else if (highlightedIdx === -1) {
    content.push("");
    content.push("   " + style.dim("Press enter to run"));
  }

  const hasUnfilledRequired = requiredFields.some((f) => !state.formValues[f.name]?.trim());
  const tabHint = hasUnfilledRequired ? " · tab next required" : "";
  const optionalHint = hasOptional ? " · o optional" : "";
  return renderLayout({
    breadcrumb: style.boldYellow("Readwise") + style.dim(" › ") + style.bold(title),
    content,
    footer: style.dim("↑↓ navigate · enter edit" + tabHint + optionalHint + " · esc back"),
  });
}

export function renderFormEditMode(
  state: AppState, title: string, fields: FormField[],
  _contentHeight: number, innerWidth: number,
): string[] {
  const field = fields[state.formEditFieldIdx]!;
  const content: string[] = [];

  content.push("");
  content.push("  " + style.bold(title));

  const toolDesc = state.formStack.length > 0
    ? state.formStack[state.formStack.length - 1]!.parentFields
        .find((f) => f.name === state.formStack[state.formStack.length - 1]!.parentFieldName)
        ?.prop.items?.description
    : state.selectedTool!.description;
  if (toolDesc) {
    const wrapped = wrapText(toolDesc, innerWidth - 4);
    for (const line of wrapped) {
      content.push("  " + style.dim(line));
    }
  }
  content.push("");

  const nameLabel = field.name + (field.required ? " *" : "");
  content.push("  " + style.bold(nameLabel));

  if (field.prop.description) {
    const wrapped = wrapText(field.prop.description, innerWidth - 4);
    for (const line of wrapped) {
      content.push("  " + style.dim(line));
    }
  }
  if (field.prop.examples?.length) {
    const exStr = field.prop.examples.map((e) => typeof e === "string" ? e : JSON.stringify(e)).join(", ");
    content.push("  " + style.dim("e.g. ") + style.dim(style.cyan(truncateVisible(exStr, innerWidth - 10))));
  }
  content.push("");

  const kind = classifyField(field.prop);
  const eVals = field.prop.enum || field.prop.items?.enum;

  if (kind === "arrayObj") {
    const existing = state.formValues[field.name] || "[]";
    let items: unknown[] = [];
    try { items = JSON.parse(existing); } catch { /* */ }
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as Record<string, unknown>;
      const summary = Object.entries(item)
        .filter(([, v]) => v != null && v !== "")
        .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(", ");
      const isCursor = i === state.formEnumCursor;
      const prefix = isCursor ? " ❯ " : "   ";
      const line = prefix + truncateVisible(summary || "(empty)", innerWidth - 6);
      content.push(isCursor ? style.boldYellow(line) : style.dim(line));
    }
    if (items.length > 0) content.push("");
    const addIdx = items.length;
    const addCursor = state.formEnumCursor === addIdx;
    if (addCursor) {
      content.push(" " + style.inverse(style.green(" + Add new item ")));
    } else {
      content.push(" " + style.dim("+") + " Add new item");
    }
  } else if (kind === "date") {
    const dateFmt = dateFieldFormat(field.prop)!;
    content.push("  " + renderDateParts(state.dateParts, state.datePartCursor, dateFmt));
  } else if (kind === "arrayEnum" && eVals) {
    for (let ci = 0; ci < eVals.length; ci++) {
      const isCursor = ci === state.formEnumCursor;
      const isChecked = state.formEnumSelected.has(ci);
      const check = isChecked ? style.cyan("[x]") : style.dim("[ ]");
      const marker = isCursor ? " › " : "   ";
      const label = marker + check + " " + eVals[ci]!;
      content.push(isCursor ? style.bold(label) : label);
    }
  } else if (kind === "arrayText") {
    const existing = state.formValues[field.name] || "";
    const items = existing ? existing.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const inputIdx = items.length;
    for (let i = 0; i < items.length; i++) {
      const isCursor = i === state.formEnumCursor;
      const prefix = isCursor ? " ❯ " : "   ";
      const line = prefix + items[i]!;
      content.push(isCursor ? style.boldYellow(line) : style.cyan(line));
    }
    if (items.length > 0) content.push("");
    const onInput = state.formEnumCursor === inputIdx;
    const inputPrefix = onInput ? " " + style.yellow("❯") + " " : "   ";
    content.push(inputPrefix + style.cyan(state.formInputBuf) + (onInput ? style.inverse(" ") : ""));
    content.push("");
    if (onInput) {
      content.push("   " + style.dim("enter  ") + style.dim(state.formInputBuf ? "add item" : "confirm"));
      content.push("   " + style.dim("esc    ") + style.dim("confirm"));
    } else {
      content.push("   " + style.dim("enter  ") + style.dim("edit item"));
      content.push("   " + style.dim("bksp   ") + style.dim("remove item"));
    }
  } else if (kind === "enum" || kind === "bool") {
    const choices = kind === "bool" ? ["true", "false"] : eVals!;
    for (let ci = 0; ci < choices.length; ci++) {
      const sel = ci === state.formEnumCursor;
      const choiceLine = (sel ? "   › " : "     ") + choices[ci]!;
      content.push(sel ? style.cyan(style.bold(choiceLine)) : choiceLine);
    }
  } else {
    const prefix0 = "  ";
    if (!state.formInputBuf) {
      let placeholder = "type a value";
      if (field.prop.examples?.length) {
        placeholder = String(field.prop.examples[0]);
      } else if (field.prop.description) {
        placeholder = field.prop.description.toLowerCase().replace(/[.!]$/, "");
      } else if (field.prop.type === "integer" || field.prop.type === "number") {
        placeholder = "enter a number";
      }
      content.push(prefix0 + style.inverse(" ") + style.dim(" " + placeholder + "…"));
    } else {
      const lines = state.formInputBuf.split("\n");
      let cursorLine = 0;
      let cursorCol = state.formInputCursorPos;
      for (let li = 0; li < lines.length; li++) {
        if (cursorCol <= lines[li]!.length) {
          cursorLine = li;
          break;
        }
        cursorCol -= lines[li]!.length + 1;
      }
      for (let li = 0; li < lines.length; li++) {
        const prefix = li === 0 ? prefix0 : "   ";
        const lineText = lines[li]!;
        if (li === cursorLine) {
          const before = lineText.slice(0, cursorCol);
          const cursorChar = cursorCol < lineText.length ? lineText[cursorCol]! : " ";
          const after = cursorCol < lineText.length ? lineText.slice(cursorCol + 1) : "";
          content.push(prefix + style.cyan(before) + style.inverse(cursorChar) + style.cyan(after));
        } else {
          content.push(prefix + style.cyan(lineText));
        }
      }
    }
  }

  if (kind === "text") {
    const requiredFields = fields.filter((f) => f.required);
    const filledCount = requiredFields.filter((f) => {
      if (f.name === field.name) return !!state.formInputBuf.trim();
      return !!state.formValues[f.name]?.trim();
    }).length;
    const remaining = requiredFields.length - filledCount;
    content.push("");
    if (remaining <= 0) {
      content.push("  " + style.dim("Then press enter to confirm → Execute"));
    } else if (remaining === 1 && !state.formInputBuf.trim()) {
      content.push("  " + style.dim("Type a value, then press enter"));
    } else {
      content.push("  " + style.dim(`${remaining} required field${remaining > 1 ? "s" : ""} remaining`));
    }
  }

  return renderLayout({
    breadcrumb: style.boldYellow("Readwise") + style.dim(" › ") + style.bold(title),
    content,
    footer: style.dim(footerForFieldKind(kind)),
  });
}
