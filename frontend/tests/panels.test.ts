import { describe, expect, it } from "vitest";

import {
  DEFAULT_LAYOUT,
  isDefaultLayout,
  loadLayout,
  movePanel,
  sanitizeLayout,
  saveLayout,
  shiftPanel,
} from "../src/state/panels";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = { ...initial };
  return {
    get length() {
      return Object.keys(data).length;
    },
    clear: () => Object.keys(data).forEach((key) => delete data[key]),
    getItem: (key: string) => data[key] ?? null,
    key: (index: number) => Object.keys(data)[index] ?? null,
    removeItem: (key: string) => delete data[key],
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  } as Storage;
}

describe("panel layout", () => {
  it("moves a panel within its column", () => {
    expect(movePanel(["a", "b", "c"] as never[], "c" as never, "a" as never)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(movePanel(["a", "b", "c"] as never[], "a" as never, "b" as never)).toEqual([
      "b",
      "a",
      "c",
    ]);
    // unknown keys leave the order untouched
    expect(movePanel(["a", "b"] as never[], "z" as never, "a" as never)).toEqual(["a", "b"]);
  });

  it("shifts a panel one position for keyboard reordering", () => {
    const order = ["journey", "delivery", "events", "trend"] as const;
    expect(shiftPanel([...order], "events", -1)).toEqual(["journey", "events", "delivery", "trend"]);
    expect(shiftPanel([...order], "journey", 1)).toEqual(["delivery", "journey", "events", "trend"]);
    // edges and unknown keys are no-ops
    expect(shiftPanel([...order], "journey", -1)).toEqual([...order]);
    expect(shiftPanel([...order], "trend", 1)).toEqual([...order]);
    expect(shiftPanel([...order], "nope" as never, 1)).toEqual([...order]);
  });

  it("falls back to the default layout for unknown or incomplete data", () => {
    expect(sanitizeLayout({ left: ["journey"], right: [] })).toEqual(DEFAULT_LAYOUT);
    expect(sanitizeLayout({ left: ["nope"], right: ["composer"] })).toEqual(DEFAULT_LAYOUT);
    expect(
      sanitizeLayout({
        left: ["journey", "journey", "delivery", "events", "trend"],
        right: ["composer", "endpoints"],
      }),
    ).toEqual(DEFAULT_LAYOUT);
  });

  it("round-trips a custom layout through storage", () => {
    const storage = memoryStorage();
    expect(loadLayout(storage)).toEqual(DEFAULT_LAYOUT);

    const custom = {
      left: ["trend", "journey", "delivery", "events"] as PanelLayoutKeys,
      right: ["endpoints", "composer"] as PanelLayoutKeys,
    };
    saveLayout(custom, storage);
    expect(loadLayout(storage)).toEqual(custom);
    expect(isDefaultLayout(custom)).toBe(false);
    expect(isDefaultLayout(DEFAULT_LAYOUT)).toBe(true);
  });

  it("survives unreadable storage", () => {
    const storage = memoryStorage({ "benji.panel-layout": "{not json" });
    expect(loadLayout(storage)).toEqual(DEFAULT_LAYOUT);
  });
});

type PanelLayoutKeys = typeof DEFAULT_LAYOUT.left;
