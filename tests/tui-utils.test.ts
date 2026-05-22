import { expect, test, describe } from "bun:test";
import {
  isArrayOfObjects,
  humanLabel,
  toolPrefix,
  truncateVisible,
  missingRequiredFields,
  defaultFormCursor,
  classifyField,
  fieldTypeBadge,
  footerForFieldKind,
  formFieldValueDisplay,
  wrapText,
  prevWordBoundary,
  nextWordBoundary,
  dateFieldFormat,
  daysInMonth,
  todayParts,
  parseDateParts,
  datePartsToString,
  adjustDatePart,
  datePartCount,
  str,
  isHighlightObj
} from "../src/tui/utils.ts";
import type { SchemaProperty } from "../src/config.ts";
import type { FormField } from "../src/tui/state.ts";

describe("TUI Utils", () => {
  test("isArrayOfObjects should correctly classify schemas", () => {
    const prop1: SchemaProperty = { type: "array", items: { type: "object", properties: { key: { type: "string" } } } };
    const prop2: SchemaProperty = { type: "array", items: { type: "string" } };
    expect(isArrayOfObjects(prop1)).toBe(true);
    expect(isArrayOfObjects(prop2)).toBe(false);
  });

  test("humanLabel should convert tool names to title case label without prefixes", () => {
    expect(humanLabel("reader_list_documents", "reader")).toBe("List Documents");
    expect(humanLabel("readwise_create_highlight", "readwise")).toBe("Create Highlight");
  });

  test("toolPrefix should identify reader vs readwise", () => {
    expect(toolPrefix({ name: "reader_list_documents", inputSchema: { type: "object" } })).toBe("reader");
    expect(toolPrefix({ name: "readwise_create_highlight", inputSchema: { type: "object" } })).toBe("readwise");
  });

  test("truncateVisible should slice strings properly", () => {
    expect(truncateVisible("hello world", 5)).toBe("hell…");
    expect(truncateVisible("hi", 5)).toBe("hi");
    expect(truncateVisible("hello", 1)).toBe("…");
  });

  test("missingRequiredFields should spot empty or missing required items", () => {
    const fields: FormField[] = [
      { name: "title", required: true, prop: { type: "string" } },
      { name: "tags", required: false, prop: { type: "string" } },
      { name: "items", required: true, prop: { type: "array", items: { type: "object", properties: { x: {} } } } }
    ];

    const values = { title: "Test", items: "[]" };
    const missing = missingRequiredFields(fields, values);
    expect(missing).toHaveLength(1);
    expect(missing[0]?.name).toBe("items");
  });

  test("classifyField and fieldTypeBadge should correctly detect kinds", () => {
    const propBool: SchemaProperty = { type: "boolean" };
    expect(classifyField(propBool)).toBe("bool");
    expect(fieldTypeBadge(propBool)).toBe("yes/no");

    const propEnum: SchemaProperty = { type: "string", enum: ["a", "b"] };
    expect(classifyField(propEnum)).toBe("enum");
    expect(fieldTypeBadge(propEnum)).toBe("select");

    const propNum: SchemaProperty = { type: "integer" };
    expect(classifyField(propNum)).toBe("text");
    expect(fieldTypeBadge(propNum)).toBe("number");
  });

  test("footerForFieldKind should return valid helper key strings", () => {
    expect(footerForFieldKind("bool")).toContain("confirm");
    expect(footerForFieldKind("date")).toContain("today");
  });

  test("formFieldValueDisplay should format values correctly", () => {
    expect(formFieldValueDisplay("", 10)).toContain("–");
    expect(formFieldValueDisplay('["item1", "item2"]', 20)).toBe("\x1b[2m[2 items]\x1b[22m");
    expect(formFieldValueDisplay("line1\nline2", 20)).toContain("[+1 lines]");
  });

  test("wrapText should wrap words on word boundaries", () => {
    const text = "quick brown fox jumps over the lazy dog";
    const wrapped = wrapText(text, 15);
    expect(wrapped[0]).toBe("quick brown fox");
    expect(wrapped[1]).toBe("jumps over the");
    expect(wrapped[2]).toBe("lazy dog");
  });

  test("prevWordBoundary and nextWordBoundary should work", () => {
    const s = "hello world  test";
    // prev
    expect(prevWordBoundary(s, 5)).toBe(0);
    expect(prevWordBoundary(s, 12)).toBe(6);
    // next
    expect(nextWordBoundary(s, 0)).toBe(6);
    expect(nextWordBoundary(s, 6)).toBe(13);
  });

  test("daysInMonth should return correct days", () => {
    expect(daysInMonth(2024, 2)).toBe(29); // Leap year
    expect(daysInMonth(2023, 2)).toBe(28);
  });

  test("dateFieldFormat should detect formats", () => {
    expect(dateFieldFormat({ type: "string", format: "date" })).toBe("date");
    expect(dateFieldFormat({ type: "string", format: "date-time" })).toBe("date-time");
    expect(dateFieldFormat({ type: "string" })).toBeNull();
  });

  test("parseDateParts, datePartsToString, and datePartCount", () => {
    const dateStr = "2024-05-22";
    const parts = parseDateParts(dateStr, "date");
    expect(parts).toEqual([2024, 5, 22]);
    expect(datePartsToString(parts!, "date")).toBe("2024-05-22");
    expect(datePartCount("date")).toBe(3);

    const dateTimeStr = "2024-05-22T10:30:00Z";
    const partsDT = parseDateParts(dateTimeStr, "date-time");
    expect(partsDT).toEqual([2024, 5, 22, 10, 30]);
    expect(datePartsToString(partsDT!, "date-time")).toBe("2024-05-22T10:30:00Z");
    expect(datePartCount("date-time")).toBe(5);

    expect(parseDateParts("", "date")).toBeNull();
    expect(parseDateParts("invalid", "date")).toBeNull();
  });

  test("adjustDatePart should correctly compute bounds", () => {
    const parts = [2024, 5, 22, 10, 30];
    // Adjust year
    expect(adjustDatePart(parts, 0, 1, "date-time")[0]).toBe(2025);
    // Adjust month wrap
    expect(adjustDatePart(parts, 1, 8, "date-time")[1]).toBe(1); // 5 + 8 = 13 -> 1
    // Adjust day wrap
    expect(adjustDatePart(parts, 2, 10, "date-time")[2]).toBe(1); // 22 + 10 = 32 -> 1 (since May has 31 days)
    // Adjust hour wrap
    expect(adjustDatePart(parts, 3, 15, "date-time")[3]).toBe(1); // 10 + 15 = 25 -> 1
    // Adjust minute wrap
    expect(adjustDatePart(parts, 4, 35, "date-time")[4]).toBe(5); // 30 + 35 = 65 -> 5
  });

  test("str should convert values to string", () => {
    expect(str(null)).toBe("");
    expect(str(undefined)).toBe("");
    expect(str(123)).toBe("123");
  });

  test("isHighlightObj should detect highlights", () => {
    expect(isHighlightObj({ category: "highlight" })).toBe(true);
    expect(isHighlightObj({ attributes: { highlight_plaintext: "test" } })).toBe(true);
    expect(isHighlightObj({ text: "test", color: "yellow" })).toBe(true);
    expect(isHighlightObj({ text: "test" })).toBe(false);
  });
});
