import { create } from "zustand";

import { api } from "../api/client";

export type BackendStatus = "unknown" | "warming" | "ready";

interface BackendStatusState {
  status: BackendStatus;
  /** monotonic ms (performance.now()) when the current warmup started; null if ready. */
  warmStartedAt: number | null;
  /** Begin polling /health. Safe to call repeatedly; only one loop runs at a time. */
  startWarmup: () => void;
  /** Flip to ready immediately. Called from jsonFetch on any 2xx — a live call is
   *  better proof of warmth than a delayed /health poll. */
  markReady: () => void;
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
      // Poll every 3s during warmup so the pill flips to ready quickly once the
      // backend wakes up, without hammering the free-tier instance.
      pollTimer = setTimeout(tick, 3000);
    };
    void tick();
  },

  markReady: () => {
    if (get().status === "ready") return;
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    set({ status: "ready", warmStartedAt: null });
  },
}));
