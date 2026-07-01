"use client";

import { apiPost } from "./api-client";

/**
 * Kiosk offline queue (P12): when a punch fails with a NETWORK error (WiFi
 * blip), it is stored in localStorage with the wall-clock time and replayed
 * when connectivity returns. The server stamps replayed punches with the
 * queued time (bounded 24h) and flags the entry `offline_queued` for review.
 */
const KEY = "tc_offline_queue";

export interface QueuedPunch {
  path: string; // "/clock/in" | "/clock/out"
  data: Record<string, unknown>;
  queuedAt: string;
}

export function queuedPunches(): QueuedPunch[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function enqueuePunch(path: string, data: Record<string, unknown>): void {
  const q = queuedPunches();
  q.push({ path, data, queuedAt: new Date().toISOString() });
  localStorage.setItem(KEY, JSON.stringify(q));
}

/** Replay the queue in order; stops at the first failure. Returns #flushed. */
export async function flushQueue(): Promise<number> {
  const q = queuedPunches();
  let done = 0;
  while (q.length > 0) {
    const p = q[0];
    try {
      await apiPost(p.path, { ...p.data, clientQueuedAt: p.queuedAt });
      q.shift();
      done++;
      localStorage.setItem(KEY, JSON.stringify(q));
    } catch (e) {
      // API errors (4xx) mean the punch is invalid now (e.g. already clocked
      // in) — drop it rather than blocking the queue. Network errors keep it.
      if (e instanceof TypeError) break;
      q.shift();
      localStorage.setItem(KEY, JSON.stringify(q));
    }
  }
  return done;
}

export function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError; // fetch network failures surface as TypeError
}
