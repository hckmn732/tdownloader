import { NextRequest } from "next/server";
import { runPostProcessingAgent } from "@/lib/agents/postProcessingAgent";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  // Accept either a raw string JSON or a full JSON object; forward all provided fields as-is
  const payload = typeof body === "string"
    ? body
    : JSON.stringify(body);

  const result = await runPostProcessingAgent(payload);
  return new Response(result, {
    headers: { "content-type": "application/json" }
  });
}


