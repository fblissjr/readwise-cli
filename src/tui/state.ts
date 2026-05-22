import type { ToolDef, SchemaProperty } from "../config.js";

export type View = "commands" | "form" | "loading" | "results" | "settings";

export interface FormField {
  name: string;
  prop: SchemaProperty;
  required: boolean;
}

export interface FormStackEntry {
  parentFieldName: string;   // field name in parent form (e.g. "highlights")
  parentFields: FormField[];
  parentValues: Record<string, string>;
  parentNameColWidth: number;
  parentTitle: string;        // for breadcrumb
  editIndex: number;          // -1 = adding new item, >= 0 = editing existing item at this index
}

export type CardKind = "document" | "highlight";

export interface CardItem {
  kind: CardKind;
  title: string;
  summary: string;
  note: string;       // highlight note (only for highlights)
  meta: string;       // "Source · Author · 12 min"
  url: string;        // for opening on enter
  raw: Record<string, unknown>;  // full object for fallback
}

export interface ListItem {
  label: string;
  value: string;
  description?: string;
  isSeparator?: boolean;
}

export interface AppState {
  view: View;
  tools: ToolDef[];       // currently visible tools (may be filtered)
  allTools: ToolDef[];    // full unfiltered tool list
  // Command list
  listCursor: number;
  listScrollTop: number;
  quitConfirm: boolean;
  searchQuery: string;
  searchCursorPos: number;
  filteredItems: ListItem[];
  // Form
  selectedTool: ToolDef | null;
  fields: FormField[];
  nameColWidth: number;
  formSearchQuery: string;
  formSearchCursorPos: number;
  formFilteredIndices: number[];
  formListCursor: number;
  formScrollTop: number;
  formEditFieldIdx: number;
  formEditing: boolean;
  formInputBuf: string;
  formInputCursorPos: number;
  formEnumCursor: number;
  formEnumSelected: Set<number>;
  formValues: Record<string, string>;
  formShowRequired: boolean;
  formShowOptional: boolean;
  formStack: FormStackEntry[];
  // Date picker
  dateParts: number[];       // [year, month, day] or [year, month, day, hour, minute]
  datePartCursor: number;    // which part is focused
  // Results
  result: string;
  error: string;
  resultScroll: number;
  resultScrollX: number;
  resultCards: CardItem[];    // parsed card items for card view
  resultCursor: number;       // selected card index
  resultCardScroll: number;   // scroll offset for cards
  // Spinner
  spinnerFrame: number;
  // Settings
  settingsCursor: number;
  settingsEntries: { key: string; value: unknown }[];
  settingsEditing: boolean;
  settingsEditCursor: number;
}
