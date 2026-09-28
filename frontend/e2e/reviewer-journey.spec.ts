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
      payload: `{"n":1,"suffix":"${suffix}"}`,
    });
    await selectLatestEvent(page, "reward_transaction_created");
    await expect(branchFor(page, name)).toContainText("Delivered", { timeout: 15_000 });
    await branchFor(page, name).click();
    await expect(page.getByTestId("delivery-id")).toBeVisible();

    await publishEvent(page, {
      type: "reward_transaction_created",
      payload: `{"n":2,"suffix":"${suffix}"}`,
    });
    await selectLatestEvent(page, "reward_transaction_created");

    await expect(branchFor(page, name)).toBeVisible();
    await expect(page.getByTestId("delivery-id")).toHaveCount(0);
  });
});
