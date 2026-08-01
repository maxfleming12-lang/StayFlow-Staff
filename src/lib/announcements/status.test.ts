import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_STATUSES,
  ANNOUNCEMENT_STATUS_LABEL,
  canTransition,
  describeAudience,
  isAnnouncementStatus,
  isLive,
  notificationCategoryFor,
  type AnnouncementStatus,
  type Recipient,
} from "./status";
import { isUrgent } from "@/lib/notifications/policy";

const recipient = (over: Partial<Recipient> = {}): Recipient => ({
  allStaff: false,
  userId: null,
  teamId: null,
  propertyId: null,
  ...over,
});

describe("the lifecycle", () => {
  it("labels every status", () => {
    for (const status of ANNOUNCEMENT_STATUSES) {
      expect(ANNOUNCEMENT_STATUS_LABEL[status], status).toBeTruthy();
    }
  });

  it("publishes from draft or schedule", () => {
    expect(canTransition("draft", "published")).toBe(true);
    expect(canTransition("scheduled", "published")).toBe(true);
  });

  it("takes a notice down by withdrawing, never by deleting", () => {
    // The record of what staff were told, and when, has to survive.
    expect(canTransition("published", "withdrawn")).toBe(true);
    expect(canTransition("expired", "withdrawn")).toBe(true);
  });

  it("will not republish a withdrawn notice", () => {
    for (const to of ANNOUNCEMENT_STATUSES) {
      expect(canTransition("withdrawn", to), to).toBe(false);
    }
  });

  it("will not send a published notice back to draft", () => {
    // Staff have already seen it; editing it quietly afterwards would make
    // the read receipts meaningless.
    expect(canTransition("published", "draft")).toBe(false);
  });
});

describe("isLive", () => {
  const now = new Date("2026-08-01T00:00:00.000Z");

  it("is live when published with no expiry", () => {
    expect(isLive({ status: "published", expiresAt: null }, now)).toBe(true);
  });

  it("is not live once past its expiry, even while still 'published'", () => {
    // Expiry is a time, not a status, so a notice can sit at `published`
    // long after it stopped applying.
    expect(
      isLive({ status: "published", expiresAt: "2026-07-01T00:00:00.000Z" }, now),
    ).toBe(false);
  });

  it("is live while the expiry is still ahead", () => {
    expect(
      isLive({ status: "published", expiresAt: "2026-09-01T00:00:00.000Z" }, now),
    ).toBe(true);
  });

  it("is never live in any other status", () => {
    for (const status of ["draft", "scheduled", "expired", "withdrawn"] as AnnouncementStatus[]) {
      expect(isLive({ status, expiresAt: null }, now), status).toBe(false);
    }
  });
});

describe("notificationCategoryFor", () => {
  it("sends an urgent notice under a category that ignores quiet hours", () => {
    const category = notificationCategoryFor(true);
    // This is the entire difference between urgent and not.
    expect(isUrgent(category)).toBe(true);
  });

  it("sends an ordinary notice under one that respects them", () => {
    expect(isUrgent(notificationCategoryFor(false))).toBe(false);
  });

  it("follows the flag, not the category name", () => {
    // A notice can be about safety without being urgent, and vice versa.
    expect(notificationCategoryFor(false)).toBe("announcement");
    expect(notificationCategoryFor(true)).toBe("urgent_notice");
  });
});

describe("describeAudience", () => {
  const properties = new Map([["p1", "Coastal Comfort"]]);
  const teams = new Map([["t1", "Housekeeping"]]);

  it("says nobody when there is no targeting", () => {
    expect(describeAudience([])).toBe("Nobody");
  });

  it("says all staff, and does not enumerate on top of it", () => {
    expect(
      describeAudience([recipient({ allStaff: true }), recipient({ propertyId: "p1" })], {
        properties,
      }),
    ).toBe("All staff");
  });

  it("names a property", () => {
    expect(
      describeAudience([recipient({ propertyId: "p1" })], { properties }),
    ).toBe("Coastal Comfort");
  });

  it("names a team", () => {
    expect(describeAudience([recipient({ teamId: "t1" })], { teams })).toBe(
      "Housekeeping team",
    );
  });

  it("counts individuals rather than listing them", () => {
    expect(
      describeAudience([
        recipient({ userId: "u1" }),
        recipient({ userId: "u2" }),
      ]),
    ).toBe("2 people");
    expect(describeAudience([recipient({ userId: "u1" })])).toBe("1 person");
  });

  it("combines dimensions", () => {
    expect(
      describeAudience(
        [recipient({ propertyId: "p1" }), recipient({ userId: "u1" })],
        { properties },
      ),
    ).toBe("Coastal Comfort, 1 person");
  });

  it("falls back rather than showing a raw id", () => {
    expect(describeAudience([recipient({ propertyId: "unknown" })])).toBe(
      "one property",
    );
  });
});

describe("isAnnouncementStatus", () => {
  it("accepts the real statuses and rejects anything else", () => {
    for (const status of ANNOUNCEMENT_STATUSES) {
      expect(isAnnouncementStatus(status)).toBe(true);
    }
    for (const value of ["", "live", "constructor", null, 3]) {
      expect(isAnnouncementStatus(value)).toBe(false);
    }
  });
});
