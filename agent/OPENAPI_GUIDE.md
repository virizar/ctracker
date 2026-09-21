# Multi-Provider AI Assistant & OpenAPI Setup Guide (`OPENAPI_GUIDE.md`)

This guide explains how to connect your self-hosted `ctracker_api` server to AI assistant providers (Google Gemini Custom Gems, ChatGPT Custom GPTs, Open WebUI, or custom bots) using Cloudflare Tunnel and OpenAPI.

---

## 1. Exposing Your Server via Cloudflare Tunnel

To make your local FastAPI server securely accessible over HTTPS:

```bash
# Create tunnel to port 8000
cloudflared tunnel --url http://localhost:8000
```

Map your custom domain (e.g. `https://api.yourdomain.com`) in the Cloudflare Dashboard.

---

## 2. Locating Your OpenAPI Spec

The OpenAPI schema is protected with authentication (`X-API-Key` or `Authorization: Bearer <key>`) at:
`https://api.yourdomain.com/openapi.json`

Export the static schema locally using your API key:
```bash
curl -H "X-API-Key: ctk_live_..." http://localhost:8000/openapi.json -o agent/openapi.json
```

---

## 3. Dynamic Bootstrap Setup (Auto-Updating System Prompt)

With the **Dynamic Bootstrap** pattern, you never need to manually re-copy system prompt changes into your AI Provider settings when you update the codebase.

### 3-Line Bootstrap Prompt (Paste into Provider System Instructions):
```markdown
You are the Calorie & Nutrition Assistant for ctracker_api.
Upon initialization or first user request, call GET /v1/agent/config to fetch your active system instructions, version, and protocol guidelines.
Strictly adhere to the system instructions and protocol guidelines returned by GET /v1/agent/config.
```

When the AI receives a user prompt, it calls `GET /v1/agent/config` on your server and instantly receives the latest system prompt and guidelines from your Git repository!

---

## 4. Provider-Specific Setup Instructions

### 🔹 Google Gemini Custom Gems
1. Open **Gemini App** $\rightarrow$ **Custom Gems** $\rightarrow$ **New Gem**.
2. **Name**: `Calorie & Nutrition Assistant`.
3. **Instructions**: Paste the 3-line Bootstrap Prompt above.
4. **Actions / Tools**: Click **Add Action** $\rightarrow$ Paste `https://api.yourdomain.com/openapi.json`.
5. **Authentication**:
   * Type: `API Key`
   * Key Header Name: `X-API-Key`
   * API Key Value: `ctk_live_...` (Your provisioned API key)

### 🔹 OpenAI ChatGPT Custom GPTs
1. Go to **Explore GPTs** $\rightarrow$ **Create**.
2. **Instructions**: Paste the 3-line Bootstrap Prompt above.
3. **Actions**: Click **Create new action** $\rightarrow$ Import OpenAPI URL `https://api.yourdomain.com/openapi.json`.
4. **Authentication**: API Key $\rightarrow$ Custom Header Name: `X-API-Key`.

### 🔹 Self-Hosted Local Agents (Open WebUI, Ollama, LangChain)
1. Import `agent/openapi.json` as a tool plugin.
2. Supply `X-API-Key` in request headers.

---

## 5. Key Endpoints Used by the Agent

| Action | HTTP Method | Endpoint | Purpose |
| :--- | :--- | :--- | :--- |
| **Fetch Agent Config** | `GET` | `/v1/agent/config` | Dynamically fetch latest system prompt, version, and rules |
| **Batch Log Meals** | `POST` | `/v1/food/meals` | Log parsed meal items array upon confirmation |
| **Search Catalog** | `GET` | `/v1/food/search` | Search canonical food library |
| **Log Scale Weight** | `POST` | `/v1/weight` | Log daily scale weight |
| **Get Dashboard** | `GET` | `/v1/dashboard/summary` | Retrieve daily progress, TDEE, & projections |
| **Update Profile Goals** | `PATCH` | `/v1/auth/me` | Update target weight, rate, or safety floor |
| **Bulk Import File** | `POST` | `/v1/import/file` | One-time migration of `.json` or `.json.gz` historical data |
