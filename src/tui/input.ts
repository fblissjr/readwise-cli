import type { ToolDef } from "../config.js";
import type { KeyEvent } from "./term.js";
import type { AppState, View, CardItem } from "./state.js";
import { resolveProperty } from "../commands.js";
import {
  dateFieldFormat,
  parseDateParts,
  todayParts,
  datePartCount,
  adjustDatePart,
  datePartsToString,
  prevWordBoundary,
  nextWordBoundary,
  getBoxDimensions,
  wrapText,
  isArrayOfObjects,
  computeCardScroll,
  defaultFormCursor,
  EMPTY_LIST_SENTINEL,
  missingRequiredFields,
  humanLabel,
  toolPrefix
} from "./utils.js";
import {
  buildCommandList,
  selectableIndices,
  filterCommands
} from "./views/commands.js";
import {
  filterFormFields,
  popFormStack
} from "./views/form.js";
import {
  settingsChoices,
  settingsValueLabel
} from "./views/settings.js";

export function commandListReset(tools: ToolDef[]): Partial<AppState> {
  const filteredItems = buildCommandList(tools);
  const sel = selectableIndices(filteredItems);
  return {
    view: "commands" as View,
    selectedTool: null,
    searchQuery: "",
    searchCursorPos: 0,
    filteredItems,
    listCursor: sel[0] ?? 0,
    listScrollTop: 0,
  };
}

export function startEditingField(state: AppState, fieldIdx: number): AppState {
  const field = state.fields[fieldIdx]!;
  if (isArrayOfObjects(field.prop)) {
    const existing = state.formValues[field.name] || "[]";
    let items: unknown[] = [];
    try { items = JSON.parse(existing); } catch { /* */ }
    return { ...state, formEditing: true, formEditFieldIdx: fieldIdx, formEnumCursor: items.length };
  }
  const dateFmt = dateFieldFormat(field.prop);
  if (dateFmt) {
    const existing = state.formValues[field.name] || "";
    const parts = parseDateParts(existing, dateFmt) || todayParts(dateFmt);
    return { ...state, formEditing: true, formEditFieldIdx: fieldIdx, dateParts: parts, datePartCursor: 0 };
  }
  const enumValues = field.prop.enum || field.prop.items?.enum;
  const isBool = field.prop.type === "boolean";
  const isArrayEnum = !isArrayOfObjects(field.prop) && field.prop.type === "array" && !!field.prop.items?.enum;
  if (isArrayEnum && enumValues) {
    const curVal = state.formValues[field.name] || "";
    const selected = new Set<number>();
    if (curVal) {
      const parts = curVal.split(",").map((s) => s.trim());
      for (const p of parts) {
        const idx = enumValues.indexOf(p);
        if (idx >= 0) selected.add(idx);
      }
    }
    return { ...state, formEditing: true, formEditFieldIdx: fieldIdx, formEnumCursor: 0, formEnumSelected: selected };
  }
  if (enumValues || isBool) {
    const choices = isBool ? ["true", "false"] : enumValues!;
    const curVal = state.formValues[field.name] || "";
    const idx = choices.indexOf(curVal);
    return { ...state, formEditing: true, formEditFieldIdx: fieldIdx, formEnumCursor: idx >= 0 ? idx : 0 };
  }
  if (field.prop.type === "array" && !field.prop.items?.enum) {
    const existing = state.formValues[field.name] || "";
    const itemCount = existing ? existing.split(",").map((s) => s.trim()).filter(Boolean).length : 0;
    return { ...state, formEditing: true, formEditFieldIdx: fieldIdx, formInputBuf: "", formInputCursorPos: 0, formEnumCursor: itemCount };
  }
  const editBuf = state.formValues[field.name] || "";
  return { ...state, formEditing: true, formEditFieldIdx: fieldIdx, formInputBuf: editBuf, formInputCursorPos: editBuf.length };
}

