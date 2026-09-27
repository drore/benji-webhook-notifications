import { ref } from "vue";

import { ApiError } from "../api/client";
import type { DashboardApi, Endpoint, EndpointCreate } from "../api/client";

const DEFAULT_POLL_MS = 2000;

function describe(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message;
  return "Unexpected error.";
}

export function createEndpointsState(api: DashboardApi) {
  const endpoints = ref<Endpoint[]>([]);
  const loading = ref(false);
  const stale = ref(false);
  const lastUpdatedAt = ref<Date | null>(null);
  const error = ref<string | null>(null);
  const creating = ref(false);
  const togglingId = ref<string | null>(null);
  const createdSecret = ref<{ endpointId: string; secret: string } | null>(null);
  let timer: number | null = null;

  async function load(): Promise<void> {
    loading.value = true;
    try {
      const response = await api.listEndpoints();
      endpoints.value = response.items;
      stale.value = false;
      lastUpdatedAt.value = new Date();
      error.value = null;
    } catch (cause) {
      stale.value = true;
      error.value = describe(cause);
    } finally {
      loading.value = false;
    }
  }

  async function create(input: EndpointCreate): Promise<boolean> {
    if (creating.value) return false;
    creating.value = true;
    error.value = null;
    try {
      const response = await api.createEndpoint(input);
      createdSecret.value = { endpointId: response.endpoint.id, secret: response.secret };
      await load();
      return true;
    } catch (cause) {
      error.value = describe(cause);
      return false;
    } finally {
      creating.value = false;
    }
  }

  async function setEnabled(id: string, enabled: boolean): Promise<boolean> {
    if (togglingId.value) return false;
    togglingId.value = id;
    error.value = null;
    try {
      const updated = await api.setEndpointEnabled(id, enabled);
      endpoints.value = endpoints.value.map((item) => (item.id === updated.id ? updated : item));
      return true;
    } catch (cause) {
      error.value = describe(cause);
      return false;
    } finally {
      togglingId.value = null;
    }
  }

  function dismissSecret(): void {
    createdSecret.value = null;
  }

  function startPolling(intervalMs = DEFAULT_POLL_MS): void {
    stopPolling();
    timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, intervalMs);
  }

  function stopPolling(): void {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  return {
    endpoints,
    loading,
    stale,
    lastUpdatedAt,
    error,
    creating,
    togglingId,
    createdSecret,
    load,
    create,
    setEnabled,
    dismissSecret,
    startPolling,
    stopPolling,
  };
}

export type EndpointsState = ReturnType<typeof createEndpointsState>;
