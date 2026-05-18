import { create } from "zustand";

import { api } from "../api/client";

export type BackendStatus = "unknown" | "warming" | "ready";

interface BackendStatusState {
  status: BackendStatus;
  /** monotonic ms (performance.now()) when the current warmup started; null if ready. */
  warmStartedAt: number | null;
  /** Begin polling /health. Safe to call repeatedly; only one loop runs at a time. */
  startWarmup: () => void;
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollInFlight = false;

async function pingOnce(set: (partial: Partial<BackendStatusState>) => void) {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    await api.health();
    set({ status: "ready", warmStartedAt: null });
  } catch {
    // Stay in warming state; the next tick will retry.
  } finally {
    pollInFlight = false;
  }
}

export const useBackendStatus = create<BackendStatusState>((set, get) => ({
  status: "unknown",
  warmStartedAt: null,

  startWarmup: () => {
    const { status } = get();
    if (status === "ready") return;
    if (pollTimer !== null) return;

    set({ status: "warming", warmStartedAt: performance.now() });

    const tick = async () => {
      await pingOnce((p) => set(p));
      if (get().status === "ready") {
        if (pollTimer !== null) {
          clearTimeout(pollTimer);
          pollTimer = null;
        }
        return;
      }
      // Poll every 5s during warmup so we don't hammer the free-tier instance
      // but still notice quickly when it comes online.
      pollTimer = setTimeout(tick, 5000);
    };
    void tick();
  },
}));
