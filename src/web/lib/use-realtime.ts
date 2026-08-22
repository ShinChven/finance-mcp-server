import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { applyRealtimeMessage } from "./realtime-sync.js";
import { realtime, type RealtimeStatus } from "./realtime.js";

/**
 * Mounts the realtime connection for the app.
 *
 * Called once, from the shell. The returned status is only for the connection
 * indicator -- pages never read it, because a page that renders differently
 * depending on socket health is a page with two behaviours to debug.
 */
export function useRealtime(): RealtimeStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>(realtime.currentStatus);

  useEffect(() => {
    const offStatus = realtime.onStatus(setStatus);
    const offMessage = realtime.subscribe((message) => applyRealtimeMessage(queryClient, message));
    // Events that arrived while disconnected are gone; refetching everything
    // once is cheaper and more reliable than a replay protocol.
    const offResync = realtime.onResync(() => void queryClient.invalidateQueries());
    return () => {
      offStatus();
      offMessage();
      offResync();
    };
  }, [queryClient]);

  return status;
}
