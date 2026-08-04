import crypto from "node:crypto";

export function isAuthorized(request) {
  const expected = process.env.APP_PIN || "";
  const received = request.headers["x-app-pin"] || "";
  if (!expected || !received) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(received));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function json(response, status, body) {
  response.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}
