# Akasha: notes for contributors and coding agents

- Users are elderly parents on phones. Every UI change must keep: large text (rem-based, scaled by `html[data-font]`), touch targets at least 48px (prefer `min-h-14`/`min-h-16`), short Chinese labels, few levels of navigation.
- All user-visible strings live in `web/src/lib/i18n.ts` (zh first, en must stay in sync; the `Dict` type enforces it).
- The server (`server/`) runs TypeScript directly on Node 22.18+ via type stripping: use `.ts` import extensions, no enums/namespaces/parameter properties (`erasableSyntaxOnly`).
- The server never stores documents. It calls Paperless-ngx with the logged-in user's token (signed httpOnly cookie). Keep the API surface in `server/app.ts` narrow; do not add a generic proxy.
- Paperless mapping (see `server/family.ts`): category = document type, person = tag with `AKASHA_PEOPLE_PREFIX`, expiry = date custom field `AKASHA_EXPIRY_FIELD`.
- `mock/paperless-mock.ts` mimics the Paperless endpoints we use. When you call a new Paperless endpoint, add it to the mock and cover it in `test/api.test.ts`.
- Checks: `npm run typecheck && npm test && npm run build`.
- No secrets in the repo; configuration comes from environment variables (`.env.example`).
