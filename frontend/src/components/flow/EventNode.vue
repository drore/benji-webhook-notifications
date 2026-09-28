<script setup lang="ts">
import type { EventDetail } from "../../api/client";

defineProps<{ data: { event: EventDetail } }>();
</script>

<template>
  <div class="flow-event-node" data-testid="event-node">
    <span class="flow-node-kicker">Event</span>
    <strong class="event-type">{{ data.event.type }}</strong>
    <code>{{ data.event.id }}</code>
    <span class="flow-node-meta">
      {{ new Date(data.event.created_at).toLocaleTimeString() }}
    </span>
  </div>
</template>
