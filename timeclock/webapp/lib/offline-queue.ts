"use client";

import { apiPost } from "./api-client";

/**
 * Kiosk offline queue (P12): when a punch fails with a NETWORK error (WiFi
 * blip), it is stored in localStorage with the wall-clock time and replayed
 * when connectivity returns. The server stamps replayed punches with the
 * queued time (bounded 24h) and flags the entry `offline_queued` for review.
 *
 * The queue is per device but every punch carries its employee: a shared
 * kiosk only shows/replays the signed-in person's own punches, and the
 * server rejects a replay whose `queuedFor` isn't the session employee.
 * Legacy entries without an employee are never replayed.
 */
const KEY = "tc_offline_queue";

export interface QueuedPunch {
  employeeId: string;
  path: string; // "/clock/in" | "/clock/out"
  data: Record<string, unknown>;
  queuedAt: string;
}

function readAll(): QueuedPunch[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

const writeAll = (q: QueuedPunch[]) => localStorage.setItem(KEY, JSON.stringify(q));

/** This person's punches, in queue order. */
export const ownPunches = (q: QueuedPunch[], employeeId: string) => q.filter((p) => p.employeeId === employeeId);

/** The queue minus one punch (matched by owner + path + queuedAt). */
export const withoutPunch = (q: QueuedPunch[], p: QueuedPunch) =>
  q.filter((x) => !(x.employeeId === p.employeeId && x.path === p.path && x.queuedAt === p.queuedAt));

export function queuedPunches(employeeId: string): QueuedPunch[] {
  return ownPunches(readAll(), employeeId);
}

export function enqueuePunch(employeeId: string, path: string, data: Record<string, unknown>): void {
  const q = readAll();
  q.push({ employeeId, path, data, queuedAt: new Date().toISOString() });
  writeAll(q);
}

/** Replay this person's punches in order; stops at the first network failure. Returns #flushed. */
export async function flushQueue(employeeId: string): Promise<number> {
  let done = 0;
  for (const p of ownPunches(readAll(), employeeId)) {
    try {
      await apiPost(p.path, { ...p.data, clientQueuedAt: p.queuedAt, queuedFor: p.employeeId });
      done++;
    } catch (e) {
      // API errors (4xx) mean the punch is invalid now (e.g. already clocked
      // in) — drop it rather than blocking the queue. Network errors keep it.
      if (e instanceof TypeError) break;
    }
    // Re-read: others may have queued meanwhile.
    writeAll(withoutPunch(readAll(), p));
  }
  return done;
}

export function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError; // fetch network failures surface as TypeError
}