export function handleCommandListInput(state: AppState, key: KeyEvent): AppState | "exit" {
  const items = state.filteredItems;
  const selectable = selectableIndices(items);
  const { contentHeight } = getBoxDimensions();
  const logoUsed = 9; // LOGO.length (5) + blank + search line + blank + header etc.
  const listHeight = Math.max(1, contentHeight - logoUsed);

  if (key.name === "escape" || (key.ctrl && key.name === "c")) {
    if (state.searchQuery) {
      const filtered = filterCommands(state.tools, "");
      const sel = selectableIndices(filtered);
      return { ...state, searchQuery: "", searchCursorPos: 0, filteredItems: filtered, listCursor: sel[0] ?? 0, listScrollTop: 0, quitConfirm: false };
    }
    if (state.quitConfirm) return "exit";
    return { ...state, quitConfirm: true };
  }

  if (key.name === "q" && !key.ctrl && !state.searchQuery) {
    if (state.quitConfirm) return "exit";
    return { ...state, quitConfirm: true };
  }

  const s = state.quitConfirm ? { ...state, quitConfirm: false } : state;

  if (key.name === "left") {
    return { ...s, searchCursorPos: Math.max(0, s.searchCursorPos - 1) };
  }
  if (key.name === "right") {
    return { ...s, searchCursorPos: Math.min(s.searchQuery.length, s.searchCursorPos + 1) };
  }

  if (key.name === "up") {
    const curIdx = selectable.indexOf(s.listCursor);
    if (curIdx > 0) {
      const next = selectable[curIdx - 1]!;
      let scroll = s.listScrollTop;
      if (next < scroll) scroll = next;
      return { ...s, listCursor: next, listScrollTop: scroll };
    }
    return s;
  }
  if (key.name === "down") {
    const curIdx = selectable.indexOf(s.listCursor);
    if (curIdx < selectable.length - 1) {
      const next = selectable[curIdx + 1]!;
      let scroll = s.listScrollTop;
      if (next >= scroll + listHeight) scroll = next - listHeight + 1;
      return { ...s, listCursor: next, listScrollTop: scroll };
    }
    return s;
  }

  if (key.name === "pageup") {
    const curIdx = selectable.indexOf(s.listCursor);
    const next = selectable[Math.max(0, curIdx - listHeight)]!;
    let scroll = s.listScrollTop;
    if (next < scroll) scroll = next;
    return { ...s, listCursor: next, listScrollTop: scroll };
  }
  if (key.name === "pagedown") {
    const curIdx = selectable.indexOf(s.listCursor);
    const next = selectable[Math.min(selectable.length - 1, curIdx + listHeight)]!;
    let scroll = s.listScrollTop;
    if (next >= scroll + listHeight) scroll = next - listHeight + 1;
    return { ...s, listCursor: next, listScrollTop: scroll };
  }

  if (key.name === "return") {
    const item = items[s.listCursor];
    if (item && !item.isSeparator && item.value === "__settings__") {
      return { ...s, view: "settings" as View, settingsCursor: 0, settingsEntries: [], settingsEditing: false, settingsEditCursor: 0 };
    }
    if (item && !item.isSeparator) {
      const tool = s.tools.find((t) => t.name === item.value);
      if (tool) {
        const properties = tool.inputSchema.properties || {};
        const requiredSet = new Set(tool.inputSchema.required || []);
        const defs = tool.inputSchema.$defs;
        const fields = Object.entries(properties).map(([name, rawProp]) => ({
          name,
          prop: resolveProperty(rawProp, defs),
          required: requiredSet.has(name),
        }));
        const nameColWidth = Math.max(
          ...fields.map((f) => f.name.length + (f.required ? 2 : 0)),
          6
        ) + 1;

        const formValues: Record<string, string> = {};
        for (const f of fields) {
          formValues[f.name] = "";
        }

        if (fields.length === 0) {
          return {
            ...s,
            view: "loading",
            selectedTool: tool,
            fields,
            nameColWidth,
            formValues,
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
            formShowRequired: false, formShowOptional: false,
            formStack: [],
          };
        }

        const filteredIndices = filterFormFields(fields, "");
        const firstBlankRequired = fields.findIndex((f) => f.required && !formValues[f.name]?.trim());

        const baseState: AppState = {
          ...s,
          view: "form" as View,
          selectedTool: tool,
          fields,
          nameColWidth,
          formValues,
          formSearchQuery: "",
          formSearchCursorPos: 0,
          formFilteredIndices: filteredIndices,
          formListCursor: defaultFormCursor(fields, filteredIndices, formValues),
          formScrollTop: 0,
          formEditFieldIdx: -1,
          formEditing: false,
          formInputBuf: "",
          formInputCursorPos: 0,
          formEnumCursor: 0,
          formEnumSelected: new Set(),
          formShowRequired: false, formShowOptional: false,
          formStack: [],
        };

        if (firstBlankRequired >= 0) {
          return startEditingField(baseState, firstBlankRequired);
        }
        return baseState;
      }
    }
    return s;
  }

  if (key.name === "backspace") {
    if (s.searchCursorPos > 0) {
      const newQuery = s.searchQuery.slice(0, s.searchCursorPos - 1) + s.searchQuery.slice(s.searchCursorPos);
      const filtered = filterCommands(s.tools, newQuery);
      const sel = selectableIndices(filtered);
      return { ...s, searchQuery: newQuery, searchCursorPos: s.searchCursorPos - 1, filteredItems: filtered, listCursor: sel[0] ?? 0, listScrollTop: 0 };
    }
    return s;
  }

  if (key.name === "paste" || (!key.ctrl && key.raw && key.raw.length === 1 && key.raw >= " ")) {
    const text = (key.name === "paste" ? key.raw.replace(/[\x00-\x1f\x7f]/g, "") : key.raw) || "";
    if (text) {
      const newQuery = s.searchQuery.slice(0, s.searchCursorPos) + text + s.searchQuery.slice(s.searchCursorPos);
      const filtered = filterCommands(s.tools, newQuery);
      const sel = selectableIndices(filtered);
      return { ...s, searchQuery: newQuery, searchCursorPos: s.searchCursorPos + text.length, filteredItems: filtered, listCursor: sel[0] ?? 0, listScrollTop: 0 };
    }
  }

  return s;
}

