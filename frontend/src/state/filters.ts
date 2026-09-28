import { reactive } from "vue";

export type EventStatusFilter = "all" | "failed" | "retrying" | "paused" | "no_receivers";

export const STATUS_CHIPS: { value: EventStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "failed", label: "Failed" },
  { value: "retrying", label: "Retrying" },
  { value: "paused", label: "Paused" },
  { value: "no_receivers", label: "No receivers" },
];

/**
 * Shared between the header signals and the events list: a signal is only
 * useful if clicking it narrows the list to the thing being signalled.
 */
export const eventFilters = reactive({
  status: "all" as EventStatusFilter,
  type: "",
  endpointId: "",
});

export function setStatusFilter(status: EventStatusFilter): void {
  eventFilters.status = status;
}

export function setTypeFilter(value: string): void {
  eventFilters.type = value;
}

export function setEndpointFilter(value: string): void {
  eventFilters.endpointId = value;
}

export function resetEventFilters(): void {
  eventFilters.status = "all";
  eventFilters.type = "";
  eventFilters.endpointId = "";
}

export function hasActiveFilter(): boolean {
  return eventFilters.status !== "all" || eventFilters.type !== "" || eventFilters.endpointId !== "";
}
