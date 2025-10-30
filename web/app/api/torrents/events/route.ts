import { synchronizeActive } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function GET() {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let stopped = false;
      const tick = async () => {
        if (stopped) return;
        try {
          const { items } = await synchronizeActive();
          const payload = JSON.stringify({ type: "torrent.updated", items });
          try {
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
          } catch {
            // stream likely closed
            stopped = true;
          }
        } catch (e) {
          // If aria2 is offline or any error occurs, stay silent in the stream
          // to avoid error spam while keeping the connection alive.
        }
      };
      const interval = setInterval(tick, 1000);
      // fire immediately
      void tick();
      const cancel = () => {
        stopped = true;
        clearInterval(interval);
        try {
          controller.close?.();
        } catch {}
      };
      // @ts-expect-error: controller has no oncancel typing here
      controller.oncancel = cancel;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}