export function handleCommandBuilderReadyInput(state: AppState, key: KeyEvent): AppState | "submit" {
  if (key.name === "escape" || (key.ctrl && key.name === "c")) {
    return { ...state, ...commandListReset(state.tools) };
  }

  if (key.name === "return") {
    if (missingRequiredFields(state.fields, state.formValues).length === 0) {
      return "submit";
    }
    const nextBlank = state.fields.findIndex((f) => f.required && !state.formValues[f.name]?.trim());
    if (nextBlank >= 0) {
      return startEditingField(state, nextBlank);
    }
    return state;
  }

  if (key.name === "tab") {
    const hasOptional = state.fields.some((f) => !f.required);
    if (hasOptional) {
      return { ...state, formShowOptional: true, formListCursor: 0 };
    }
    return state;
  }

  if (key.name === "backspace") {
    for (let i = state.fields.length - 1; i >= 0; i--) {
      if (state.formValues[state.fields[i]!.name]?.trim()) {
        return startEditingField(state, i);
      }
    }
    return state;
  }

  return state;
}

export function handleOptionalPickerInput(state: AppState, key: KeyEvent): AppState | "submit" {
  const optionalFields = state.fields
    .map((f, i) => ({ field: f, idx: i }))
    .filter(({ field }) => !field.required);

  if (key.name === "escape" || (key.ctrl && key.name === "c")) {
    return { ...state, formShowOptional: false };
  }

  if (key.name === "up") {
    return { ...state, formListCursor: state.formListCursor > 0 ? state.formListCursor - 1 : optionalFields.length - 1 };
  }
  if (key.name === "down") {
    return { ...state, formListCursor: state.formListCursor < optionalFields.length - 1 ? state.formListCursor + 1 : 0 };
  }

  if (key.name === "return") {
    const selected = optionalFields[state.formListCursor];
    if (selected) {
      return startEditingField({ ...state, formShowOptional: false }, selected.idx);
    }
  }

  return state;
}

