export interface Endpoint {
  id: string;
  name: string;
  url: string;
  event_types: string[];
  enabled: boolean;
  created_at: string;
}

export interface EndpointCreate {
  name: string;
  event_types: string[];
  url?: string;
}

export interface DeliveryCounts {
  pending: number;
  in_progress: number;
  retrying: number;
  paused: number;
  succeeded: number;
  failed: number;
}

export interface DeliverySummary {
  id: string;
  endpoint_id: string;
  endpoint_name: string;
  endpoint_url: string;
  status: DeliveryStatus;
  due_at: string | null;
  attempts_count: number;
  cycle_attempts: number;
  last_outcome: string | null;
  last_http_status: number | null;
}

export type DeliveryStatus =
  | "pending"
  | "in_progress"
  | "retrying"
  | "paused"
  | "succeeded"
  | "failed";

export interface EventSummary {
  id: string;
  type: string;
  created_at: string;
  deliveries: DeliveryCounts;
}

export interface EventDetail {
  id: string;
  type: string;
  payload: unknown;
  created_at: string;
  deliveries: DeliverySummary[];
}

export interface Attempt {
  id: number;
  number: number;
  started_at: string;
  finished_at: string | null;
  outcome: string | null;
  http_status: number | null;
  response_excerpt: string | null;
}

export interface DeliveryDetail {
  id: string;
  event_id: string;
  event: { id: string; type: string; payload: unknown; created_at: string };
  endpoint: { id: string; name: string; url: string; enabled: boolean };
  status: DeliveryStatus;
  due_at: string | null;
  cycle_attempts: number;
  claim_started_at: string | null;
  attempts: Attempt[];
}

export interface Overview {
  failed_count: number;
  retrying_count: number;
  earliest_due_at: string | null;
  latest_event: { id: string; type: string; created_at: string } | null;
}

export interface SubmitInput {
  idempotency_key: string;
  type: string;
  payload: unknown;
}

export interface SubmitResult {
  event_id: string;
  deduplicated: boolean;
}

interface ListResponse<T> {
  items: T[];
}

export interface EventListParams {
  limit?: number;
  offset?: number;
  status?: string;
  type?: string;
  endpoint_id?: string;
}

export interface EventListResponse {
  items: EventSummary[];
  total: number;
}

export class ApiError extends Error {
  code: string;
  httpStatus: number | null;

  constructor(code: string, message: string, httpStatus: number | null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function createDashboardApi(base = "/api") {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        headers: init?.body ? { "content-type": "application/json" } : undefined,
        ...init,
      });
    } catch {
      throw new ApiError("transport_error", "Could not reach the API.", null);
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      const envelope = body as { code?: string; message?: string } | null;
      throw new ApiError(
        envelope?.code ?? "internal_error",
        envelope?.message ?? `Request failed with status ${response.status}.`,
        response.status,
      );
    }
    return body as T;
  }

  return {
    getHealth: () => request<{ status: string }>("/health"),
    getOverview: () => request<Overview>("/overview"),
    listEvents: (params: EventListParams = {}) => {
      const query = new URLSearchParams();
      if (params.limit) query.set("limit", String(params.limit));
      if (params.offset) query.set("offset", String(params.offset));
      if (params.status) query.set("status", params.status);
      if (params.type) query.set("type", params.type);
      if (params.endpoint_id) query.set("endpoint_id", params.endpoint_id);
      const suffix = query.toString();
      return request<EventListResponse>(`/events${suffix ? `?${suffix}` : ""}`);
    },
    getEvent: (id: string) => request<EventDetail>(`/events/${id}`),
    getDelivery: (id: string) => request<DeliveryDetail>(`/deliveries/${id}`),
    listEndpoints: () => request<ListResponse<Endpoint>>("/endpoints"),
    createEndpoint: (input: EndpointCreate) =>
      request<{ endpoint: Endpoint; secret: string }>("/endpoints", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    setEndpointEnabled: (id: string, enabled: boolean) =>
      request<Endpoint>(`/endpoints/${id}/${enabled ? "enable" : "disable"}`, { method: "POST" }),
    submitEvent: (input: SubmitInput) =>
      request<SubmitResult>("/events", { method: "POST", body: JSON.stringify(input) }),
    replayDelivery: (id: string) =>
      request<{ delivery_id: string; status: string }>(`/deliveries/${id}/replay`, {
        method: "POST",
      }),
  };
}

export type DashboardApi = ReturnType<typeof createDashboardApi>;
