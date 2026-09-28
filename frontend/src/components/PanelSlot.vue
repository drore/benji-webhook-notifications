<script setup lang="ts">
import { onUnmounted, ref } from "vue";

const props = defineProps<{ panelKey: string; label: string }>();
const emit = defineEmits<{ move: [{ key: string; target: string }] }>();

const dragging = ref(false);

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
  const target = slotUnderPointer(event);
  if (target && target !== props.panelKey) {
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
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", stopDragging, { once: true });
}

onUnmounted(stopDragging);
</script>

<template>
  <div class="panel-slot" :class="{ dragging }" :data-panel-key="panelKey">
    <button
      type="button"
      class="panel-grip"
      :aria-label="`Reorder ${label}`"
      :title="`Drag to reorder ${label}`"
      @pointerdown="startDragging"
    >
      ⠿
    </button>
    <slot />
  </div>
</template>
