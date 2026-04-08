const crypto = require("crypto");

/** Khóa 32 byte: VPS_AES_KEY trong .env (chuỗi 32 ký tự, hoặc 64 ký tự hex) */
function getKey() {
  const raw = process.env.VPS_AES_KEY;
  if (raw && raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  if (raw && raw.length >= 32) {
    return Buffer.from(raw.slice(0, 32), "utf8");
  }
  return Buffer.from("vpsphong-dev-key-change-in-env!!".slice(0, 32), "utf8");
}

function encrypt(plainText) {
  if (plainText == null || String(plainText) === "") return "";
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(String(plainText), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decrypt(payloadB64) {
  if (!payloadB64 || typeof payloadB64 !== "string") return "";
  try {
    const raw = Buffer.from(payloadB64, "base64");
    if (raw.length < 28) return "";
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const key = getKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

module.exports = { encrypt, decrypt };
