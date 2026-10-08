export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface Env {
  AI: Ai;
  DB: D1Database;
  RESEARCH_WORKFLOW: Workflow;
}

export async function loadHistory(db: D1Database, userId: string, limit = 20): Promise<Message[]> {
  const result = await db
    .prepare(
      `SELECT role, content FROM conversations
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .bind(userId, limit)
    .all<{ role: "user" | "assistant"; content: string }>();

  // Results come back newest-first; reverse to chronological order
  return (result.results ?? []).reverse();
}

export async function saveTurn(
  db: D1Database,
  userId: string,
  userMessage: string,
  assistantMessage: string
): Promise<void> {
  const insert = db.prepare(
    `INSERT INTO conversations (user_id, role, content) VALUES (?, ?, ?)`
  );
  await db.batch([
    insert.bind(userId, "user", userMessage),
    insert.bind(userId, "assistant", assistantMessage),
  ]);
}
