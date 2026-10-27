# i messed up the old repo 😭 this is the new one

THIS IS CODED BY GEMINI, ALL IDEAS ARE MINE THOUGH. This is v1.0
see it for yourself! https://sigma-games.dev/ | https://sigma-sigma-rizz.vercel.app/ or go to the static.html and play them all in a single file!

## AI chat key setup

The AI chat is a normal backend proxy. There is exactly one place keys exist:

```
browser  ->  POST /api/ai/chat            (no key, just the conversation)
          ->  Express server adds the key
          ->  Groq / Emis API
          <-  streamed answer
```

So the key never appears in the JavaScript bundle, in DevTools, or in any
`fetch()` the browser makes. You can check that yourself: open DevTools →
Network, send a chat message, click the `/api/ai/chat` request — the request
contains only the messages, and the response contains only the answer.

### 1. Local development

```bash
cp .env.example .env     # fill in GROQ_API_KEYS and/or EMIS_API_KEY
npm install
npm run dev              # http://localhost:3000
```

`server.ts` loads `.env` from the project root on startup. `.env` is gitignored,
so it never gets pushed.

`server.ts` + `server/` **is** the backend: it serves the site, holds the keys,
and resolves music. There is no separate API folder — the same Node process
does both jobs, which is why one deploy is all you need. A static-only host
(Vercel, Netlify) can serve the frontend, but `/api/*` there returns 404, so
chat and music need the Node server running somewhere (Cloud Run below).

### 2. Cloud Run

Set the keys as environment variables on the service, not in the source:

1. Open the service in the Cloud Run console → **Edit & deploy new revision**
2. **Variables & Secrets** → **Add variable**
3. `GROQ_API_KEYS` = your Groq key (or several, comma separated)
4. `EMIS_API_KEY` = your Emis key
5. Deploy the new revision

Or from the CLI:

```bash
gcloud run deploy SERVICE_NAME \
  --set-env-vars GROQ_API_KEYS=key1,EMIS_API_KEY=key2
```

For anything you would rather not have in a shell history, use Secret Manager
and `--set-secrets GROQ_API_KEYS=groq-key:latest` instead.

### 3. Check it worked

```bash
curl https://YOUR-SITE/api/ai/health
```

```json
{
  "ok": true,
  "providers": {
    "emis": { "configured": true, "available": true, "lastError": null },
    "groq": { "configured": true, "keyCount": 2, "keysResting": 0 }
  }
}
```

That endpoint only returns booleans and counts — never a key or part of one.

## Full-length music and yt-dlp

Deezer and Octave (iTunes) only serve 30-second previews, so full tracks come
from a catalog that is verified to be the same recording (title + credited
artist + duration). When nothing is available, you get the real preview rather
than a different song.

The one gap is music that only exists on YouTube. The bundled Docker image
installs `yt-dlp` for that; the server uses it automatically when it is present
and quietly ignores it when it isn't. Set `YT_DLP_PATH` if the binary lives
somewhere else, or `YT_DLP_DISABLED=1` to skip it. YouTube refuses extraction
from many datacenter IPs, so a host that is not flagged — or a later move to a
VPS — is what makes this path actually produce audio.

### Which provider gets used

* `EMIS_API_KEY` serves the big model list (Claude, GPT, Grok, ...).
* `GROQ_API_KEYS` is the fallback, and also the only option if Emis is not set.
* If a provider errors or runs out of quota it rests for 60 seconds and the other
  one answers instead. The UI picks up the switch from the `x-switched-provider`
  response header, so the chat keeps working without an error message.
* Only one of the two keys is required. `/api/ai/health` tells you which are seen.
