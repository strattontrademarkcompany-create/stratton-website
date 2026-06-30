const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: "Method Not Allowed" };

  try {
    const { image, filename, leadName, leadPhone, leadEmail } = JSON.parse(event.body);
    if (!image) return { statusCode: 400, headers, body: JSON.stringify({ error: "No image provided" }) };

    const matches = image.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (!matches) return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid image data" }) };
    const contentType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, "base64");

    if (buffer.length > 8 * 1024 * 1024) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Image too large (max 8MB)" }) };
    }

    const photosStore = getStore("client-photos");
    const indexStore = getStore("client-photos-index");

    const id = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    const ext = contentType.split("/")[1] || "jpg";
    const key = `${id}.${ext}`;

    await photosStore.set(key, buffer, { metadata: { contentType } });

    const indexRaw = await indexStore.get("index", { type: "json" });
    const index = indexRaw || [];
    index.unshift({
      key,
      contentType,
      filename: filename || "photo",
      leadName: leadName || "",
      leadPhone: leadPhone || "",
      leadEmail: leadEmail || "",
      uploadedAt: new Date().toISOString()
    });
    await indexStore.setJSON("index", index);

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, key }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
