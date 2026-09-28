import { expect, test } from "@playwright/test";

import {
  acceptedEventId,
  branchFor,
  configureReceiver,
  createEndpoint,
  disableEndpoint,
  enableEndpoint,
  endpointRow,
  publishEvent,
  readSubmissionKey,
  RECEIVER_URL,
  selectEventById,
  selectLatestEvent,
  setSubmissionKey,
  uniqueSuffix,
} from "./helpers";

test.describe("reviewer journey", () => {
  test("REQ-006 secret is shown once and enable/disable survives reload", async ({ page }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Secret ${suffix}`;
    await page.goto("/");
    const secret = await createEndpoint(page, { name, types: ["campaign_updated"] });
    await expect(page.getByText(secret)).toHaveCount(0);
    const row = endpointRow(page, name);
    await expect(row).toContainText("disabled");
    await row.getByRole("button", { name: "Enable" }).click();
    await expect(row).toContainText("enabled");
    await page.reload();
    await expect(endpointRow(page, name)).toContainText("enabled");
    await disableEndpoint(page, name);
    await page.reload();
    await expect(endpointRow(page, name)).toContainText("disabled");
  });

  test("REQ-001/005/007 one event fans out once per subscriber and resubmission deduplicates", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix();
    const crmName = `E2E CRM ${suffix}`;
    const ledgerName = `E2E Ledger ${suffix}`;
    await page.goto("/");
    const crmSecret = await createEndpoint(page, {
      name: crmName,
      types: ["campaign_updated"],
    });
    const ledgerSecret = await createEndpoint(page, {
      name: ledgerName,
      types: ["campaign_updated", "member_account_linked"],
    });
    await configureReceiver(request, crmSecret, "success");
    await configureReceiver(request, ledgerSecret, "success");
    await enableEndpoint(page, crmName);
    await enableEndpoint(page, ledgerName);
    await page.getByLabel("Event type", { exact: true }).selectOption("campaign_updated");
    await expect(page.getByTestId("subscriber-hint")).toContainText("2 enabled endpoint(s)");
    const firstKey = await readSubmissionKey(page);
    await publishEvent(page, {
      type: "campaign_updated",
      payload: '{"campaign":"e2e","step":1}',
    });
    await expect(page.getByTestId("accepted")).toContainText("Accepted as");
    const originalId = (await acceptedEventId(page))?.trim() ?? "";
    expect(originalId).toMatch(/^evt_/);
    expect(await readSubmissionKey(page)).not.toBe(firstKey);
    await selectLatestEvent(page, "campaign_updated");
    await expect(page.getByTestId("branch")).toHaveCount(2);
    await expect(branchFor(page, crmName)).toContainText("Delivered", { timeout: 15_000 });
    await expect(branchFor(page, ledgerName)).toContainText("Delivered", { timeout: 15_000 });
    await setSubmissionKey(page, firstKey);
    await page.getByRole("button", { name: "Publish event" }).click();
    await expect(page.getByTestId("deduplicated")).toContainText(originalId);
    await page.getByLabel("Payload").fill('{"campaign":"e2e","step":2}');
    await page.getByRole("button", { name: "Publish event" }).click();
    await expect(page.getByTestId("conflict")).toContainText("different content");
    await expect(page.getByTestId("branch")).toHaveCount(2);
  });

  test("REQ-002/008 a fail-once receiver retries to Delivered without a manual refresh", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Retry ${suffix}`;
    await page.goto("/");
    const secret = await createEndpoint(page, {
      name,
      types: ["member_account_linked"],
    });
    await configureReceiver(request, secret, "fail_once");
    await enableEndpoint(page, name);
    await publishEvent(page, {
      type: "member_account_linked",
      payload: '{"member":"m_e2e"}',
    });
    await selectLatestEvent(page, "member_account_linked");
    const branch = branchFor(page, name);
    await expect(branch).toContainText("Delivered", { timeout: 15_000 });
    await branch.click();
    await expect(page.getByTestId("attempt-row")).toHaveCount(2);
    await expect(page.getByTestId("attempt-row").first()).toContainText("Retryable HTTP 500");
    await expect(page.getByTestId("attempt-row").nth(1)).toContainText("2xx (HTTP 200)");
    await page.getByTestId("attempt-help").first().hover();
    await expect(page.getByRole("tooltip").first()).toBeVisible();
    await expect(page.getByRole("tooltip").first()).toContainText("backoff");
  });

  test("REQ-003/004 a verified failing delivery keeps attempts and replays on the same delivery", async ({
    page,
    request,
    context,
  }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Fail ${suffix}`;
    await page.goto("/");
    const secret = await createEndpoint(page, {
      name,
      types: ["reward_transaction_created"],
    });
    await configureReceiver(request, secret, "always_fail");
    await enableEndpoint(page, name);
    await publishEvent(page, {
      type: "reward_transaction_created",
      payload: '{"member":"m_fail","points":3}',
    });
    await selectLatestEvent(page, "reward_transaction_created");
    const branch = branchFor(page, name);
    await expect(branch).toContainText("Failed", { timeout: 20_000 });
    await expect(branch.getByTestId("attempt-help")).toBeVisible();
    await branch.getByTestId("attempt-help").hover();
    await expect(branch.getByRole("tooltip")).toBeVisible();
    await expect(branch.getByRole("tooltip")).toContainText("backoff");
    await branch.click();
    await expect(page.getByTestId("attempt-row")).toHaveCount(3);
    await expect(page.getByTestId("payload-json")).toContainText("m_fail");
    const deliveryId = (await page.getByTestId("delivery-id").textContent())?.trim() ?? "";
    expect(deliveryId).toMatch(/^dlv_/);
    const receiverPage = await context.newPage();
    await receiverPage.goto(`${RECEIVER_URL}/`);
    const receiverRows = receiverPage.getByRole("row", { name: new RegExp(deliveryId) });
    await expect(receiverRows).toHaveCount(3);
    await expect(receiverRows.first()).toContainText("verified");
    await page.getByRole("button", { name: "Replay delivery" }).click();
    await expect(page.getByTestId("attempt-row")).toHaveCount(6, { timeout: 25_000 });
    await expect(page.getByTestId("delivery-id")).toHaveText(deliveryId);
    const cycles = page.getByTestId("attempt-cycle");
    await expect(cycles).toHaveCount(2);
    await expect(cycles.nth(0)).toContainText("Cycle 1");
    await expect(cycles.nth(1)).toContainText("Cycle 2");
    await expect(cycles.nth(1)).toContainText("replay");
    await expect(cycles.nth(1).getByTestId("attempt-row")).toHaveCount(3);
    await receiverPage.reload();
    await expect(receiverRows).toHaveCount(6);
    await expect(receiverRows.last()).toContainText("verified");
    await receiverPage.close();
  });

  test("REQ-003 the receiver rejects a tampered signature", async ({ request, page }) => {
    await configureReceiver(request, "whsec_tamper_fixture_secret", "success");
    const response = await request.post(`${RECEIVER_URL}/webhooks/probe`, {
      headers: {
        "X-Webhook-Delivery-Id": "dlv_tampered",
        "X-Webhook-Timestamp": "1700000000",
        "X-Webhook-Signature": "v1=00",
      },
      data: { probe: true },
    });
    expect(response.status()).toBe(401);
    await page.goto(`${RECEIVER_URL}/`);
    const row = page.getByRole("row", { name: /dlv_tampered/ });
    await expect(row).toContainText("rejected");
  });

  test("REQ-006/009 disabling stops new routing and unmatched events get no receivers", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Disable ${suffix}`;
    await page.goto("/");
    const secret = await createEndpoint(page, {
      name,
      types: ["campaign_updated"],
    });
    await configureReceiver(request, secret, "success");
    await enableEndpoint(page, name);
    await publishEvent(page, {
      type: "custom",
      custom: `e2e_probe_${suffix}`,
      payload: "{}",
    });
    await selectLatestEvent(page, `e2e_probe_${suffix}`);
    await expect(page.getByTestId("no-receivers")).toContainText("No receivers matched");
    await expect(
      page.getByTestId("event-row").filter({ hasText: `e2e_probe_${suffix}` }).first(),
    ).toContainText("no receivers");
    await disableEndpoint(page, name);
    await publishEvent(page, {
      type: "campaign_updated",
      payload: `{"campaign":"off-${suffix}"}`,
    });
    await selectLatestEvent(page, "campaign_updated");
    await expect(branchFor(page, name)).toHaveCount(0);
  });

  test("REQ-008 switching events clears the previous delivery detail", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Switch ${suffix}`;
    await page.goto("/");
    const secret = await createEndpoint(page, {
      name,
      types: ["reward_transaction_created"],
    });
    await configureReceiver(request, secret, "success");
    await enableEndpoint(page, name);

    await publishEvent(page, {
      type: "reward_transaction_created",
      payload: `{"member":"m_deep_${suffix}","points":1}`,
    });
    const firstEvent = await acceptedEventId(page);
    expect(firstEvent).toBeTruthy();
    await selectEventById(page, firstEvent as string);
    await expect(branchFor(page, name)).toContainText("Delivered", { timeout: 15_000 });
    await branchFor(page, name).click();
    await expect(page.getByTestId("delivery-id")).toBeVisible();

    await publishEvent(page, {
      type: "reward_transaction_created",
      payload: `{"member":"m_deep_${suffix}","points":2}`,
    });
    const secondEvent = await acceptedEventId(page);
    expect(secondEvent).toBeTruthy();
    await selectEventById(page, secondEvent as string);

    await expect(branchFor(page, name)).toBeVisible();
    await expect(page.getByTestId("delivery-id")).toHaveCount(0);
  });

  test("REQ-006 receiver lists a saved secret without a manual reload", async ({ page }) => {
    const secret = `whsec_e2e_${uniqueSuffix()}secret`;
    await page.goto(`${RECEIVER_URL}/`);
    await page.getByPlaceholder("whsec_… one-time secret").fill(secret);
    await page.getByRole("button", { name: "Save secret" }).click();

    await expect(page.getByText(`••••${secret.slice(-4)}`)).toBeVisible();
  });

  test("REQ-008 a deep link and the ID lookup restore an investigation view", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Deep ${suffix}`;
    await page.goto("/");
    const secret = await createEndpoint(page, { name, types: ["reward_transaction_created"] });
    await configureReceiver(request, secret, "success");
    await enableEndpoint(page, name);

    await publishEvent(page, {
      type: "reward_transaction_created",
      payload: `{"member":"m_switch_${suffix}","points":1}`,
    });
    const firstEvent = (await acceptedEventId(page)) as string;
    await selectEventById(page, firstEvent);
    await expect(branchFor(page, name)).toContainText("Delivered", { timeout: 15_000 });
    await branchFor(page, name).click();
    const deliveryId = ((await page.getByTestId("delivery-id").textContent()) ?? "").trim();
    expect(deliveryId).toMatch(/^dlv_/);
    await expect(page).toHaveURL(new RegExp(`\\?event=${firstEvent}&delivery=${deliveryId}$`));

    // Reloading keeps the same journey and selected delivery without any clicking.
    await page.reload();
    await expect(page.getByTestId("event-node")).toContainText(firstEvent);
    await expect(page.getByTestId("delivery-id")).toContainText(deliveryId);

    // A new event does not steal the view; the lookup jumps to it by ID.
    await publishEvent(page, {
      type: "reward_transaction_created",
      payload: `{"member":"m_switch_${suffix}","points":2}`,
    });
    const secondEvent = (await acceptedEventId(page)) as string;
    await page.getByLabel("Find by ID").fill(secondEvent);
    await page.getByRole("button", { name: "Find" }).click();
    await expect(page.getByTestId("event-node")).toContainText(secondEvent);
    await expect(page.getByTestId("delivery-id")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`\\?event=${secondEvent}$`));

    // A delivery ID jumps back to the event that owns it.
    await page.getByLabel("Find by ID").fill(deliveryId);
    await page.getByRole("button", { name: "Find" }).click();
    await expect(page.getByTestId("event-node")).toContainText(firstEvent);
    await expect(page.getByTestId("delivery-id")).toContainText(deliveryId);

    // Browser back returns to the previous view instead of leaving the app.
    await page.goBack();
    await expect(page.getByTestId("event-node")).toContainText(secondEvent);
    await expect(page.getByTestId("delivery-id")).toHaveCount(0);
  });

  test("REQ-009 the header signals and facets narrow the events list", async ({ page, request }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Filter ${suffix}`;
    await page.goto("/");
    const secret = await createEndpoint(page, { name, types: ["reward_transaction_created"] });
    await configureReceiver(request, secret, "always_fail");
    await enableEndpoint(page, name);

    await publishEvent(page, {
      type: "reward_transaction_created",
      payload: `{"member":"m_filter_${suffix}","points":1}`,
    });
    const failedEvent = (await acceptedEventId(page)) as string;
    // Wait for this event's own delivery to exhaust its cycle; earlier tests
    // leave failures behind, so the header count alone is not evidence.
    await selectEventById(page, failedEvent);
    await expect(branchFor(page, name)).toContainText("Failed", { timeout: 20_000 });

    // A type nobody subscribes to, so the event really has no receivers even
    // though earlier tests leave other endpoints enabled.
    await publishEvent(page, {
      type: "custom",
      custom: `e2e_unrouted_${suffix}`,
      payload: `{"n":2,"suffix":"${suffix}"}`,
    });
    const unmatchedEvent = (await acceptedEventId(page)) as string;

    await page.getByTestId("failed-signal").click();
    await expect(page.getByTestId("event-row").filter({ hasText: failedEvent })).toBeVisible();
    await expect(page.getByTestId("event-row").filter({ hasText: unmatchedEvent })).toHaveCount(0);
    await expect(page.getByTestId("event-count")).toContainText("showing");

    await page.getByRole("button", { name: "No receivers" }).click();
    await expect(page.getByTestId("event-row").filter({ hasText: unmatchedEvent })).toBeVisible();
    await expect(page.getByTestId("event-row").filter({ hasText: failedEvent })).toHaveCount(0);

    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(page.getByTestId("event-row").filter({ hasText: failedEvent })).toBeVisible();
    await expect(page.getByTestId("event-row").filter({ hasText: unmatchedEvent })).toBeVisible();
  });

  test("REQ-007 schema enforcement rejects a bad payload and yields to the switch", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Schema ${suffix}`;
    await page.goto("/");
    const secret = await createEndpoint(page, { name, types: ["reward_transaction_created"] });
    await configureReceiver(request, secret, "success");
    await enableEndpoint(page, name);

    // Registered types are enforced by default, with the expected shape on screen.
    await expect(page.getByTestId("enforce-schema")).toBeChecked();
    await expect(page.getByTestId("expected-shape")).toContainText("points (integer)");

    await page.getByLabel("Payload").fill('{"member":"","points":-1}');
    await page.getByRole("button", { name: "Publish event" }).click();
    await expect(page.getByText(/does not match the registered schema/i)).toBeVisible();
    await expect(page.getByTestId("accepted")).toHaveCount(0);

    // The rejected attempt must not consume the submission key: switching
    // enforcement off publishes the same payload with the same key.
    await page.getByTestId("enforce-schema").uncheck();
    await page.getByRole("button", { name: "Publish event" }).click();
    await expect(page.getByTestId("accepted")).toBeVisible();
    const eventId = (await acceptedEventId(page)) as string;
    expect(eventId).toMatch(/^evt_/);

    // A type without a schema disables the switch and explains itself on hover.
    await page.getByLabel("Event type", { exact: true }).selectOption("custom");
    await page.getByLabel("Custom event type").fill(`e2e_schema_${suffix}`);
    await expect(page.getByTestId("enforce-schema")).toBeDisabled();
    await page.locator(".switch.is-disabled").hover();
    await expect(page.getByTestId("enforce-schema-tip")).toBeVisible();
    await expect(page.getByTestId("enforce-schema-tip")).toContainText("ask your Benji contact");
    await expect(page.getByTestId("enforce-schema-tip")).not.toContainText(".py");
  });
});
