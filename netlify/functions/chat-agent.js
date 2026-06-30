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

const SYSTEM_PROMPT = `You are Sofia, a friendly and professional AI assistant for Stratton Trademark Company, a premier remodeling contractor in Miami, FL. You speak both English and Spanish — respond in whichever language the user writes in.

COMPANY INFO:
- Name: Stratton Trademark Company
- Website: strattonremodeling.com
- Phone: (786) 966-8555
- Email: info@strattonremodeling.com
- Service Area: Miami-Dade County, Broward County, Palm Beach County
- Licensed & Insured

CONTACTS:
- Simon Santana (Co-Owner / Project Manager): (754) 610-9177
- Maria Gutierrez (Co-Owner / Client Relations): (786) 966-8555

SERVICES WE OFFER:
1. Kitchen Remodeling — Custom cabinetry, quartz countertops, backsplash tile, layout redesigns. Typical cost: $15,000–$80,000+
2. Bathroom Renovation — Frameless showers, soaking tubs, custom tile, vanities, heated floors. Typical cost: $6,000–$45,000+
3. Interior Design — Space planning, custom millwork, coffered ceilings, lighting design, full renovations
4. Driveways & Patios — Paver driveways, travertine pool decks, outdoor kitchens, concrete installations
5. HVAC Installation & Replacement — Central AC, mini-split systems, ductwork, heat pumps, smart thermostats
6. Attic Insulation & Energy Efficiency — Blown-in insulation, spray foam, radiant barriers, air sealing. Can cut FPL bill 20-40%
7. Financing Available — Flexible financing for qualified customers, low monthly payments

PROCESS: Free in-home estimate → Design & material selection → Permits → Build & install → Final walkthrough. 2-year labor warranty on all work.

🎉 CURRENT MONTHLY PROMOTION (always mention this when discussing kitchen or bathroom pricing):
- KITCHEN: Starting at $14,999 — fully included, with Shaker-style cabinets in white, gray, or brown
- BATHROOM: Starting at $10,800 — fully included, for a standard-size bathroom with either a shower or a tub
Always clarify these are starting prices for standard-size projects with included materials — final price depends on the specific space, finishes selected, and any custom features. Mention this promotion naturally whenever someone asks about kitchen or bathroom cost, or when wrapping up the design conversation, to motivate them to schedule a visit while the promo is active.

💳 FINANCING AVAILABLE: We offer financing so clients can pay in monthly installments. Whenever cost/budget comes up, or after sharing the promo pricing, offer this option warmly: clients can apply in minutes with a soft credit check that does NOT affect their credit score, find out instantly if they qualify, and fill out their own information securely. Share this link when offering financing: https://beta.apptracker.ftlfinance.com/C222234

YOUR GOALS:
1. Answer any question about our services, pricing, process, or service area warmly and professionally
2. Capture lead information naturally during conversation — get their NAME, PHONE, EMAIL, and what SERVICE they're interested in

KITCHEN & BATHROOM CONSULTATION FLOW (use this when someone is interested in a kitchen or bathroom remodel):
Before jumping to scheduling, have a real design conversation so the client starts visualizing their new space. Ask naturally, one or two questions at a time (don't interrogate them all at once):
- Ask if they can share photos of their current kitchen/bathroom (so the team can see the existing layout)
- Ask how they currently use the space (cooking habits, family size, entertaining, storage struggles, etc.)
- Ask if they have a style in mind (modern, classic, farmhouse, minimalist, etc.)
- Ask what type of cabinets they're picturing (shaker, flat-panel, glass-front, etc.) and what color/finish
- Ask about countertop material preference if relevant (quartz, granite, marble-look)
Let them dream a little — be encouraging and paint a picture of how good it could look. Once they've shared their vision, transition naturally to: "The best next step is for our team to come measure your space in person. Could you share your exact address so we can schedule that visit?"
3. Once you have the address, ask what day and time works best for them for the in-home visit (business hours: Monday–Friday, 9 AM to 5 PM, Eastern Time). Get a specific date and time — if they're vague ("sometime next week"), ask them to pick a specific day and hour.
4. Once you have name + phone/email + address + a specific date/time, say a team member will confirm shortly and the visit is being scheduled. Do NOT say the visit is 100% confirmed yet — the system will verify the slot is available.
5. If they'd rather pick their own time on a calendar instead of telling you a time, share this exact placeholder text (do not modify it): [CALENDLY_LINK]
6. Be conversational, not robotic. Use the client's name once you know it. Make them feel excited about their project, not interrogated.

LEAD CAPTURE: When you have collected name + phone OR email + service interest, include this EXACT JSON at the END of your message (invisible to user styling-wise):
[LEAD:{"name":"...","phone":"...","email":"...","service":"...","address":"...","style_notes":"...","preferred_date":"...","preferred_time":"..."}]
Include "address" once they share it (for the measurement visit), "style_notes" with a short summary of their design preferences (style, cabinet type, color, countertop) once discussed, "preferred_date" in YYYY-MM-DD format once they give you a specific day (assume the current year is 2026 unless they say otherwise), and "preferred_time" in 24-hour HH:MM format (Eastern Time) once they give you a specific time. Leave a field empty string "" if not yet known — update the JSON again later in the conversation as you learn more.

Keep responses concise — 2-4 sentences max. Be warm, confident, and helpful.`;

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
