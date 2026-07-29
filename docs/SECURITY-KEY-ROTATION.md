# seo-tools — Key Rotation & Security

**Status:** 🟡 Phase 0 · **Last updated:** 2026-07-29

---

## Klíče k rotaci

### Interní tokeny (DevOps — quarterly)

| Klíč               | Typ    | Cadence    | Poznámka                                                 |
| ------------------ | ------ | ---------- | -------------------------------------------------------- |
| **SEO_MCP_TOKEN**  | Auth   | 90 dní     | Token pro MCP server auth                                |
| **MAIL_API_TOKEN** | Shared | **90 dní** | ⚠️ CENTRALIZOVANĚ — viz `docs/SECURITY-MULTI-PROJECT.md` |

### Externí klíče (Luděk — když budeš mít čas)

| Klíč        | Služba               | Cadence | Poznámka                     |
| ----------- | -------------------- | ------- | ---------------------------- |
| LLM_API_KEY | OpenAI (nebo Ollama) | 90 dní  | Pokud LLM_PROVIDER=openai    |
| (žádný)     | Ollama               | —       | Dev mode, LLM_API_KEY=ollama |

---

## 🔄 Rotace interních tokenů

### Krok 1: Audit

```bash
bash ../scripts/audit-secrets-all.sh
```

Mělo by projít zelené pro seo-tools.

### Krok 2: Generuj nový SEO_MCP_TOKEN

```bash
SEO_MCP_TOKEN=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
echo "SEO_MCP_TOKEN=$SEO_MCP_TOKEN"
```

### Krok 3: Update `.env`

```bash
# Backup
cp .env .env.backup.$(date +%Y%m%d-%H%M%S)

# Vložit nový SEO_MCP_TOKEN do .env
# MAIL_API_TOKEN se aktualizuje centralizovaně (všechny 3 projekty najednou)
```

### Krok 4: Update `.env.example` (template)

```bash
cat > .env.example << 'EOF'
# ─── Crawler target settings ──────────────────────────────────────────────────

CRAWLER_START_URLS=https://example.com
CRAWLER_ALLOWED_DOMAINS=example.com,www.example.com
CRAWLER_EXCLUDED_DOMAINS=api.example.com,cdn.example.com
CRAWLER_EXCLUDED_PATHS=/wp-admin,/user/login,/cart,/checkout
CRAWLER_SITEMAP_DISCOVERY=true
CRAWLER_RESPECT_ROBOTS_TXT=true

# ─── MCP server (optional) ────────────────────────────────────────────────────

# Generate token with: openssl rand -hex 24
SEO_MCP_TOKEN=generate-with-openssl-rand-base64-32

MCP_PORT=3001

# Mail API Configuration (shared across all lkv projects)
MAIL_API_TOKEN=generate-with-openssl-rand-base64-32
MAIL_API_URL=http://sales-assistant-assistant-1:8000/api/mail/send
SMTP_FROM=seo@ludekkvapil.cz

# ─── LLM Configuration ───────────────────────────────────────────

# Uncomment one provider:
# LLM_PROVIDER=openai
# LLM_PROVIDER=ollama (dev mode, local)

# --- openai preset ---
# LLM_API_KEY=sk-proj-YOUR-KEY-HERE
# LLM_BASE_URL=                    # leave unset for OpenAI default
# LLM_MODEL=gpt-4o-mini

# --- ollama preset (local) ---
# LLM_PROVIDER=ollama
# LLM_API_KEY=ollama               # any non-empty value
# LLM_BASE_URL=http://localhost:11434/v1
# LLM_MODEL=llama3.1
EOF
```

### Krok 5: Docker restart

```bash
docker compose down
docker compose build
docker compose up -d
docker compose ps
```

### Krok 6: Ověř MCP auth

```bash
# Verifikuj že SEO_MCP_TOKEN je vyžadován
SEO_TOKEN=$(grep SEO_MCP_TOKEN .env | cut -d= -f2)

# Test s tokenem (měl by vrátit 200)
curl -H "Authorization: Bearer $SEO_TOKEN" http://localhost:3001/health \
  && echo "✅ MCP auth working" \
  || echo "❌ MCP auth failed"

# Test bez tokenu (měl by vrátit 401)
curl http://localhost:3001/health \
  && echo "❌ MCP auth NOT enforced (BUG!)" \
  || echo "✅ MCP auth is enforced"
```

---

## 🚨 MAIL_API_TOKEN — Centrální koordinace

⚠️ **Důležité:** MAIL_API_TOKEN se **MUSÍ** rotovat **ve všech 3 projektech najednou**:

- osintbot
- sales-assistant
- seo-tools ← **vy jste tady**

Viz: `../docs/SECURITY-MULTI-PROJECT.md` → sekce "Centrální rotace"

### Postup

1. DevOps generuje nový MAIL_API_TOKEN jednou
2. Aplikuje ho do `.env` ve VŠECH 3 projektech
3. Restartuje VŠECHNY 3 Docker stacky (téměř simultánně, max ~1 min interval)
4. Verifikuje že všechny služby komunikují správně

Pokud by se aplikovalo jen v jednom projektu, ostatní by nemohli komunikovat s mail API.

---

## 📋 Checklist — Phase 0

- [ ] Spustit `bash ../scripts/audit-secrets-all.sh` → zelené
- [ ] Generovat nový SEO_MCP_TOKEN
- [ ] Aktualizovat `.env` (MAIL_API_TOKEN se aplikuje centralizovaně)
- [ ] Aktualizovat `.env.example` s placeholdery
- [ ] Docker restart (`docker compose down && build && up`)
- [ ] Ověřit MCP auth (curl testy s tokenem)
- [ ] Commit do git (`.env.example`, audit docs)

---

## 📞 Reference

- Centrální multi-project security: `../docs/SECURITY-MULTI-PROJECT.md`
- Audit script: `../scripts/audit-secrets-all.sh`
- osintbot security: `../osintbot/docs/SECURITY-KEY-ROTATION.md`
- sales-assistant security: `../sales-assistant/docs/SECURITY-KEY-ROTATION.md`

---

**Version:** 1.0 · **Status:** 🟡 Ready for Phase 0 execution · **Last updated:** 2026-07-29
