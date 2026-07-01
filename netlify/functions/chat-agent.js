const crypto = require("crypto");

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
const CALENDLY_TOKEN = process.env.CALENDLY_TOKEN;
const CALENDLY_EVENT_TYPE = "https://api.calendly.com/event_types/144a3725-0f05-40f5-bc4c-5a6aa3230de5";
const CALENDLY_FALLBACK_URL = "https://calendly.com/strattontrademarkcompany/free-home-estimate-stratton-remodeling";

const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || "primary";
const VISIT_DURATION_MINUTES = 60;

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getGoogleAccessToken() {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: GOOGLE_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };
  const unsigned = base64url(JSON.stringify(header)) + "." + base64url(JSON.stringify(claim));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(GOOGLE_PRIVATE_KEY).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const jwt = unsigned + "." + signature;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + jwt
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Google auth failed: " + JSON.stringify(data));
  return data.access_token;
}

async function isSlotBusy(accessToken, startISO, endISO) {
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin: startISO, timeMax: endISO, timeZone: "America/New_York", items: [{ id: GOOGLE_CALENDAR_ID }] })
  });
  const data = await res.json();
  const busy = data.calendars && data.calendars[GOOGLE_CALENDAR_ID] && data.calendars[GOOGLE_CALENDAR_ID].busy;
  return !!(busy && busy.length > 0);
}

