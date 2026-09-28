const EVENT_ID = /^evt_[A-Za-z0-9]+$/;
const DELIVERY_ID = /^dlv_[A-Za-z0-9]+$/;

export interface Selection {
  eventId: string | null;
  deliveryId: string | null;
}

export function isEventId(value: string): boolean {
  return EVENT_ID.test(value);
}

export function isDeliveryId(value: string): boolean {
  return DELIVERY_ID.test(value);
}

/**
 * The dashboard keeps its selection in the URL so a view can be reloaded,
 * bookmarked, or shared. Only well-formed ids are accepted; anything else is
 * dropped before it can reach an API path.
 */
export function readSelection(search: string): Selection {
  const params = new URLSearchParams(search);
  const eventId = params.get("event") ?? "";
  const deliveryId = params.get("delivery") ?? "";
  return {
    eventId: isEventId(eventId) ? eventId : null,
    deliveryId: isDeliveryId(deliveryId) ? deliveryId : null,
  };
}

export function selectionSearch(selection: Selection): string {
  const params = new URLSearchParams();
  if (selection.eventId) params.set("event", selection.eventId);
  if (selection.deliveryId) params.set("delivery", selection.deliveryId);
  const query = params.toString();
  return query ? `?${query}` : "";
}
