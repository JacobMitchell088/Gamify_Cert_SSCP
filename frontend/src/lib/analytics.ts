import { track } from "@vercel/analytics";

export type AnalyticsEvent =
  | "play_started"
  | "play_finished"
  | "game_selected"
  | "feedback_submitted"
  | "report_submitted";

type Props = Record<string, string | number | boolean | null>;

/** Thin wrapper so call sites have a strict event-name set and a single import. */
export function trackEvent(name: AnalyticsEvent, props?: Props): void {
  try {
    track(name, props);
  } catch {
    // Analytics is best-effort — never let a tracking call break the app.
  }
}
