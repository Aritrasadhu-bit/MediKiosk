import { describe, expect, it } from "vitest";
import { backoffMillis, dueItems, itemKey, MAX_ATTEMPTS, mergePending, nextRetry, verdictForStatus } from "@/lib/outbox";
import type { OutboxItem } from "@/lib/outbox";

const item = (id: string, over: Partial<OutboxItem> = {}): OutboxItem => ({
  id,
  endpoint: "/api/encounters/enc-1",
  method: "PATCH",
  body: { encounterId: "enc-1", status: "pending" },
  createdAt: "2026-09-20T09:00:00.000Z",
  attempt: 0,
  nextTry: 0,
  ...over,
});

describe("backoff / retry scheduling", () => {
  it("exponential backoff capped at 5 minutes", () => {
    expect(backoffMillis(0)).toBe(5_000);
    expect(backoffMillis(1)).toBe(10_000);
    expect(backoffMillis(6)).toBe(300_000); // 5000×2⁶ = 320k → capped at 300k
    expect(backoffMillis(20)).toBe(300_000); // capped
  });
  it("nextRetry offsets from the given now", () => {
    const now = 1_000_000;
    expect(nextRetry(1, now)).toBe(now + 10_000);
  });
  it("gives up only after MAX_ATTEMPTS", () => {
    expect(MAX_ATTEMPTS).toBe(8);
  });
});

describe("dueItems", () => {
  it("returns items up to their nextTry that have not given up", () => {
    const now = 100;
    const list = [
      item("a", { nextTry: 50 }),
      item("b", { nextTry: 150 }),
      item("c", { nextTry: 50, gaveUp: true }),
    ];
    expect(dueItems(list, now).map((i) => i.id)).toEqual(["a"]);
  });
});

describe("itemKey / mergePending (dedupe + merge)", () => {
  it("dedupe key bridges body.encounterId and URL segment", () => {
    const viaBody = item("a", { body: { encounterId: "enc-9" } });
    expect(itemKey(viaBody)).toContain("enc-9");
    const viaUrl = item("b", { endpoint: "/api/encounters/enc-7", body: {} });
    expect(itemKey(viaUrl)).toContain("enc-7");
    expect(itemKey(viaBody)).not.toBe(itemKey(viaUrl));
  });

  it("merges successive PATCH bodies and concatenates audits", () => {
    const a = item("a", { body: { encounterId: "enc-1", status: "triage", audit: [{ action: "triage_verified", at: "2026-09-20T09:00:00Z" } as never] } });
    const b = item("b", { body: { encounterId: "enc-1", status: "confirmed", audit: [{ action: "called_next", at: "2026-09-20T09:01:00Z" } as never] }, nextTry: 42 });
    const merged = mergePending(a, b);
    expect((merged.body as { status: string }).status).toBe("confirmed");
    expect((merged.body as { audit: unknown[] }).audit).toHaveLength(2);
    expect(merged.id).toBe("a"); // keeps the existing id
    expect(merged.nextTry).toBe(42);
    expect(merged.gaveUp).toBe(false);
  });

  it("POST replaces (fresh retry count)", () => {
    const a = item("a", { method: "POST", attempt: 5, body: { encounterId: "enc-1" } });
    const b = item("b", { method: "POST", attempt: 0 });
    const merged = mergePending(a, b);
    expect(merged.attempt).toBe(0);
    expect(merged.gaveUp).toBe(false);
  });
});

describe("verdictForStatus (retry vs fail-fast)", () => {
  it("retries network failures and server/rate-limit signals", () => {
    expect(verdictForStatus(null, "POST")).toBe("retry");
    expect(verdictForStatus(429, "POST")).toBe("retry");
    expect(verdictForStatus(503, "POST")).toBe("retry");
    expect(verdictForStatus(500, "PATCH")).toBe("retry");
  });
  it("treats a POST answered 409 as already processed (safe to drop)", () => {
    expect(verdictForStatus(409, "POST")).toBe("processed");
  });
  it("fails permanent rejections fast instead of looping forever", () => {
    for (const status of [400, 401, 403, 404, 405, 410, 422]) {
      expect(verdictForStatus(status, "POST")).toBe("dead");
    }
    expect(verdictForStatus(409, "PATCH")).toBe("dead");
  });
  it("marks 2xx as sent", () => {
    expect(verdictForStatus(200, "POST")).toBe("sent");
  });
});