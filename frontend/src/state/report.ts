import type { Attempt, DeliveryDetail } from "../api/client";
import { attemptSummary, STATUS_LABELS } from "./delivery";

const ATTEMPTS_PER_CYCLE = 3;

function durationLabel(attempt: Attempt): string {
  if (!attempt.finished_at) return "in flight";
  const ms = new Date(attempt.finished_at).getTime() - new Date(attempt.started_at).getTime();
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** One line an operator can read at a glance in the delivery panel. */
export function deliveryHeadline(delivery: DeliveryDetail): string {
  const label = STATUS_LABELS[delivery.status];
  const attempts = delivery.attempts;
  if (!attempts.length) return `${label} · no attempts recorded yet`;
  const last = attempts[attempts.length - 1];
  const outcome = attemptSummary(last.outcome, last.http_status);
  const cycle =
    delivery.cycle_attempts > 0
      ? `${delivery.cycle_attempts} of ${ATTEMPTS_PER_CYCLE} in this cycle`
      : `${attempts.length} attempt(s)`;
  const overall = attempts.length > delivery.cycle_attempts ? ` (${attempts.length} overall)` : "";
  const when = new Date(last.finished_at ?? last.started_at).toLocaleTimeString();
  return `${label} · ${outcome} · ${cycle}${overall} · last attempt ${when}`;
}

function attemptLine(attempt: Attempt): string {
  const started = new Date(attempt.started_at).toLocaleTimeString();
  const finished = attempt.finished_at
    ? new Date(attempt.finished_at).toLocaleTimeString()
    : "unfinished";
  const excerpt = attempt.response_excerpt ? ` · \`${attempt.response_excerpt}\`` : "";
  return (
    `#${attempt.number} ${attemptSummary(attempt.outcome, attempt.http_status)}` +
    ` · ${started} → ${finished} · ${durationLabel(attempt)}${excerpt}`
  );
}

/**
 * Markdown an operator can paste into a bug report. Ids, statuses and bounded
 * excerpts only — the API never returns the endpoint secret, and this must not
 * invent one.
 */
export function buildDeliveryReport(delivery: DeliveryDetail, link?: string): string {
  const lines = [
    `# Delivery report — ${delivery.id}`,
    "",
    `- Event: \`${delivery.event.id}\` (${delivery.event.type}), created ${delivery.event.created_at}`,
    `- Endpoint: ${delivery.endpoint.name} — ${delivery.endpoint.url}` +
      (delivery.endpoint.enabled ? "" : " (disabled)"),
    `- Status: ${deliveryHeadline(delivery)}`,
  ];
  if (link) lines.push(`- Dashboard: ${link}`);
  lines.push(
    "",
    "## Payload",
    "",
    "```json",
    JSON.stringify(delivery.event.payload, null, 2),
    "```",
    "",
    `## Attempts (${delivery.attempts.length})`,
    "",
  );
  if (!delivery.attempts.length) {
    lines.push("No attempts recorded yet.");
  } else {
    lines.push(...delivery.attempts.map(attemptLine));
  }
  return `${lines.join("\n")}\n`;
}
