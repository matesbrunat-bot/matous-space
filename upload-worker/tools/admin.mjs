const [command = "list", photoId = ""] = process.argv.slice(2);
const apiBase = String(process.env.UPLOAD_API_URL || "").replace(/\/+$/, "");
const token = String(process.env.ADMIN_TOKEN || "");

if (!apiBase || !token) {
  throw new Error("Set UPLOAD_API_URL and ADMIN_TOKEN before running the review tool.");
}

let method = "GET";
let path = "/v1/admin/photos?status=pending";
if (command === "approve") {
  if (!photoId) throw new Error("Usage: npm run review -- approve <photo-id>");
  method = "POST";
  path = `/v1/admin/photos/${encodeURIComponent(photoId)}/approve`;
} else if (command === "delete") {
  if (!photoId) throw new Error("Usage: npm run review -- delete <photo-id>");
  method = "DELETE";
  path = `/v1/admin/photos/${encodeURIComponent(photoId)}`;
} else if (command !== "list") {
  throw new Error("Supported commands: list, approve, delete");
}

const response = await fetch(`${apiBase}${path}`, {
  method,
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
});
const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
