import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyRealtimeMessage } from "./realtime-sync.js";
import type { JobsResult } from "./types.js";

let queryClient: QueryClient;
let invalidated: unknown[][];

beforeEach(() => {
  queryClient = new QueryClient();
  invalidated = [];
  vi.spyOn(queryClient, "invalidateQueries").mockImplementation((filters) => {
    invalidated.push((filters?.queryKey ?? []) as unknown[]);
    return Promise.resolve();
  });
});

describe("applyRealtimeMessage", () => {
  it("invalidates every list a note edit can move, plus the named note", () => {
    applyRealtimeMessage(queryClient, {
      type: "change",
      topic: "notes",
      action: "updated",
      ids: ["note-1"],
    });

    expect(invalidated).toEqual([
      ["notes"],
      ["note-collections"],
      ["note-facets"],
      ["overview"],
      ["note", "note-1"],
    ]);
  });

  it("widens to the detail prefix when the event names no ids", () => {
    applyRealtimeMessage(queryClient, {
      type: "change",
      topic: "skills",
      action: "deleted",
      ids: [],
    });

    expect(invalidated).toContainEqual(["skill"]);
  });

  it("invalidates each named id separately", () => {
    applyRealtimeMessage(queryClient, {
      type: "change",
      topic: "notes",
      action: "deleted",
      ids: ["a", "b"],
    });

    expect(invalidated).toContainEqual(["note", "a"]);
    expect(invalidated).toContainEqual(["note", "b"]);
  });

  it("touches no detail query for a topic that has none", () => {
    applyRealtimeMessage(queryClient, {
      type: "change",
      topic: "watchlist",
      action: "created",
      ids: ["list-1"],
    });

    expect(invalidated).toEqual([["watchlists"], ["watchlist-items"], ["overview"]]);
  });

  it("patches sync progress into the cache instead of refetching", () => {
    const seed: JobsResult = {
      items: [
        {
          id: "job-1",
          status: "running",
          processedFunds: 10,
          totalFunds: 400,
          skippedFresh: 0,
          error: null,
        } as JobsResult["items"][number],
      ],
      activeJobId: "job-1",
    };
    queryClient.setQueryData<JobsResult>(["sync-jobs"], seed);

    applyRealtimeMessage(queryClient, {
      type: "job",
      job: {
        id: "job-1",
        status: "running",
        processedFunds: 128,
        totalFunds: 400,
        skippedFresh: 3,
        error: null,
      },
      activeJobId: "job-1",
    });

    const patched = queryClient.getQueryData<JobsResult>(["sync-jobs"]);
    expect(patched?.items[0]).toMatchObject({ processedFunds: 128, skippedFresh: 3 });
    // The whole point of pushing values: no refetch to watch a number tick.
    expect(invalidated).toHaveLength(0);
  });

  it("clears the active job once a run reaches a terminal state", () => {
    queryClient.setQueryData<JobsResult>(["sync-jobs"], {
      items: [{ id: "job-1", status: "running" } as JobsResult["items"][number]],
      activeJobId: "job-1",
    });

    applyRealtimeMessage(queryClient, {
      type: "job",
      job: {
        id: "job-1",
        status: "succeeded",
        processedFunds: 400,
        totalFunds: 400,
        skippedFresh: 0,
        error: null,
      },
      activeJobId: null,
    });

    expect(queryClient.getQueryData<JobsResult>(["sync-jobs"])?.activeJobId).toBeNull();
  });

  it("refetches when the job is one the console has never seen", () => {
    queryClient.setQueryData<JobsResult>(["sync-jobs"], { items: [], activeJobId: null });

    applyRealtimeMessage(queryClient, {
      type: "job",
      job: {
        id: "job-new",
        status: "running",
        processedFunds: 0,
        totalFunds: 0,
        skippedFresh: 0,
        error: null,
      },
      activeJobId: "job-new",
    });

    expect(invalidated).toEqual([["sync-jobs"]]);
  });

  it("ignores the keepalive", () => {
    applyRealtimeMessage(queryClient, { type: "ping" });
    expect(invalidated).toHaveLength(0);
  });
});
