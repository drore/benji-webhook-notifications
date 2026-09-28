import { ref } from "vue";

/**
 * The newest event the list has seen, and whether the journey should follow it.
 * The events list publishes the id; the shell decides when to move the
 * selection, so "follow live" never fights with a deliberate click.
 */
export const latestEventId = ref<string | null>(null);
export const followLive = ref(false);

export function setLatestEventId(value: string | null): void {
  latestEventId.value = value;
}

export function toggleFollowLive(): void {
  followLive.value = !followLive.value;
}

export function setFollowLive(value: boolean): void {
  followLive.value = value;
}
