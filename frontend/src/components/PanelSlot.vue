<script setup lang="ts">
import { onUnmounted, ref } from "vue";

const props = defineProps<{ panelKey: string; label: string }>();
const emit = defineEmits<{
  move: [{ key: string; target: string }];
  shift: [{ key: string; delta: number }];
}>();

const dragging = ref(false);
let lastMoveAt = { x: 0, y: 0 };

function slotUnderPointer(event: PointerEvent): string | null {
  for (const slot of document.querySelectorAll<HTMLElement>("[data-panel-key]")) {
    const rect = slot.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (inside) return slot.dataset.panelKey ?? null;
  }
  return null;
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return;
  // Small dead zone: after a swap the panel moves under the pointer, and without
  // this the rows would trade places on every pixel of movement.
  const travelled = Math.hypot(event.clientX - lastMoveAt.x, event.clientY - lastMoveAt.y);
  if (travelled < 12) return;
  const target = slotUnderPointer(event);
  if (target && target !== props.panelKey) {
    lastMoveAt = { x: event.clientX, y: event.clientY };
    emit("move", { key: props.panelKey, target });
  }
}

function stopDragging(): void {
  dragging.value = false;
  window.removeEventListener("pointermove", onPointerMove);
}

function startDragging(event: PointerEvent): void {
  event.preventDefault();
  dragging.value = true;
  lastMoveAt = { x: event.clientX, y: event.clientY };
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", stopDragging, { once: true });
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  emit("shift", { key: props.panelKey, delta: event.key === "ArrowUp" ? -1 : 1 });
}

onUnmounted(stopDragging);
</script>

<template>
  <div class="panel-slot" :class="{ dragging }" :data-panel-key="panelKey">
    <button
      type="button"
      class="panel-grip"
      data-testid="panel-grip"
      :aria-label="`Reorder ${label}`"
      :title="`Drag to reorder ${label}, or focus and press the arrow keys`"
      @pointerdown="startDragging"
      @keydown="onKeydown"
    >
      ⠿
    </button>
    <slot />
  </div>
</template>
