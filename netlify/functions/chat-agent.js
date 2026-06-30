const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;

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

YOUR GOALS:
1. Answer any question about our services, pricing, process, or service area warmly and professionally
2. Capture lead information naturally during conversation — get their NAME, PHONE, EMAIL, and what SERVICE they're interested in
3. Once you have their info, tell them a team member will contact them within 24 hours
4. Offer to schedule a free in-home estimate — share this link: https://calendly.com/strattontrademarkcompany
5. Be conversational, not robotic. Use the client's name once you know it.

LEAD CAPTURE: When you have collected name + phone OR email + service interest, include this EXACT JSON at the END of your message (invisible to user styling-wise):
[LEAD:{"name":"...","phone":"...","email":"...","service":"..."}]

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
        model: "claude-3-5-sonnet-20241022",
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
      return { statusCode: 200, headers, body: JSON.stringify({ reply: "Lo siento, estoy teniendo problemas técnicos. Por favor llama al (786) 966-8555 o escribe a info@strattonremodeling.com" }) };
    }
    const replyText = data.content?.[0]?.text || "I'm sorry, I couldn't process that. Please call us at (786) 966-8555.";

    // Extract lead data if present
    const leadMatch = replyText.match(/\[LEAD:(\{.*?\})\]/s);
    let leadSaved = false;

    if (leadMatch && HUBSPOT_TOKEN) {
      try {
        const lead = JSON.parse(leadMatch[1]);
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
              hs_lead_status: "NEW",
              lifecyclestage: "lead",
              lead_source: "Website Chat Agent",
              service_interest: lead.service || ""
            }
          })
        });
        leadSaved = true;
      } catch(e) { console.error("HubSpot error:", e); }
    }

    // Clean reply — remove the LEAD tag before sending to user
    const cleanReply = replyText.replace(/\[LEAD:\{.*?\}\]/s, "").trim();

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
