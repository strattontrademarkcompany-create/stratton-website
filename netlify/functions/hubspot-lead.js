const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const data = JSON.parse(event.body);
    const { firstName, lastName, email, phone, service, budget, message, source } = data;

    // 1. Create or update contact in HubSpot
    const contactRes = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        properties: {
          firstname: firstName || "",
          lastname: lastName || "",
          email: email || "",
          phone: phone || "",
          hs_lead_status: "NEW",
          lead_source: source || "Website",
          lifecyclestage: "lead",
          notes_last_updated: new Date().toISOString(),
          service_interest: service || "",
          estimated_budget: budget || ""
        }
      })
    });

    const contact = await contactRes.json();

    // Handle duplicate contact
    let contactId = contact.id;
    if (!contactId && contact.message && contact.message.includes("existing")) {
      const searchRes = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/search`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${HUBSPOT_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }] })
      });
      const searchData = await searchRes.json();
      contactId = searchData.results?.[0]?.id;
    }

    // 2. Create a Deal linked to the contact
    if (contactId) {
      const dealRes = await fetch("https://api.hubapi.com/crm/v3/objects/deals", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${HUBSPOT_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          properties: {
            dealname: `${firstName} ${lastName} — ${service || "General Inquiry"}`,
            dealstage: "appointmentscheduled",
            pipeline: "default",
            amount: budget ? budget.replace(/[^0-9]/g, "") : "",
            description: message || "",
            lead_source: source || "Website"
          },
          associations: [{ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }] }]
        })
      });
    }

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ success: true, contactId })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};
