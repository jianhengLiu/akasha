# Akasha

**A family document box for your parents.** Snap a photo of a policy or an ID card, tap whose it is, and it is saved. Find it later by person, by category or by searching. [中文说明](README.zh-CN.md)

![Akasha on a phone](docs/screenshots/banner.png)

## What it does

- **Save**: take a photo, pick a file, or type a note. Optional AI fills in the title, person, category and expiry date for you.
- **Find**: search, browse by family member or category, see what expires soon.
- **Share**: each document is visible to the whole family, only you, or the people you pick.
- **Made for parents**: big text, big buttons, Chinese by default, add it to the phone's home screen like an app.

Akasha is a front end for [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx), which stores the files on your own NAS or server.

## Run it

You need an always-on machine with Docker (a NAS is ideal), 4 GB RAM or more.

```sh
git clone https://github.com/jianhengLiu/akasha && cd akasha
cp .env.example .env    # fill in the values marked "required"
docker compose -f docker-compose.example.yml up -d
```

Open `http://<host>:3100`, log in with the Paperless admin account, and press **First-time setup** in Settings. Family members then request an account from the login page and you approve them.

Full guide (existing Paperless, AI, HTTPS, mainland China, backups): [docs/deploy.md](docs/deploy.md).

## Develop

```sh
npm install
npm run dev     # mock Paperless + API + UI on http://localhost:5173 (admin/admin, mama/mama)
npm test
```

House rules are in [CLAUDE.md](CLAUDE.md). MIT licensed.
