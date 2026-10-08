import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import { Env, loadHistory, saveTurn } from "./db";

export interface WorkflowParams {
  userId: string;
  message: string;
}

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const SYSTEM_PROMPT = `You are a knowledgeable research assistant with a great memory. \
You help users explore topics deeply, building on what they've asked about in previous conversations. \
Be thorough but concise. When you recall something from earlier in the conversation, reference it naturally. \
Format your answers with clear structure when helpful (bullet points, sections), but keep it conversational.`;

export class ResearchWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
  async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep): Promise<string> {
    const { userId, message } = event.payload;

    // Step 1 — load conversation history from D1 (durable: retries without re-querying if step 2 fails)
    const history = await step.do("load_history", async () => {
      return loadHistory(this.env.DB, userId, 20);
    });

    // Step 2 — call Workers AI and collect the full streamed response
    const assistantResponse = await step.do("generate", async () => {
      const messages = [
        { role: "system" as const, content: SYSTEM_PROMPT },
        ...history,
        { role: "user" as const, content: message },
      ];

      const response = await this.env.AI.run(MODEL, {
        messages,
        max_tokens: 1024,
        temperature: 0.6,
        stream: false,
      } as Parameters<Ai["run"]>[1]) as { response?: string };

      return response.response ?? "";
    });

    // Step 3 — persist both turns to D1 (auto-retried if save fails after delivery)
    await step.do("save_turn", async () => {
      await saveTurn(this.env.DB, userId, message, assistantResponse);
    });

    return assistantResponse;
  }
}
