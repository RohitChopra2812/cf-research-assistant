# CF Research Assistant

An AI-powered research assistant built on Cloudflare's edge stack.

## Components

| Requirement | Service |
|---|---|
| LLM | Workers AI — `@cf/meta/llama-3.3-70b-instruct-fp8-fast` |
| Workflow/coordination | Cloudflare Workflows (3 durable steps) |
| User input via chat | Cloudflare Pages + SSE streaming |
| Memory/state | Cloudflare D1 (SQLite) |

## Setup

### 1. Install dependencies

```bash
cd cf-research-assistant
npm install
```

### 2. Create the D1 database

```bash
npx wrangler d1 create research-assistant-db
```

Copy the `database_id` from the output and replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` in `wrangler.toml`.

### 3. Run the D1 migration

```bash
npm run db:migrate
```

### 4. Local development

```bash
npm run dev
```

Open http://localhost:8787

### 5. Deploy

```bash
# Deploy the Worker
npm run deploy

# Run remote D1 migration (first deploy only)
npm run db:migrate:remote

# Deploy static UI to Pages
npx wrangler pages deploy public --project-name cf-research-assistant
```

## Architecture

```
Browser (Pages)
  │  POST /chat { userId, message }
  ▼
Worker (src/index.ts)
  │  env.RESEARCH_WORKFLOW.create(...)
  ▼
ResearchWorkflow (src/workflow.ts)
  ├── step 1: load_history  →  D1 SELECT
  ├── step 2: generate       →  Workers AI (Llama 3.3 70B)
  └── step 3: save_turn      →  D1 INSERT x2
  │
  SSE stream → browser renders tokens
```

Each Workflow step is **durable** — if the Worker crashes mid-run it resumes from the last completed step, so conversation history is never lost or double-saved.
