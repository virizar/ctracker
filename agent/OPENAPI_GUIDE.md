# Gemini Custom Action & OpenAPI Setup Guide (`OPENAPI_GUIDE.md`)

This guide explains how to connect your self-hosted `ctracker_api` server to the Gemini App or ChatGPT Custom GPTs using Cloudflare Tunnel and OpenAPI.

---

## 1. Exposing Your Server via Cloudflare Tunnel

To make your local FastAPI server securely accessible over HTTPS:

```bash
# Install cloudflared (if not installed)
# Create tunnel to port 8000
cloudflared tunnel --url http://localhost:8000
```

Map your custom domain (e.g. `https://api.yourdomain.com`) in the Cloudflare Dashboard.

---

## 2. Locating Your OpenAPI Spec

FastAPI automatically generates an OpenAPI 3.0 schema at:
`https://api.yourdomain.com/openapi.json`

You can also export the static schema locally:
```bash
curl http://localhost:8000/openapi.json -o agent/openapi.json
```

---

## 3. Configuring Gemini Custom Gem / GPT Custom Action

1. Open **Gemini App** $\rightarrow$ **Custom Gems** $\rightarrow$ Create New Gem.
2. Paste the contents of `agent/SYSTEM_PROMPT.md` into **Instructions**.
3. Click **Add Action / Tool** and paste your OpenAPI URL `https://api.yourdomain.com/openapi.json`.
4. **Authentication**:
   * Type: `API Key`
   * Key Header Name: `X-API-Key`
   * API Key Value: `ctk_live_...` (Your provisioned API key)

---

## 4. Key Endpoints Used by the Agent

| Action | HTTP Method | Endpoint | Purpose |
| :--- | :--- | :--- | :--- |
| Batch Log Meals | `POST` | `/v1/food/meals` | Log parsed meal items array upon confirmation |
| Search Catalog | `GET` | `/v1/food/search` | Search canonical food library |
| Log Scale Weight | `POST` | `/v1/weight` | Log daily scale weight |
| Get Dashboard | `GET` | `/v1/dashboard/summary` | Retrieve daily progress, TDEE, & projections |
| Update Profile Goals | `PATCH` | `/v1/auth/me` | Update target weight, rate, or safety floor |
