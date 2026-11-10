// Guards the access scopes the running app REQUESTS against the scopes the app's own
// configuration DECLARES.
//
// This exists because of a real, silent breakage found on 2026-11-10. `app/shopify.server.ts`
// passes `scopes: process.env.SCOPES?.split(",")` to shopifyApp() — so the authorization
// request a developer's machine sends is built from `.env`, NOT from `shopify.app.toml`. Three
// scopes had been added to the toml over time (`read_fulfillments` and `read_legal_policies` on
// 2026-09-08/09, `write_discounts` on 2026-09-10) and never carried across to `.env` or
// `.env.example`.
//
// Nothing noticed. The app installed, built, typechecked, tested and ran clean; the local
// offline session simply came back holding nine scopes instead of ten. The only symptom was a
// runtime GraphQL error from Shopify — "Access denied ... write_discounts access scope" — at
// the one moment it mattered least: the first time anyone tried to create a real discount for
// Coupons or Review Rewards. A scope list that lives in two files needs a test that reads both,
// because the divergence is invisible until an API call fails.
//
// `.env.example` is the tracked copy and is always checked, so CI catches the drift. A
// developer's own `.env` is checked too when it exists, so the machine actually performing OAuth
// fails here rather than at the Admin API.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

function readToken(file: string, pattern: RegExp): string | null {
  const path = join(REPO_ROOT, file);
  if (!existsSync(path)) return null;
  const match = readFileSync(path, "utf8").match(pattern);
  return match ? match[1] : null;
}

function parseScopes(raw: string): string[] {
  return raw
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean)
    .sort();
}

const declaredRaw = readToken("shopify.app.toml", /^scopes = "(.*)"$/m);

describe("access scopes", () => {
  it("are declared in shopify.app.toml", () => {
    expect(declaredRaw).not.toBeNull();
  });

  // Every scope requested at runtime comes from this env var, so an env file that lists fewer
  // scopes than the app declares produces a session that silently cannot do part of its job.
  for (const envFile of [".env.example", ".env"] as const) {
    it(`match ${envFile} (when present)`, () => {
      const envRaw = readToken(envFile, /^SCOPES=(.*)$/m);
      if (envRaw === null) {
        // .env is gitignored and absent in CI — nothing to compare, and nothing is wrong.
        expect(envFile).toBe(".env");
        return;
      }

      expect(parseScopes(envRaw.replace(/^["']|["']$/g, ""))).toEqual(parseScopes(declaredRaw!));
    });
  }

  // Pinned by name because each of these three is the one that was missing, and because each
  // fails only at the Admin API — never at build, install or test time.
  it.each(["write_discounts", "read_fulfillments", "read_legal_policies"])(
    "declare %s, which an Admin API call hard-requires",
    (scope) => {
      expect(parseScopes(declaredRaw!)).toContain(scope);
    },
  );
});
