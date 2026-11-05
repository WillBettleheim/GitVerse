import { z } from "zod";

const apiUrlSchema = z.url({ protocol: /^https?$/ });

/** Falls back to the local default so a bad value can't take the demo down with it. */
export function resolveApiUrl(value: string | undefined): string {
  const parsed = apiUrlSchema.safeParse(value);
  return (parsed.success ? parsed.data : "http://localhost:8000").replace(/\/+$/, "");
}

// Next.js inlines NEXT_PUBLIC_* only when it's referenced by this exact name.
export const API_URL = resolveApiUrl(process.env.NEXT_PUBLIC_API_URL);
