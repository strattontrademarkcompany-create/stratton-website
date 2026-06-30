const { getStore } = require("@netlify/blobs");

const ADMIN_PASSWORD = process.env.PHOTOS_ADMIN_PASSWORD;

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-password",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };

  const password = event.headers["x-admin-password"] || event.queryStringParameters?.password;
  if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  try {
    const indexStore = getStore("client-photos-index");
    const index = (await indexStore.get("index", { type: "json" })) || [];
    return { statusCode: 200, headers, body: JSON.stringify({ photos: index }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
