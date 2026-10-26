// All settings come from environment variables so the same image works for
// any family. See .env.example for descriptions.

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable ${name}`);
}

export const config = {
  port: Number(env("PORT", "3000")),
  paperlessUrl: env("PAPERLESS_URL", "http://localhost:8001"),
  secret: env("AKASHA_SECRET", process.env.NODE_ENV === "production" ? undefined : "dev-secret-change-me"),
  // Family members are Paperless tags named with this prefix, e.g. "家人/妈妈".
  peoplePrefix: env("AKASHA_PEOPLE_PREFIX", "家人/"),
  // Name of the Paperless date custom field used for renewals and expiry.
  expiryField: env("AKASHA_EXPIRY_FIELD", "到期日"),
  // Categories created by "first-time setup". Comma separated.
  defaultCategories: env("AKASHA_DEFAULT_CATEGORIES", "保险,证件,医疗,房产,车辆,票据,其他")
    .split(",").map((s) => s.trim()).filter(Boolean),
  defaultPeople: env("AKASHA_DEFAULT_PEOPLE", "爸爸,妈妈")
    .split(",").map((s) => s.trim()).filter(Boolean),
  staticDir: env("AKASHA_STATIC_DIR", "web/dist"),
  dataDir: env("AKASHA_DATA_DIR", "data"),
  // In-app feedback becomes GitHub issues when both are set; otherwise it is
  // saved to <dataDir>/feedback.jsonl.
  githubToken: process.env.AKASHA_GITHUB_TOKEN ?? "",
  feedbackRepo: process.env.AKASHA_FEEDBACK_REPO ?? "",
};
