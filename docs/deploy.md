# Self-hosting Akasha

[中文](deploy.zh-CN.md)

Akasha is a front end only: documents live in your own Paperless-ngx. To run it
for your family you need:

**Hardware**
- An always-on machine that runs Docker Compose: a NAS (UGREEN, Synology,
  QNAP, Unraid …), a mini PC or a home server. The published image is
  `linux/amd64`; for ARM, build it yourself with `docker build .`.
- 4 GB RAM or more. Akasha uses about 30 MB; Paperless with Postgres and Redis
  about 1 GB.
- Disk for the images (about 1 GB) plus your documents.
- **A backup.** You will be storing ID cards and insurance policies. Set up a
  backup of the Paperless volumes (USB drive, second NAS, cloud) before you
  rely on it, especially on a RAID 0 or single-disk NAS.

**Software**
- Paperless-ngx 2.x or newer. The example compose installs it for you; an
  existing instance works too.
- Optional: an OpenAI-compatible API with a vision model, for AI reading of
  photos (title, person, category, expiry, key details). Photos are sent to
  that provider, so choose one you trust.
- Optional: a domain and HTTPS for use outside your home network. "Add to home
  screen" on phones needs HTTPS. Cloudflare Tunnel works without opening ports.

## Steps

1. Get the files and fill in `.env`:
   ```sh
   git clone https://github.com/jianhengLiu/akasha && cd akasha
   cp .env.example .env
   ```
   Set the values marked `required`: `PAPERLESS_SECRET_KEY`, `PAPERLESS_DBPASS`,
   `PAPERLESS_ADMIN_PASSWORD` and `AKASHA_SECRET` (each from
   `openssl rand -hex 32`). Keep `AKASHA_SECRET` stable; changing it logs
   everyone out and makes the stored AI key unreadable.
2. Start everything:
   ```sh
   docker compose -f docker-compose.example.yml up -d
   ```
   On a NAS you can paste the compose file into its Docker "project" screen
   instead. If you already run Paperless, delete the `broker`, `db` and
   `paperless` services and point `PAPERLESS_URL` at your instance's LAN
   address, e.g. `http://192.168.1.10:8000`.
3. Check it: `http://<host>:3100/api/health` should return `{"ok":true}`.
4. Open `http://<host>:3100` and log in with the Paperless admin account. In
   **Settings**, run **First-time setup** (creates the default categories and
   family members; edit `AKASHA_DEFAULT_*` first if you like). If you set up AI,
   enter the API key in Settings.
5. Family members tap **Request an account** on the login page; you approve
   each one in Settings and say which family member they are. Everything saved
   through Akasha is shared with the family group automatically.
6. Optional, outside access: create a Cloudflare Tunnel, run `cloudflared`
   (`tunnel --no-autoupdate run` with `TUNNEL_TOKEN`) and add a public
   hostname pointing at `http://<host LAN IP>:3100`. Use a first-level
   subdomain such as `family.example.com`: Cloudflare's free certificate does
   not cover `a.b.example.com`. Then set `PAPERLESS_PUBLIC_URL` if you also
   expose Paperless.

## Notes

- **Mainland China**: the NAS often cannot pull from Docker Hub or ghcr.io.
  On a computer with a proxy, save the images as tar files
  (`docker pull --platform linux/amd64 … && docker save -o akasha.tar …`, or
  `crane pull --platform linux/amd64 …`), copy them to the NAS and use its
  "import image" function; then redeploy without "pull latest image". The
  Chinese OCR pack is also downloaded at start; offline, download
  `chi_sim.traineddata` from
  [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) and mount it
  into `/usr/share/tesseract-ocr/5/tessdata/` instead of `PAPERLESS_OCR_LANGUAGES`.
- **Security**: keep Paperless's own sign-up off (`PAPERLESS_ACCOUNT_ALLOW_SIGNUPS`
  unset); new accounts go through Akasha's approval. Akasha limits failed logins
  per IP, never stores documents itself and calls Paperless with each user's own
  token.
- **Feedback**: to receive in-app feedback as GitHub issues, set
  `AKASHA_GITHUB_TOKEN` (fine-grained, "Issues: read and write" on one repo) and
  `AKASHA_FEEDBACK_REPO` to your own repository. Otherwise it is written to
  `feedback.jsonl` in the data volume.
- **Updating**: `docker compose -f docker-compose.example.yml pull && docker compose -f docker-compose.example.yml up -d`.
  Akasha's own state (pending sign-ups, the AI key) is in the `akasha-data` volume.

