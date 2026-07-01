import { handle } from "hono/vercel";
import { app } from "@/server/hono";

// Mount the Hono app as the App Router catch-all. Every HTTP method funnels
// through the same handler so Hono owns routing/validation for the whole API.
export const runtime = "nodejs";
// Force dynamic — this is a live API surface (clock punches, health), never
// statically prerendered.
export const dynamic = "force-dynamic";

const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
