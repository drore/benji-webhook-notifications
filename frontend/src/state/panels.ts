export type PanelKey =
  | "journey"
  | "delivery"
  | "events"
  | "trend"
  | "composer"
  | "endpoints";

export interface PanelLayout {
  left: PanelKey[];
  right: PanelKey[];
}

export const DEFAULT_LAYOUT: PanelLayout = {
  left: ["journey", "delivery", "events", "trend"],
  right: ["composer", "endpoints"],
};

export const PANEL_LABELS: Record<PanelKey, string> = {
  journey: "Event journey",
  delivery: "Delivery detail",
  events: "Recent events",
  trend: "Delivery trend",
  composer: "Publish test event",
  endpoints: "Endpoints",
};

const STORAGE_KEY = "benji.panel-layout";
const ALL_KEYS = [...DEFAULT_LAYOUT.left, ...DEFAULT_LAYOUT.right];

function sanitizeColumn(value: unknown, fallback: PanelKey[]): PanelKey[] {
  if (!Array.isArray(value)) return [...fallback];
  const seen = new Set<PanelKey>();
  const column = value.filter((key): key is PanelKey => {
    if (!ALL_KEYS.includes(key as PanelKey) || seen.has(key as PanelKey)) return false;
    seen.add(key as PanelKey);
    return true;
  });
  return column;
}

/** Unknown, duplicated, or missing keys fall back to the default arrangement. */
export function sanitizeLayout(value: unknown): PanelLayout {
  const candidate = (value ?? {}) as Partial<PanelLayout>;
  const left = sanitizeColumn(candidate.left, DEFAULT_LAYOUT.left);
  const right = sanitizeColumn(candidate.right, DEFAULT_LAYOUT.right);
  const seen = [...left, ...right];
  if (seen.length !== ALL_KEYS.length) return structuredClone(DEFAULT_LAYOUT);
  return { left, right };
}

export function loadLayout(storage: Storage): PanelLayout {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? sanitizeLayout(JSON.parse(raw)) : structuredClone(DEFAULT_LAYOUT);
  } catch {
    return structuredClone(DEFAULT_LAYOUT);
  }
}

export function saveLayout(layout: PanelLayout, storage: Storage): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // A demo must keep working when storage is unavailable.
  }
}

export function movePanel(order: PanelKey[], key: PanelKey, target: PanelKey): PanelKey[] {
  const from = order.indexOf(key);
  const to = order.indexOf(target);
  if (from === -1 || to === -1 || from === to) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, key);
  return next;
}

/** Move a panel one position within its column (keyboard fallback for dragging). */
export function shiftPanel(order: PanelKey[], key: PanelKey, delta: number): PanelKey[] {
  const from = order.indexOf(key);
  if (from === -1) return order;
  const to = from + delta;
  if (to < 0 || to >= order.length) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, key);
  return next;
}

export function isDefaultLayout(layout: PanelLayout): boolean {
  return (
    layout.left.join(",") === DEFAULT_LAYOUT.left.join(",") &&
    layout.right.join(",") === DEFAULT_LAYOUT.right.join(",")
  );
}
