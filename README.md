# Akasha

**A family document hub for parents, powered by Paperless-ngx.** [中文说明](README.zh-CN.md)

Akasha is a big-text, phone-first web app that sits in front of
[Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx). Paperless does
the heavy lifting (storage, OCR, full-text search, permissions). Akasha gives
older family members a screen they can actually use: snap a photo of an
insurance policy, pick whose it is, done. Find it later by person, by category
or by typing a word.

The name comes from Ākāśagarbha (虚空藏菩萨), the bodhisattva whose name means
"treasury as boundless as space", traditionally associated with memory.

<p>
  <img src="docs/screenshots/home.png" width="240" alt="Home">
  <img src="docs/screenshots/detail.png" width="240" alt="Document">
  <img src="docs/screenshots/upload.png" width="240" alt="Upload">
</p>

## Features

- Large text by default, three text sizes, high-contrast warm theme, dark mode
- Home screen: search, one big "snap & save" button, expiring soon, by person, by category
- Upload from the camera or photo library, tag person and category with large chips
- Expiry dates with "N days left" badges, editable on the document page
- Chinese and English UI
- Installable to the home screen (PWA)
- Every request runs with the user's own Paperless token, so Paperless permissions apply

Planned: AI extraction of policy numbers and dates, WeChat reminders, AI Q&A over your documents.

## How it maps onto Paperless

| Akasha | Paperless-ngx |
| --- | --- |
| Category (保险, 证件 …) | Document type |
| Family member | Tag named `家人/<name>` (prefix configurable) |
| Expiry date | Date custom field `到期日` (name configurable) |
| Login | Paperless user account |

An admin can create the defaults from **Settings → First-time setup**.

## Run it

Requires a running Paperless-ngx 2.x.

```sh
cp .env.example .env        # set PAPERLESS_URL and AKASHA_SECRET
docker compose -f docker-compose.example.yml up -d
```

Then open `http://<host>:3100` and log in with a Paperless account.
Put it behind HTTPS (for example a Cloudflare Tunnel or a reverse proxy) before
using it outside your home network.

## Develop

Node 22.18+ (TypeScript runs natively, no build step for the server).

```sh
npm install
npm run dev     # mock Paperless on :8001, API on :3000, UI on :5173
npm test        # API tests against the mock
```

Mock logins: `admin`/`admin` and `mama`/`mama`.

## License

MIT
