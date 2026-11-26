const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Content-Type": "application/json",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function escapeHtml(value: string) {
  const escapedCharacters: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => escapedCharacters[character]);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL");
  const appUrl = Deno.env.get("APP_URL");
  if (!supabaseUrl || !serviceRoleKey || !resendApiKey || !fromEmail || !appUrl) {
    return jsonResponse({ error: "The notification service is missing configuration." }, 500);
  }
  if (request.headers.get("Authorization") !== `Bearer ${serviceRoleKey}`) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  try {
    const apiHeaders = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    };
    const claimResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/claim_due_scheduled_letters`, {
      method: "POST",
      headers: apiHeaders,
      body: "{}",
    });
    if (!claimResponse.ok) {
      console.error("Could not claim due letters. Status:", claimResponse.status);
      return jsonResponse({ error: "Could not load due letters." }, 502);
    }

    const dueLetters = await claimResponse.json();
    let sent = 0;
    let failed = 0;
    const destination = escapeHtml(new URL(appUrl).toString());

    for (const letter of dueLetters) {
      try {
        const userResponse = await fetch(
          `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(letter.recipient_id)}`,
          { headers: apiHeaders },
        );
        if (!userResponse.ok) {
          console.error("Could not resolve a letter recipient. Status:", userResponse.status);
          failed += 1;
          continue;
        }
        const user = await userResponse.json();
        if (!user.email) {
          console.error("A letter recipient account has no email address.");
          failed += 1;
          continue;
        }

        const emailResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromEmail,
            to: [user.email],
            subject: "A future letter is ready for you",
            html: `<p>Someone’s letter for you has arrived.</p><p><a href="${destination}">Sign in to read your letter</a></p>`,
            text: `Someone's letter for you has arrived. Sign in to read it: ${appUrl}`,
          }),
        });
        if (!emailResponse.ok) {
          console.error("The email provider rejected a letter notice. Status:", emailResponse.status);
          failed += 1;
          continue;
        }

        const updateResponse = await fetch(
          `${supabaseUrl}/rest/v1/scheduled_letters?id=eq.${encodeURIComponent(letter.letter_id)}&notification_sent_at=is.null`,
          {
            method: "PATCH",
            headers: { ...apiHeaders, Prefer: "return=minimal" },
            body: JSON.stringify({
              notification_sent_at: new Date().toISOString(),
              notification_claimed_at: null,
            }),
          },
        );
        if (!updateResponse.ok) {
          console.error("Could not mark a letter notice as sent. Status:", updateResponse.status);
          failed += 1;
          continue;
        }
        sent += 1;
      } catch (error) {
        console.error("Could not send an unlock notice:", error);
        failed += 1;
      }
    }

    return jsonResponse({ sent, failed });
  } catch (error) {
    console.error("The unlock notification task failed:", error);
    return jsonResponse({ error: "The notification task failed." }, 500);
  }
});