export function handleFormPaletteInput(state: AppState, key: KeyEvent): AppState | "submit" {
  const { fields, formFilteredIndices: filtered, formListCursor, formSearchQuery } = state;
  const { contentHeight } = getBoxDimensions();
  const headerUsed = 6 + (state.selectedTool?.description ? wrapText(state.selectedTool.description, getBoxDimensions().innerWidth - 4).length : 0);
  const listHeight = Math.max(1, contentHeight - headerUsed - 8);

  if (key.ctrl && key.name === "c") return "submit";

  if (key.name === "escape") {
    if (formSearchQuery) {
      const newFiltered = filterFormFields(fields, "");
      return { ...state, formSearchQuery: "", formSearchCursorPos: 0, formFilteredIndices: newFiltered, formListCursor: defaultFormCursor(fields, newFiltered, state.formValues), formScrollTop: 0 };
    }
    if (state.formStack.length > 0) {
      const stack = [...state.formStack];
      const entry = stack.pop()!;
      const parentFiltered = filterFormFields(entry.parentFields, "");
      const parentFieldIdx = entry.parentFields.findIndex((f) => f.name === entry.parentFieldName);
      const existing = entry.parentValues[entry.parentFieldName] || "[]";
      let items: unknown[] = [];
      try { items = JSON.parse(existing); } catch { /* */ }
      return {
        ...state,
        formStack: stack,
        fields: entry.parentFields,
        nameColWidth: entry.parentNameColWidth,
        formValues: entry.parentValues,
        formEditing: true,
        formEditFieldIdx: parentFieldIdx,
        formEnumCursor: items.length,
        formEnumSelected: new Set(),
        formSearchQuery: "",
        formSearchCursorPos: 0,
        formFilteredIndices: parentFiltered,
        formListCursor: defaultFormCursor(entry.parentFields, parentFiltered, entry.parentValues),
        formScrollTop: 0,
        formShowRequired: false, formShowOptional: false,
        formInputBuf: "",
        formInputCursorPos: 0,
      };
    }
    return { ...state, ...commandListReset(state.tools) };
  }

  if (key.name === "tab") {
    const unfilledRequired = filtered
      .map((idx, listPos) => ({ idx, listPos }))
      .filter(({ idx }) => {
        if (idx < 0 || idx >= fields.length) return false;
        const f = fields[idx]!;
        if (!f.required) return false;
        const val = state.formValues[f.name]?.trim();
        if (!val) return true;
        if (isArrayOfObjects(f.prop)) {
          try { return JSON.parse(val).length === 0; } catch { return true; }
        }
        return false;
      });
    if (unfilledRequired.length > 0) {
      const after = unfilledRequired.find((u) => u.listPos > formListCursor);
      const target = after || unfilledRequired[0]!;
      let scroll = state.formScrollTop;
      const paramItems = filtered.filter((idx) => idx !== -1);
      if (target.idx >= 0) {
        const posInParams = paramItems.indexOf(target.idx);
        if (posInParams < scroll) scroll = posInParams;
        if (posInParams >= scroll + listHeight) scroll = posInParams - listHeight + 1;
      }
      return { ...state, formListCursor: target.listPos, formScrollTop: scroll };
    }
    const execPos = filtered.indexOf(-1);
    if (execPos >= 0) return { ...state, formListCursor: execPos };
    return state;
  }

  if (key.raw === "o" && !key.ctrl && !formSearchQuery) {
    const optionalExists = filtered.some((idx) => idx >= 0 && idx < fields.length && !fields[idx]!.required);
    if (optionalExists) {
      const newShow = !state.formShowOptional;
      if (!newShow) {
        const curIdx = filtered[formListCursor];
        if (curIdx !== undefined && curIdx >= 0 && curIdx < fields.length && !fields[curIdx]!.required) {
          const execPos = filtered.indexOf(-1);
          return { ...state, formShowOptional: false, formListCursor: execPos >= 0 ? execPos : 0 };
        }
      }
      return { ...state, formShowOptional: newShow };
    }
  }

  if (key.name === "left") {
    return { ...state, formSearchCursorPos: Math.max(0, state.formSearchCursorPos - 1) };
  }
  if (key.name === "right") {
    return { ...state, formSearchCursorPos: Math.min(formSearchQuery.length, state.formSearchCursorPos + 1) };
  }

  const isNavigable = (listPos: number) => {
    const idx = filtered[listPos];
    if (idx === undefined) return false;
    if (idx === -1) return true;
    if (!state.formShowOptional && !state.formSearchQuery && idx >= 0 && idx < fields.length && !fields[idx]!.required) return false;
    return true;
  };

  if (key.name === "up") {
    let next = formListCursor;
    for (let i = 0; i < filtered.length; i++) {
      next = next > 0 ? next - 1 : filtered.length - 1;
      if (isNavigable(next)) break;
    }
    let scroll = state.formScrollTop;
    const itemIdx = filtered[next]!;
    if (itemIdx !== -1) {
      const paramItems = filtered.filter((idx) => idx !== -1);
      const posInParams = paramItems.indexOf(itemIdx);
      if (posInParams < scroll) scroll = posInParams;
      if (next > formListCursor) scroll = Math.max(0, paramItems.length - listHeight);
    }
    return { ...state, formListCursor: next, formScrollTop: scroll };
  }
  if (key.name === "down") {
    let next = formListCursor;
    for (let i = 0; i < filtered.length; i++) {
      next = next < filtered.length - 1 ? next + 1 : 0;
      if (isNavigable(next)) break;
    }
    let scroll = state.formScrollTop;
    const itemIdx = filtered[next]!;
    if (itemIdx !== -1) {
      const paramItems = filtered.filter((idx) => idx !== -1);
      const posInParams = paramItems.indexOf(itemIdx);
      if (posInParams >= scroll + listHeight) scroll = posInParams - listHeight + 1;
      if (next < formListCursor) scroll = 0;
    } else if (next < formListCursor) {
      scroll = 0;
    }
    return { ...state, formListCursor: next, formScrollTop: scroll };
  }

  if (key.name === "return") {
    const highlightedIdx = filtered[formListCursor];
    if (highlightedIdx === -1) {
      if (missingRequiredFields(fields, state.formValues).length === 0) {
        if (state.formStack.length > 0) {
          return popFormStack(state);
        }
        return "submit";
      }
      return { ...state, formShowRequired: true };
    }
    if (highlightedIdx !== undefined && highlightedIdx >= 0 && highlightedIdx < fields.length) {
      return startEditingField(state, highlightedIdx);
    }
    return state;
  }

  if (key.name === "backspace") {
    if (state.formSearchCursorPos > 0) {
      const newQuery = formSearchQuery.slice(0, state.formSearchCursorPos - 1) + formSearchQuery.slice(state.formSearchCursorPos);
      const newFiltered = filterFormFields(fields, newQuery);
      return { ...state, formSearchQuery: newQuery, formSearchCursorPos: state.formSearchCursorPos - 1, formFilteredIndices: newFiltered, formListCursor: 0, formScrollTop: 0 };
    }
    return state;
  }

  if (key.name === "paste" || (!key.ctrl && key.raw && key.raw.length === 1 && key.raw >= " ")) {
    const text = (key.name === "paste" ? key.raw.replace(/[\x00-\x1f\x7f]/g, "") : key.raw) || "";
    if (text) {
      const newQuery = formSearchQuery.slice(0, state.formSearchCursorPos) + text + formSearchQuery.slice(state.formSearchCursorPos);
      const newFiltered = filterFormFields(fields, newQuery);
      return { ...state, formSearchQuery: newQuery, formSearchCursorPos: state.formSearchCursorPos + text.length, formFilteredIndices: newFiltered, formListCursor: 0, formScrollTop: 0 };
    }
  }

  return state;
}

