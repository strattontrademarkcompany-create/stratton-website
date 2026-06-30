const { getStore } = require("@netlify/blobs");

const ADMIN_PASSWORD = process.env.PHOTOS_ADMIN_PASSWORD;

exports.handler = async (event) => {
  const password = event.queryStringParameters?.password;
  const key = event.queryStringParameters?.key;

  if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
    return { statusCode: 401, body: "Unauthorized" };
  }
  if (!key) return { statusCode: 400, body: "Missing key" };

  try {
    const photosStore = getStore("client-photos");
    const blob = await photosStore.getWithMetadata(key, { type: "arrayBuffer" });
    if (!blob) return { statusCode: 404, body: "Not found" };

    return {
      statusCode: 200,
      headers: { "Content-Type": blob.metadata?.contentType || "image/jpeg", "Cache-Control": "private, max-age=3600" },
      body: Buffer.from(blob.data).toString("base64"),
      isBase64Encoded: true
    };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
};