async function createCalendarEvent(accessToken, { summary, description, date, time, attendeeEmail }) {
  const startDateTime = `${date}T${time}:00`;
  const [h, m] = time.split(":").map(Number);
  const endH = String(Math.floor((h * 60 + m + VISIT_DURATION_MINUTES) / 60)).padStart(2, "0");
  const endM = String((h * 60 + m + VISIT_DURATION_MINUTES) % 60).padStart(2, "0");
  const endDateTime = `${date}T${endH}:${endM}:00`;

  const startISO = `${startDateTime}-04:00`;
  const endISO = `${endDateTime}-04:00`;

  const busy = await isSlotBusy(accessToken, startISO, endISO);
  if (busy) return { booked: false };

  const attendees = [{ email: GOOGLE_CALENDAR_ID }];
  if (attendeeEmail) attendees.push({ email: attendeeEmail });

  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events?sendUpdates=all`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary,
      description,
      start: { dateTime: startDateTime, timeZone: "America/New_York" },
      end: { dateTime: endDateTime, timeZone: "America/New_York" },
      attendees
    })
  });
  const data = await res.json();
  if (!data.id) throw new Error("Google event creation failed: " + JSON.stringify(data));
  return { booked: true, htmlLink: data.htmlLink };
}

const SYSTEM_PROMPT = `You are Sofia, a friendly AI assistant for Stratton Trademark Company — a premier remodeling contractor in Miami, FL. You speak both English and Spanish — always respond in whichever language the user writes in.

COMPANY INFO:
- Phone: (786) 966-8555 | Email: info@strattonremodeling.com
- Service Area: Miami-Dade County, Broward County, Palm Beach County ONLY
- Licensed & Insured | 2-year labor warranty

CONTACTS:
- Simon Santana (Co-Owner / Project Manager): (754) 610-9177
- Maria Gutierrez (Co-Owner / Client Relations): (786) 966-8555

SERVICES:
1. Kitchen Remodeling — cabinets, quartz countertops, backsplash, layout. $15,000–$80,000+
2. Bathroom Renovation — frameless showers, tubs, custom tile, vanities. $6,000–$45,000+
3. Interior Design — millwork, coffered ceilings, lighting, full renovations
4. Driveways & Patios — pavers, travertine, outdoor kitchens, concrete
5. HVAC — central AC, mini-splits, ductwork, smart thermostats
6. Attic Insulation — blown-in, spray foam, radiant barriers. Cuts FPL bill 20–40%
7. Other / General Question

PROMOTIONS:
- Kitchen: starting at $14,999 (Shaker cabinets white/gray/brown, fully included)
- Bathroom: starting at $10,800 (standard size, shower or tub, fully included)
Mention promos when kitchen/bathroom cost comes up. Always clarify these are starting prices.

FINANCING: Soft credit check, no impact on score, instant approval. Link: https://beta.apptracker.ftlfinance.com/C222234

---
STRICT CONVERSATION FLOW — follow this order every time:

STEP 1 — WELCOME (first message only):
Greet warmly in 1 sentence, then ask what project they're interested in and output EXACTLY this tag on its own line:
[SERVICES_MENU]
Do not list the services as text — the tag renders the menu automatically.

STEP 2 — CITY CHECK (after service is selected):
Ask: what city are they writing from?
- If city is in Miami-Dade, Broward, or Palm Beach → proceed to Step 3.
- If city is OUTSIDE the service area → apologize briefly, say we only serve South Florida (Miami-Dade, Broward, Palm Beach), and end politely. Do NOT continue gathering info.

STEP 3 — PHOTOS & IDEAS:
Ask the client to share photos of the current space (using the 📎 button) and describe their vision/ideas. One message, one ask.

STEP 4 — LEAD DETAILS:
Once they've shared ideas, ask for their name and phone number to connect them with the team.

STEP 5 — SCHEDULE:
Once you have name + phone + service + address vicinity → ask what day and time works for a free in-home estimate (Mon–Fri, 9am–5pm ET). Get a specific date and time.
- If slot is available: confirm it's being scheduled, team will confirm shortly. Do NOT say 100% confirmed.
- If they prefer to pick their own time: use exactly [CALENDLY_LINK]

LEAD CAPTURE: Once you have name + phone/email + service, append at end of message:
[LEAD:{"name":"","phone":"","email":"","service":"","address":"","style_notes":"","preferred_date":"","preferred_time":""}]
Fill all known fields. preferred_date = YYYY-MM-DD, preferred_time = HH:MM (24h ET). Update in every subsequent message.

---
RESPONSE STYLE — CRITICAL:
- Max 2 sentences per message. No exceptions.
- One question per message only.
- No filler: no "¡Excelente!", "Por supuesto", "Claro que sí", "Me alegra", "Es una inversión hermosa", "Perfecto".
- Never repeat what was already said.
- Direct and warm. Nothing more.`;

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: "Method Not Allowed" };

  try {
    const { messages } = JSON.parse(event.body);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: messages
      })
    });

    const data = await response.json();
    console.log("Anthropic response status:", response.status);
    console.log("Anthropic data:", JSON.stringify(data));
    if (data.error) {
      console.error("Anthropic API error:", data.error);
      return { statusCode: 200, headers, body: JSON.stringify({ reply: "ERROR: " + data.error.type + " — " + data.error.message }) };
    }
    const replyText = data.content?.[0]?.text || "I'm sorry, I couldn't process that. Please call us at (786) 966-8555.";

    // Extract lead data if present
    const leadMatch = replyText.match(/\[LEAD:(\{.*?\})\]/s);
    let leadSaved = false;

    let lead = null;
    if (leadMatch) {
      try { lead = JSON.parse(leadMatch[1]); } catch (e) { console.error("Lead parse error:", e); }
    }

    if (lead && HUBSPOT_TOKEN) {
      try {
        const nameParts = (lead.name || "").split(" ");
        await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
          method: "POST",
          headers: { "Authorization": `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            properties: {
              firstname: nameParts[0] || "",
              lastname: nameParts.slice(1).join(" ") || "",
              email: lead.email || "",
              phone: lead.phone || "",
              address: lead.address || "",
              hs_lead_status: "NEW",
              lifecyclestage: "lead",
              lead_source: "Website Chat Agent",
              service_interest: lead.service || "",
              message: lead.style_notes || ""
            }
          })
        });
        leadSaved = true;
      } catch(e) { console.error("HubSpot error:", e); }
    }

    // Clean reply — remove the LEAD tag before sending to user
    let cleanReply = replyText.replace(/\[LEAD:\{.*?\}\]/s, "").trim();

    // If we have a specific date/time, try to book it directly on Google Calendar
    let bookingOutcome = null;
    if (lead && lead.preferred_date && lead.preferred_time && GOOGLE_CLIENT_EMAIL && GOOGLE_PRIVATE_KEY) {
      try {
        const accessToken = await getGoogleAccessToken();
        const result = await createCalendarEvent(accessToken, {
          summary: `Free Home Estimate — ${lead.name || "Stratton Lead"}`,
          description: `Service: ${lead.service || "N/A"}\nAddress: ${lead.address || "N/A"}\nPhone: ${lead.phone || "N/A"}\nNotes: ${lead.style_notes || "N/A"}`,
          date: lead.preferred_date,
          time: lead.preferred_time,
          attendeeEmail: lead.email || null
        });
        bookingOutcome = result.booked ? "booked" : "busy";
      } catch (e) {
        console.error("Google Calendar error:", e);
      }
    }

    if (bookingOutcome === "booked") {
      cleanReply += (cleanReply.endsWith(".") || cleanReply.endsWith("!") ? " " : ". ") +
        (/[áéíóúñ¿¡]/i.test(cleanReply) || /\b(el|la|los|las|de|que|para)\b/i.test(cleanReply)
          ? `✅ ¡Listo! Tu visita quedó agendada para el ${lead.preferred_date} a las ${lead.preferred_time}. Recibirás una invitación de Google Calendar.`
          : `✅ You're all set! Your visit is confirmed for ${lead.preferred_date} at ${lead.preferred_time}. You'll receive a Google Calendar invite shortly.`);
    } else if (bookingOutcome === "busy") {
      let calendlyUrl = CALENDLY_FALLBACK_URL;
      if (CALENDLY_TOKEN) {
        try {
          const linkRes = await fetch("https://api.calendly.com/scheduling_links", {
            method: "POST",
            headers: { "Authorization": `Bearer ${CALENDLY_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ max_event_count: 1, owner: CALENDLY_EVENT_TYPE, owner_type: "EventType" })
          });
          const linkData = await linkRes.json();
          if (linkData.resource && linkData.resource.booking_url) calendlyUrl = linkData.resource.booking_url;
        } catch (e) { console.error("Calendly fallback error:", e); }
      }
      cleanReply += (/[áéíóúñ¿¡]/i.test(cleanReply) ? ` Ese horario ya está ocupado — por favor elige otro disponible aquí: ${calendlyUrl}` : ` That time slot is already booked — please pick another available time here: ${calendlyUrl}`);
    }

    // Replace the Calendly placeholder with a real single-use scheduling link
    if (cleanReply.indexOf("[CALENDLY_LINK]") !== -1) {
      let calendlyUrl = CALENDLY_FALLBACK_URL;
      if (CALENDLY_TOKEN) {
        try {
          const linkRes = await fetch("https://api.calendly.com/scheduling_links", {
            method: "POST",
            headers: { "Authorization": `Bearer ${CALENDLY_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ max_event_count: 1, owner: CALENDLY_EVENT_TYPE, owner_type: "EventType" })
          });
          const linkData = await linkRes.json();
          if (linkData.resource && linkData.resource.booking_url) {
            calendlyUrl = linkData.resource.booking_url;
          }
        } catch (e) { console.error("Calendly error:", e); }
      }
      cleanReply = cleanReply.split("[CALENDLY_LINK]").join(calendlyUrl);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply: cleanReply, leadSaved })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ reply: "Sorry, I'm having trouble right now. Please call us at (786) 966-8555.", error: err.message })
    };
  }
};
