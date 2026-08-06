import type { ActionFunctionArgs } from "react-router";

// TEMPORARY diagnostic endpoint for the Requests-page pagination investigation.
// Logs POSTed payloads to the server console so they show up in `railway logs`.
// Remove this file once the pagination root cause is found.
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false }), { status: 405 });
  }

  try {
    const payload = await request.json();
    console.log("[PAGDEBUG]", JSON.stringify(payload));
  } catch {
    console.log("[PAGDEBUG] invalid JSON body");
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
