<script setup lang="ts">
import { onUnmounted, ref } from "vue";

const props = defineProps<{ panelKey: string; label: string }>();
const emit = defineEmits<{
  move: [{ key: string; target: string }];
  shift: [{ key: string; delta: number }];
}>();

const dragging = ref(false);
let lastMoveAt = { x: 0, y: 0 };
// Re-armed only once the pointer is over the dragged panel again, so the extra
// moves that follow a swap cannot immediately trade the panels back.
let armed = false;
const slot = ref<HTMLElement | null>(null);

function slotUnderPointer(event: PointerEvent): string | null {
  // Layout offsets, not getBoundingClientRect: the FLIP animation transforms the
  // slots, and a mid-flight rect would make the drop target jump around.
  for (const candidate of document.querySelectorAll<HTMLElement>("[data-panel-key]")) {
    const container = (candidate.offsetParent as HTMLElement | null) ?? document.body;
    const base = container.getBoundingClientRect();
    const left = base.left + candidate.offsetLeft;
    const top = base.top + candidate.offsetTop;
    const inside =
      event.clientX >= left &&
      event.clientX <= left + candidate.offsetWidth &&
      event.clientY >= top &&
      event.clientY <= top + candidate.offsetHeight;
    if (inside) return candidate.dataset.panelKey ?? null;
  }
  return null;
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return;
  // A few pixels of slack keeps a resting hand from reordering by accident.
  const travelled = Math.hypot(event.clientX - lastMoveAt.x, event.clientY - lastMoveAt.y);
  if (travelled < 6) return;
  const target = slotUnderPointer(event);
  if (target === props.panelKey) {
    armed = true;
    return;
  }
  if (!armed || !target) return;
  armed = false;
  lastMoveAt = { x: event.clientX, y: event.clientY };
  emit("move", { key: props.panelKey, target });
}

function stopDragging(): void {
  dragging.value = false;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  window.removeEventListener("pointermove", onPointerMove);
}

function startDragging(event: PointerEvent): void {
  event.preventDefault();
  dragging.value = true;
  lastMoveAt = { x: event.clientX, y: event.clientY };
  armed = true; // the pointer starts on this panel's handle
  document.body.style.cursor = "grabbing";
  document.body.style.userSelect = "none";
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
  <div ref="slot" class="panel-slot" :class="{ dragging }" :data-panel-key="panelKey">
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
