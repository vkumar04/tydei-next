import { defineRailway, github, preserve, project, service } from "railway/iac";

export const partial = "tydei-app";

export default defineRailway((ctx) => {
  const production = ctx.isEnvironment("production");
  const tydeiApp = service("tydei-app", {
    source: github("vkumar04/tydei-next", {
      branch: production ? "main" : "dev",
      checkSuites: false,
    }),
    build: "bun install --frozen-lockfile && bun run build",
    start: "bun run start",
    healthcheck: "/api/health",
    preDeploy: "bash scripts/prisma-deploy.sh",
    replicas: { "us-east4-eqdc4a": 1 },
    deploy: { ipv6EgressEnabled: true },
    domains: production ? ["tydei.com"] : [],
    env: {
      ANTHROPIC_API_KEY: preserve(),
      BETTER_AUTH_SECRET: preserve(),
      BETTER_AUTH_URL: preserve(),
      CRON_SECRET: preserve(),
      DATABASE_URL: preserve(),
      GOOGLE_API_KEY: preserve(),
      GOOGLE_GENERATIVE_AI_API_KEY: preserve(),
      LOG_PROXY_HEADERS: preserve(),
      NEXT_PUBLIC_APP_URL: preserve(),
      NEXT_PUBLIC_SITE_URL: preserve(),
      NEXT_PUBLIC_STRIPE_PRICE_ID: preserve(),
      NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: preserve(),
      RESEND_API_KEY: preserve(),
      S3_ACCESS_KEY_ID: preserve(),
      S3_BUCKET: preserve(),
      S3_ENDPOINT: preserve(),
      S3_REGION: preserve(),
      S3_SECRET_ACCESS_KEY: preserve(),
      SHOW_DEMO_LOGINS: preserve(),
      STRIPE_ENTERPRISE_PRICE_ID: preserve(),
      STRIPE_PRO_PRICE_ID: preserve(),
      STRIPE_SECRET_KEY: preserve(),
      STRIPE_WEBHOOK_SECRET: preserve(),
    },
  });
  return project("tydei-next", {
    resources: [tydeiApp],
  });
});
