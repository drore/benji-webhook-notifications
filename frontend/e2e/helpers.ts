import { expect } from "@playwright/test";
import type { APIRequestContext, Locator, Page } from "@playwright/test";

export const RECEIVER_URL = process.env.PW_RECEIVER_URL ?? "http://127.0.0.1:9000";

export function uniqueSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export async function configureReceiver(
  request: APIRequestContext,
  secret: string,
  behavior: string,
): Promise<void> {
  const response = await request.post(`${RECEIVER_URL}/api/config`, {
    data: { secret, behavior },
  });
  expect(response.ok()).toBeTruthy();
}

export function endpointRow(page: Page, name: string): Locator {
  return page.locator(".endpoint-list li").filter({ hasText: name });
}

export async function createEndpoint(
  page: Page,
  options: { name: string; types: string[] },
): Promise<string> {
  await page.getByLabel("Endpoint name").fill(options.name);
  await page.getByLabel("Event types").fill(options.types.join(", "));
  await page.getByRole("button", { name: "Create endpoint" }).click();
  const banner = page.getByTestId("secret-banner").filter({ hasText: options.name });
  await expect(banner).toBeVisible();
  const secret = (await banner.locator("code").textContent())?.trim() ?? "";
  expect(secret).toMatch(/^whsec_/);
  await banner.getByRole("button", { name: "Dismiss" }).click();
  await expect(banner).toBeHidden();
  return secret;
}

export async function enableEndpoint(page: Page, name: string): Promise<void> {
  const row = endpointRow(page, name);
  await row.getByRole("button", { name: "Enable" }).click();
  await expect(row).toContainText("enabled");
}

export async function disableEndpoint(page: Page, name: string): Promise<void> {
  const row = endpointRow(page, name);
  await row.getByRole("button", { name: "Disable" }).click();
  await expect(row).toContainText("disabled");
}

export async function publishEvent(
  page: Page,
  options: { type: string; custom?: string; payload: string },
): Promise<void> {
  await page.getByLabel("Event type", { exact: true }).selectOption(options.type);
  if (options.type === "custom") {
    await page.getByLabel("Custom event type").fill(options.custom ?? "");
  }
  await page.getByLabel("Payload").fill(options.payload);
  await page.getByRole("button", { name: "Publish event" }).click();
}

export async function readSubmissionKey(page: Page): Promise<string> {
  return (await page.getByTestId("submission-key").inputValue()).trim();
}

export async function setSubmissionKey(page: Page, key: string): Promise<void> {
  await page.getByTestId("submission-key").fill(key);
}

export function acceptedEventId(page: Page): Promise<string | null> {
  return page
    .getByTestId("accepted")
    .locator("code")
    .textContent();
}

export async function selectLatestEvent(page: Page, type: string): Promise<void> {
  await page.getByTestId("event-row").filter({ hasText: type }).first().click();
}

export async function selectEventById(page: Page, eventId: string): Promise<void> {
  await page.getByTestId("event-row").filter({ hasText: eventId }).first().click();
}

export function branchFor(page: Page, endpointName: string): Locator {
  return page.getByTestId("branch").filter({ hasText: endpointName });
}
