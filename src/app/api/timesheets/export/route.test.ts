import { beforeEach, describe, expect, it, vi } from "vitest";
import { MANAGER } from "@/test/supabase-stub";
import type { TimesheetRow } from "@/lib/timesheets/queries";

vi.mock("@/lib/auth/session", () => ({
  requireRole: vi.fn(async () => MANAGER),
}));
vi.mock("@/lib/timesheets/queries", () => ({
  getTimesheetsForExport: vi.fn(async () => rows),
}));

let rows: TimesheetRow[] = [];
beforeEach(() => {
  rows = [];
  vi.clearAllMocks();
});

const { GET } = await import("./route");
const { getTimesheetsForExport } = await import("@/lib/timesheets/queries");
const { requireRole } = await import("@/lib/auth/session");

const sheet = (over: Partial<TimesheetRow> = {}): TimesheetRow => ({
  id: "t1",
  userId: "u1",
  staffName: "Aroha Whitiora",
  workDate: "2026-07-28",
  propertyName: "Coastal Comfort",
  rosteredStart: null,
  rosteredEnd: null,
  actualStart: "2026-07-27T23:00:00.000Z",
  actualEnd: "2026-07-28T07:00:00.000Z",
  breakMinutes: 30,
  paidHours: 7.5,
  varianceHours: null,
  status: "approved",
  isNoShow: false,
  staffNote: null,
  managerNote: null,
  staffAcknowledgedAt: null,
  lockedAt: null,
  ...over,
});

const call = (query: string) =>
  GET(new Request(`https://example.test/api/timesheets/export?${query}`));

const PROPERTY = "33333333-3333-4333-8333-333333333333";

describe("GET /api/timesheets/export", () => {
  it("requires a manager before reading anything", async () => {
    await call("from=2026-07-13&to=2026-07-26");
    expect(requireRole).toHaveBeenCalledWith("manager");
  });

  it("returns the period as a CSV attachment", async () => {
    rows = [sheet()];

    const response = await call("from=2026-07-13&to=2026-07-26");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/csv/);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="timesheets-2026-07-13-to-2026-07-26.csv"',
    );
  });

  it("never lets pay data sit in a shared cache", async () => {
    const response = await call("from=2026-07-13&to=2026-07-26");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("starts with a UTF-8 BOM so Excel reads names correctly", async () => {
    rows = [sheet({ staffName: "Aroha Whitiōra" })];

    const response = await call("from=2026-07-13&to=2026-07-26");
    // Asserted on the BYTES, not on text(): the decoder behind text()
    // strips a leading BOM, so reading it back as a string always looks
    // like the BOM is missing whether or not it was sent.
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toContain("Aroha Whitiōra");
  });

  it("renders times in the property timezone", async () => {
    rows = [sheet()];
    const body = await (await call("from=2026-07-13&to=2026-07-26")).text();
    expect(body).toContain("09:00,17:00");
  });

  it("passes the property filter through to the query", async () => {
    await call(`from=2026-07-13&to=2026-07-26&property=${PROPERTY}`);
    expect(getTimesheetsForExport).toHaveBeenCalledWith(
      "2026-07-13",
      "2026-07-26",
      PROPERTY,
    );
  });

  it("names the file after the property when one is chosen", async () => {
    const response = await call(
      `from=2026-07-13&to=2026-07-26&property=${PROPERTY}&propertyName=Holiday%20Lodge`,
    );
    expect(response.headers.get("content-disposition")).toContain(
      "timesheets-holiday-lodge-2026-07-13-to-2026-07-26.csv",
    );
  });

  it("rejects dates that are not yyyy-mm-dd", async () => {
    expect((await call("from=13-07-2026&to=2026-07-26")).status).toBe(400);
    expect((await call("from=2026-07-13")).status).toBe(400);
    expect((await call("")).status).toBe(400);
    expect(getTimesheetsForExport).not.toHaveBeenCalled();
  });

  it("rejects a backwards range", async () => {
    const response = await call("from=2026-07-26&to=2026-07-13");
    expect(response.status).toBe(400);
    expect(getTimesheetsForExport).not.toHaveBeenCalled();
  });

  it("rejects a property that is not a uuid", async () => {
    const response = await call(
      "from=2026-07-13&to=2026-07-26&property=' OR 1=1--",
    );
    expect(response.status).toBe(400);
    expect(getTimesheetsForExport).not.toHaveBeenCalled();
  });

  it("cannot have its response headers split by a crafted property name", async () => {
    const response = await call(
      `from=2026-07-13&to=2026-07-26&property=${PROPERTY}&propertyName=${encodeURIComponent(
        'evil"\r\nSet-Cookie: a=b',
      )}`,
    );

    const disposition = response.headers.get("content-disposition") ?? "";
    expect(disposition).not.toContain("\r");
    expect(disposition).not.toContain("\n");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns just a header row when the period is empty", async () => {
    rows = [];
    const body = await (await call("from=2026-07-13&to=2026-07-26")).text();
    expect(body.trimEnd().split("\r\n")).toHaveLength(1);
  });
});