export function handleFormEditInput(state: AppState, key: KeyEvent): AppState | "submit" {
  const { fields, formEditFieldIdx, formInputBuf, formEnumCursor, formValues } = state;
  const field = fields[formEditFieldIdx]!;
  const dateFmt = dateFieldFormat(field.prop);
  const enumValues = field.prop.enum || field.prop.items?.enum;
  const isBool = field.prop.type === "boolean";

  const resetPalette = (updatedValues?: Record<string, string>) => {
    const f = filterFormFields(fields, "");
    return {
      formSearchQuery: "",
      formSearchCursorPos: 0,
      formFilteredIndices: f,
      formListCursor: defaultFormCursor(fields, f, updatedValues ?? formValues),
      formScrollTop: 0,
      formShowRequired: false,
      formShowOptional: false,
    };
  };

  if (key.name === "escape") {
    const isArrayEnum = field.prop.type === "array" && !!field.prop.items?.enum;
    if (isArrayEnum && enumValues) {
      const selected = [...state.formEnumSelected].sort((a, b) => a - b).map((i) => enumValues[i]!);
      const val = selected.join(", ");
      const newValues = { ...formValues, [field.name]: val };
      return { ...state, formEditing: false, formEditFieldIdx: -1, formValues: newValues, formEnumSelected: new Set(), ...resetPalette(newValues) };
    }
    return { ...state, formEditing: false, formEditFieldIdx: -1, formInputBuf: "", formInputCursorPos: 0, ...resetPalette() };
  }

  if (key.ctrl && key.name === "c") return "submit";

  if (isArrayOfObjects(field.prop)) {
    const existing = formValues[field.name] || "[]";
    let items: unknown[] = [];
    try { items = JSON.parse(existing); } catch { /* */ }
    const addIdx = items.length;
    const total = items.length + 1;

    if (key.name === "up") {
      return { ...state, formEnumCursor: formEnumCursor > 0 ? formEnumCursor - 1 : total - 1 };
    }
    if (key.name === "down") {
      return { ...state, formEnumCursor: formEnumCursor < total - 1 ? formEnumCursor + 1 : 0 };
    }
    if (key.name === "return") {
      const editingExisting = formEnumCursor < addIdx;
      const itemSchema = field.prop.items!;
      const defs = state.selectedTool?.inputSchema.$defs;
      const subProperties = itemSchema.properties || {};
      const subRequired = new Set(itemSchema.required || []);
      const subFields = Object.entries(subProperties).map(([name, rawProp]) => ({
        name,
        prop: resolveProperty(rawProp, defs),
        required: subRequired.has(name),
      }));
      const subValues: Record<string, string> = {};
      if (editingExisting) {
        const existingItem = items[formEnumCursor] as Record<string, unknown>;
        for (const f of subFields) {
          const v = existingItem[f.name];
          if (v == null) {
            subValues[f.name] = f.prop.default != null ? String(f.prop.default) : "";
          } else if (Array.isArray(v)) {
            subValues[f.name] = JSON.stringify(v);
          } else {
            subValues[f.name] = String(v);
          }
        }
      } else {
        for (const f of subFields) {
          subValues[f.name] = f.prop.default != null ? String(f.prop.default) : "";
        }
      }
      const subFiltered = filterFormFields(subFields, "");
      const toolTitle = humanLabel(state.selectedTool!.name, toolPrefix(state.selectedTool!));
      return {
        ...state,
        formStack: [...state.formStack, {
          parentFieldName: field.name,
          parentFields: fields,
          parentValues: formValues,
          parentNameColWidth: state.nameColWidth,
          parentTitle: toolTitle,
          editIndex: editingExisting ? formEnumCursor : -1,
        }],
        fields: subFields,
        nameColWidth: Math.max(...subFields.map((f) => f.name.length + (f.required ? 2 : 0)), 6) + 1,
        formValues: subValues,
        formEditing: false,
        formEditFieldIdx: -1,
        formSearchQuery: "",
        formSearchCursorPos: 0,
        formFilteredIndices: subFiltered,
        formListCursor: defaultFormCursor(subFields, subFiltered, subValues),
        formScrollTop: 0,
        formShowRequired: false, formShowOptional: false,
        formEnumCursor: 0,
        formEnumSelected: new Set(),
        formInputBuf: "",
        formInputCursorPos: 0,
      };
    }
    if (key.name === "backspace" && formEnumCursor < items.length) {
      const newItems = [...items];
      newItems.splice(formEnumCursor, 1);
      const newValues = { ...formValues, [field.name]: JSON.stringify(newItems) };
      const newCursor = Math.min(formEnumCursor, newItems.length);
      return { ...state, formValues: newValues, formEnumCursor: newCursor };
    }
    return state;
  }

  if (dateFmt) {
    const maxPart = datePartCount(dateFmt) - 1;
    if (key.name === "left") {
      return { ...state, datePartCursor: Math.max(0, state.datePartCursor - 1) };
    }
    if (key.name === "right") {
      return { ...state, datePartCursor: Math.min(maxPart, state.datePartCursor + 1) };
    }
    if (key.name === "up") {
      return { ...state, dateParts: adjustDatePart(state.dateParts, state.datePartCursor, 1, dateFmt) };
    }
    if (key.name === "down") {
      return { ...state, dateParts: adjustDatePart(state.dateParts, state.datePartCursor, -1, dateFmt) };
    }
    if (key.name === "return") {
      const val = datePartsToString(state.dateParts, dateFmt);
      const newValues = { ...formValues, [field.name]: val };
      return { ...state, formEditing: false, formEditFieldIdx: -1, formValues: newValues, ...resetPalette(newValues) };
    }
    if (key.name === "t") {
      return { ...state, dateParts: todayParts(dateFmt), datePartCursor: 0 };
    }
    if (key.name === "backspace") {
      const newValues = { ...formValues, [field.name]: "" };
      return { ...state, formEditing: false, formEditFieldIdx: -1, formValues: newValues, ...resetPalette(newValues) };
    }
    return state;
  }

  const isArrayEnum = field.prop.type === "array" && !!field.prop.items?.enum;
  if (isArrayEnum && enumValues) {
    if (key.name === "up") {
      return { ...state, formEnumCursor: formEnumCursor <= 0 ? enumValues.length - 1 : formEnumCursor - 1 };
    }
    if (key.name === "down") {
      return { ...state, formEnumCursor: formEnumCursor >= enumValues.length - 1 ? 0 : formEnumCursor + 1 };
    }
    if (key.name === " " || key.raw === " ") {
      const next = new Set(state.formEnumSelected);
      if (next.has(formEnumCursor)) next.delete(formEnumCursor);
      else next.add(formEnumCursor);
      return { ...state, formEnumSelected: next };
    }
    if (key.name === "return") {
      const next = new Set(state.formEnumSelected);
      next.add(formEnumCursor);
      const selected = [...next].sort((a, b) => a - b).map((i) => enumValues[i]!);
      const val = selected.join(", ");
      const newValues = { ...formValues, [field.name]: val };
      return { ...state, formEditing: false, formEditFieldIdx: -1, formValues: newValues, formEnumSelected: new Set(), ...resetPalette(newValues) };
    }
    return state;
  }

  if (enumValues || isBool) {
    const choices = isBool ? ["true", "false"] : enumValues!;
    if (key.name === "up") {
      return { ...state, formEnumCursor: formEnumCursor <= 0 ? choices.length - 1 : formEnumCursor - 1 };
    }
    if (key.name === "down") {
      return { ...state, formEnumCursor: formEnumCursor >= choices.length - 1 ? 0 : formEnumCursor + 1 };
    }
    if (key.name === "return") {
      const val = choices[formEnumCursor]!;
      const newValues = { ...formValues, [field.name]: val };
      return { ...state, formEditing: false, formEditFieldIdx: -1, formValues: newValues, ...resetPalette(newValues) };
    }
    return state;
  }

  const isArrayText = field.prop.type === "array" && !field.prop.items?.enum;
  if (isArrayText) {
    const existing = formValues[field.name] || "";
    const items = existing ? existing.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const inputIdx = items.length;
    const total = items.length + 1;

    if (key.name === "up") {
      return { ...state, formEnumCursor: formEnumCursor > 0 ? formEnumCursor - 1 : total - 1 };
    }
    if (key.name === "down") {
      return { ...state, formEnumCursor: formEnumCursor < total - 1 ? formEnumCursor + 1 : 0 };
    }

    if (formEnumCursor < inputIdx) {
      if (key.name === "return") {
        const editVal = items[formEnumCursor]!;
        const newItems = [...items];
        newItems.splice(formEnumCursor, 1);
        const newValues = { ...formValues, [field.name]: newItems.join(", ") };
        return { ...state, formValues: newValues, formInputBuf: editVal, formInputCursorPos: editVal.length, formEnumCursor: newItems.length };
      }
      if (key.name === "backspace") {
        const newItems = [...items];
        newItems.splice(formEnumCursor, 1);
        const newValues = { ...formValues, [field.name]: newItems.join(", ") };
        const newCursor = Math.min(formEnumCursor, newItems.length);
        return { ...state, formValues: newValues, formEnumCursor: newCursor };
      }
      return state;
    }

    if (key.name === "paste") {
      const text = key.raw.replace(/\n/g, "");
      return { ...state, formInputBuf: formInputBuf + text, formInputCursorPos: formInputBuf.length + text.length };
    }
    if (key.name === "return") {
      if (formInputBuf.trim()) {
        items.push(formInputBuf.trim());
        const newValues = { ...formValues, [field.name]: items.join(", ") };
        return { ...state, formValues: newValues, formInputBuf: "", formInputCursorPos: 0, formEnumCursor: items.length };
      }
      const newValues = { ...formValues, [field.name]: items.join(", ") };
      return { ...state, formEditing: false, formEditFieldIdx: -1, formValues: newValues, ...resetPalette(newValues) };
    }
    if (key.name === "backspace") {
      if (formInputBuf) {
        return { ...state, formInputBuf: formInputBuf.slice(0, -1), formInputCursorPos: formInputBuf.length - 1 };
      }
      return state;
    }
    if (!key.ctrl && key.name !== "escape" && !key.raw.startsWith("\x1b")) {
      const clean = key.raw.replace(/[\x00-\x1f\x7f]/g, "");
      if (clean) return { ...state, formInputBuf: formInputBuf + clean, formInputCursorPos: formInputBuf.length + clean.length };
    }
    return state;
  }

  const pos = state.formInputCursorPos;
  if (key.name === "paste") {
    const newBuf = formInputBuf.slice(0, pos) + key.raw + formInputBuf.slice(pos);
    return { ...state, formInputBuf: newBuf, formInputCursorPos: pos + key.raw.length };
  }
  if (key.raw === "\n" || (key.name === "return" && key.shift)) {
    const newBuf = formInputBuf.slice(0, pos) + "\n" + formInputBuf.slice(pos);
    return { ...state, formInputBuf: newBuf, formInputCursorPos: pos + 1 };
  }
  if (key.name === "return") {
    const newValues = { ...formValues, [field.name]: formInputBuf };
    return { ...state, formEditing: false, formEditFieldIdx: -1, formInputCursorPos: 0, formValues: newValues, ...resetPalette(newValues) };
  }
  if (key.name === "left") {
    return { ...state, formInputCursorPos: Math.max(0, pos - 1) };
  }
  if (key.name === "right") {
    return { ...state, formInputCursorPos: Math.min(formInputBuf.length, pos + 1) };
  }
  if (key.name === "wordLeft") {
    return { ...state, formInputCursorPos: prevWordBoundary(formInputBuf, pos) };
  }
  if (key.name === "wordRight") {
    return { ...state, formInputCursorPos: nextWordBoundary(formInputBuf, pos) };
  }
  if (key.name === "wordBackspace") {
    const boundary = prevWordBoundary(formInputBuf, pos);
    const newBuf = formInputBuf.slice(0, boundary) + formInputBuf.slice(pos);
    return { ...state, formInputBuf: newBuf, formInputCursorPos: boundary };
  }
  if (key.name === "up") {
    const lines = formInputBuf.split("\n");
    let rem = pos;
    let line = 0;
    for (; line < lines.length; line++) {
      if (rem <= lines[line]!.length) break;
      rem -= lines[line]!.length + 1;
    }
    if (line > 0) {
      const col = Math.min(rem, lines[line - 1]!.length);
      let newPos = 0;
      for (let i = 0; i < line - 1; i++) newPos += lines[i]!.length + 1;
      newPos += col;
      return { ...state, formInputCursorPos: newPos };
    }
    return state;
  }
  if (key.name === "down") {
    const lines = formInputBuf.split("\n");
    let rem = pos;
    let line = 0;
    for (; line < lines.length; line++) {
      if (rem <= lines[line]!.length) break;
      rem -= lines[line]!.length + 1;
    }
    if (line < lines.length - 1) {
      const col = Math.min(rem, lines[line + 1]!.length);
      let newPos = 0;
      for (let i = 0; i <= line; i++) newPos += lines[i]!.length + 1;
      newPos += col;
      return { ...state, formInputCursorPos: newPos };
    }
    return state;
  }
  if (key.name === "backspace") {
    if (pos > 0) {
      const newBuf = formInputBuf.slice(0, pos - 1) + formInputBuf.slice(pos);
      return { ...state, formInputBuf: newBuf, formInputCursorPos: pos - 1 };
    }
    return state;
  }
  if (!key.ctrl && key.name !== "escape" && !key.raw.startsWith("\x1b")) {
    const clean = key.raw.replace(/[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/g, "");
    if (clean) {
      const newBuf = formInputBuf.slice(0, pos) + clean + formInputBuf.slice(pos);
      return { ...state, formInputBuf: newBuf, formInputCursorPos: pos + clean.length };
    }
  }
  return state;
}

export function handleResultsInput(state: AppState, key: KeyEvent): AppState | "exit" | "openUrl" {
  const { contentHeight } = getBoxDimensions();
  const inCardMode = state.resultCards.length > 0 && !state.error;

  if (key.ctrl && key.name === "c") {
    if (state.quitConfirm) return "exit";
    return { ...state, quitConfirm: true };
  }

  if (key.name === "q" && !key.ctrl) {
    if (state.quitConfirm) return "exit";
    return { ...state, quitConfirm: true };
  }

  const s = state.quitConfirm ? { ...state, quitConfirm: false } : state;

  const resultsClear = { result: "", error: "", resultScroll: 0, resultScrollX: 0, resultCards: [] as CardItem[], resultCursor: 0, resultCardScroll: 0 };

  const goBack = (): AppState => {
    const isEmpty = !s.error && s.result !== EMPTY_LIST_SENTINEL && !s.result.trim();
    const hasParams = !isEmpty && s.selectedTool && Object.keys(s.selectedTool.inputSchema.properties || {}).length > 0;
    if (hasParams) {
      const f = filterFormFields(s.fields, "");
      return {
        ...s,
        view: "form" as View,
        ...resultsClear,
        formSearchQuery: "",
        formSearchCursorPos: 0,
        formFilteredIndices: f,
        formListCursor: defaultFormCursor(s.fields, f, s.formValues),
        formScrollTop: 0,
        formEditing: false,
        formEditFieldIdx: -1,
        formShowRequired: false,
        formShowOptional: false,
      };
    }
    return { ...s, ...commandListReset(s.tools), ...resultsClear };
  };

  if (key.name === "escape") {
    return goBack();
  }

  if (inCardMode) {
    const cards = s.resultCards;
    const availableHeight = Math.max(1, contentHeight - 2);

    if (key.name === "return") {
      const card = cards[s.resultCursor];
      if (card?.url) return "openUrl";
      return goBack();
    }

    if (key.name === "up") {
      if (s.resultCursor > 0) {
        const newCursor = s.resultCursor - 1;
        const newScroll = computeCardScroll(cards, newCursor, s.resultCardScroll, availableHeight);
        return { ...s, resultCursor: newCursor, resultCardScroll: newScroll };
      }
      return s;
    }
    if (key.name === "down") {
      if (s.resultCursor < cards.length - 1) {
        const newCursor = s.resultCursor + 1;
        const newScroll = computeCardScroll(cards, newCursor, s.resultCardScroll, availableHeight);
        return { ...s, resultCursor: newCursor, resultCardScroll: newScroll };
      }
      return s;
    }
    if (key.name === "pageup") {
      const newCursor = Math.max(0, s.resultCursor - 5);
      const newScroll = computeCardScroll(cards, newCursor, s.resultCardScroll, availableHeight);
      return { ...s, resultCursor: newCursor, resultCardScroll: newScroll };
    }
    if (key.name === "pagedown") {
      const newCursor = Math.min(cards.length - 1, s.resultCursor + 5);
      const newScroll = computeCardScroll(cards, newCursor, s.resultCardScroll, availableHeight);
      return { ...s, resultCursor: newCursor, resultCardScroll: newScroll };
    }

    return s;
  }

  const contentLines = (state.error || state.result).split("\n");
  const visibleCount = Math.max(1, contentHeight - 3);

  if (key.name === "return") {
    return goBack();
  }
  if (key.name === "up") {
    return { ...s, resultScroll: Math.max(0, s.resultScroll - 1) };
  }
  if (key.name === "down") {
    return { ...s, resultScroll: Math.min(Math.max(0, contentLines.length - visibleCount), s.resultScroll + 1) };
  }
  if (key.name === "left") {
    return { ...s, resultScrollX: Math.max(0, s.resultScrollX - 4) };
  }
  if (key.name === "right") {
    return { ...s, resultScrollX: s.resultScrollX + 4 };
  }
  if (key.name === "pageup") {
    return { ...s, resultScroll: Math.max(0, s.resultScroll - visibleCount) };
  }
  if (key.name === "pagedown") {
    return { ...s, resultScroll: Math.min(Math.max(0, contentLines.length - visibleCount), s.resultScroll + visibleCount) };
  }

  return s;
}

export function handleSettingsInput(state: AppState, key: KeyEvent): AppState | "settingsToggle" {
  if (state.settingsEditing) {
    const entry = state.settingsEntries[state.settingsCursor];
    if (!entry) return { ...state, settingsEditing: false };
    const choices = settingsChoices(entry);

    if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      return { ...state, settingsEditing: false };
    }
    if (key.name === "up") {
      return { ...state, settingsEditCursor: state.settingsEditCursor <= 0 ? choices.length - 1 : state.settingsEditCursor - 1 };
    }
    if (key.name === "down") {
      return { ...state, settingsEditCursor: state.settingsEditCursor >= choices.length - 1 ? 0 : state.settingsEditCursor + 1 };
    }
    if (key.name === "return") {
      return "settingsToggle";
    }
    return state;
  }

  if (key.name === "escape" || (key.ctrl && key.name === "c")) {
    return { ...state, ...commandListReset(state.tools) };
  }
  if (key.name === "up") {
    return { ...state, settingsCursor: Math.max(0, state.settingsCursor - 1) };
  }
  if (key.name === "down") {
    return { ...state, settingsCursor: Math.min(state.settingsEntries.length - 1, state.settingsCursor + 1) };
  }
  if (key.name === "return" && state.settingsEntries.length > 0) {
    const entry = state.settingsEntries[state.settingsCursor]!;
    const choices = settingsChoices(entry);
    const currentLabel = settingsValueLabel(entry.value);
    const cursorIdx = choices.indexOf(currentLabel);
    return { ...state, settingsEditing: true, settingsEditCursor: cursorIdx >= 0 ? cursorIdx : 0 };
  }

  return state;
}

export function handleFormInput(state: AppState, key: KeyEvent): AppState | "submit" {
  if (state.formStack.length > 0) {
    if (state.formEditing) return handleFormEditInput(state, key);
    return handleFormPaletteInput(state, key);
  }

  if (state.formEditing) {
    const result = handleFormEditInput(state, key);
    if (result === "submit") return result;
    if (!result.formEditing && state.formEditing) {
      const wasCancel = key.name === "escape";
      if (!wasCancel) {
        const nextBlank = result.fields.findIndex((f) => f.required && !result.formValues[f.name]?.trim());
        if (nextBlank >= 0) {
          return startEditingField(result, nextBlank);
        }
      }
    }
    return result;
  }

  if (state.formShowOptional) {
    return handleOptionalPickerInput(state, key);
  }

  return handleCommandBuilderReadyInput(state, key);
}

export function handleInput(state: AppState, key: KeyEvent): AppState | "exit" | "submit" | "openUrl" | "settingsToggle" {
  switch (state.view) {
    case "commands": return handleCommandListInput(state, key);
    case "form": return handleFormInput(state, key);
    case "results": return handleResultsInput(state, key);
    case "settings": return handleSettingsInput(state, key);
    default: return state;
  }
}
