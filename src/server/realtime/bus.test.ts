import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_IDS_PER_EVENT, type ServerMessage } from "../../shared/realtime.js";
import {
  ADMIN_CHANNEL,
  COALESCE_MS,
  publishAdminChange,
  publishChange,
  publishJob,
  resetBus,
  subscribe,
  userChannel,
} from "./bus.js";

function collector(): { received: ServerMessage[]; listen: (message: ServerMessage) => void } {
  const received: ServerMessage[] = [];
  return { received, listen: (message) => received.push(message) };
}

describe("realtime bus", () => {
  afterEach(() => {
    resetBus();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("coalesces a burst into one message", () => {
    vi.useFakeTimers();
    const { received, listen } = collector();
    subscribe([userChannel("u1")], listen);

    // What `watchlistAdd` with three items looks like from here.
    publishChange("u1", "watchlist", "created", ["list-1"]);
    publishChange("u1", "watchlist", "created", ["list-1"]);
    publishChange("u1", "watchlist", "created", ["list-2"]);
    expect(received).toHaveLength(0);

    vi.advanceTimersByTime(COALESCE_MS);
    expect(received).toEqual([
      { type: "change", topic: "watchlist", action: "created", ids: ["list-1", "list-2"] },
    ]);
  });

  it("keeps different actions and topics apart", () => {
    vi.useFakeTimers();
    const { received, listen } = collector();
    subscribe([userChannel("u1")], listen);

    publishChange("u1", "notes", "created", ["n1"]);
    publishChange("u1", "notes", "deleted", ["n2"]);
    publishChange("u1", "skills", "updated", ["s1"]);
    vi.advanceTimersByTime(COALESCE_MS);

    expect(received).toHaveLength(3);
    expect(received.map((message) => message.type === "change" && message.action)).toEqual([
      "created",
      "deleted",
      "updated",
    ]);
  });

  it("delivers only to the addressed channel", () => {
    vi.useFakeTimers();
    const mine = collector();
    const theirs = collector();
    subscribe([userChannel("u1")], mine.listen);
    subscribe([userChannel("u2")], theirs.listen);

    publishChange("u1", "notes", "created", ["n1"]);
    vi.advanceTimersByTime(COALESCE_MS);

    expect(mine.received).toHaveLength(1);
    expect(theirs.received).toHaveLength(0);
  });

  it("routes server-wide fund changes to the admin channel only", () => {
    vi.useFakeTimers();
    const user = collector();
    const admin = collector();
    subscribe([userChannel("u1")], user.listen);
    subscribe([ADMIN_CHANNEL], admin.listen);

    publishAdminChange("funds", "updated", ["161125"]);
    vi.advanceTimersByTime(COALESCE_MS);

    expect(user.received).toHaveLength(0);
    expect(admin.received).toEqual([
      { type: "change", topic: "funds", action: "updated", ids: ["161125"] },
    ]);
  });

  it("drops the id list once a batch grows past the cap", () => {
    vi.useFakeTimers();
    const { received, listen } = collector();
    subscribe([userChannel("u1")], listen);

    for (let index = 0; index <= MAX_IDS_PER_EVENT; index += 1) {
      publishChange("u1", "notes", "updated", [`n${index}`]);
    }
    vi.advanceTimersByTime(COALESCE_MS);

    // Empty ids is the protocol's "assume any of them", which is what the
    // client widens on.
    expect(received).toEqual([{ type: "change", topic: "notes", action: "updated", ids: [] }]);
  });

  it("stops delivering after unsubscribe", () => {
    vi.useFakeTimers();
    const { received, listen } = collector();
    const unsubscribe = subscribe([userChannel("u1")], listen);
    unsubscribe();

    publishChange("u1", "notes", "created", ["n1"]);
    vi.advanceTimersByTime(COALESCE_MS);
    expect(received).toHaveLength(0);
  });

  it("sends job progress immediately, without coalescing", () => {
    vi.useFakeTimers();
    const { received, listen } = collector();
    subscribe([ADMIN_CHANNEL], listen);

    publishJob(
      {
        id: "job-1",
        status: "running",
        processedFunds: 12,
        totalFunds: 400,
        skippedFresh: 0,
        error: null,
      },
      "job-1",
    );

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: "job", activeJobId: "job-1" });
  });

  it("keeps one failing listener from starving the others", () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { received, listen } = collector();
    subscribe([userChannel("u1")], () => {
      throw new Error("this socket is broken");
    });
    subscribe([userChannel("u1")], listen);

    publishChange("u1", "notes", "created", ["n1"]);
    vi.advanceTimersByTime(COALESCE_MS);

    expect(received).toHaveLength(1);
  });
});
