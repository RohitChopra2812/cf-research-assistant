import { ResearchWorkflow } from "./workflow";
import { Env, loadHistory } from "./db";

export { ResearchWorkflow };

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function errorResponse(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    // GET /history?userId=<id> — load prior conversation for page refresh
    if (request.method === "GET" && url.pathname === "/history") {
      const userId = url.searchParams.get("userId");
      if (!userId) return errorResponse("userId is required");

      const messages = await loadHistory(env.DB, userId, 40);
      return json({ messages });
    }

    // POST /chat — accept a message, run the workflow, stream the response
    if (request.method === "POST" && url.pathname === "/chat") {
      let body: { userId?: string; message?: string };
      try {
        body = await request.json();
      } catch {
        return errorResponse("Invalid JSON body");
      }

      const { userId, message } = body;
      if (!userId || typeof userId !== "string") return errorResponse("userId is required");
      if (!message || typeof message !== "string") return errorResponse("message is required");
      if (message.trim().length === 0) return errorResponse("message cannot be empty");

      // Run the Workflow — all 3 durable steps execute inside it
      let instance: WorkflowInstance;
      try {
        instance = await env.RESEARCH_WORKFLOW.create({ params: { userId, message } });
      } catch (err) {
        console.error("Failed to create workflow instance", err);
        return errorResponse("Failed to start workflow", 500);
      }

      // Poll the workflow until it finishes, then stream the result as SSE
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      const write = (data: string) => writer.write(encoder.encode(data));

      // Stream workflow output back to the client
      (async () => {
        try {
          // Poll until the workflow completes (Workers Workflows are async by nature)
          let status: InstanceStatus;
          for (let i = 0; i < 120; i++) {
            status = await instance.status();
            if (status.status === "complete" || status.status === "errored" || status.status === "terminated") break;
            await new Promise((r) => setTimeout(r, 500));
          }

          status = await instance.status();

          if (status.status === "complete" && status.output) {
            const text = status.output as string;
            // Emit as SSE — chunk into ~50-char pieces to simulate streaming
            const chunkSize = 50;
            for (let i = 0; i < text.length; i += chunkSize) {
              const chunk = text.slice(i, i + chunkSize);
              await write(`data: ${JSON.stringify({ token: chunk })}\n\n`);
              await new Promise((r) => setTimeout(r, 10));
            }
            await write(`data: ${JSON.stringify({ done: true })}\n\n`);
          } else {
            await write(`data: ${JSON.stringify({ error: "Workflow failed or timed out" })}\n\n`);
          }
        } catch (err) {
          console.error("Streaming error", err);
          await write(`data: ${JSON.stringify({ error: "Internal error" })}\n\n`);
        } finally {
          await writer.close();
        }
      })();

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          ...corsHeaders(),
        },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
