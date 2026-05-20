const crypto = require("crypto");

const ALGO = "aes-256-cbc";
const SECRET = process.env.AES_SECRET || process.env.AES || "";

function getKey() {
  if (!SECRET) return null;
  return crypto.createHash("sha256").update(SECRET).digest();
}

function encryptAES(text) {
  const key = getKey();
  if (!key) throw new Error("AES_SECRET chưa cấu hình trong .env");
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptAES(data) {
  const key = getKey();
  if (!key || !data) return "";
  const [ivHex, encryptedHex] = String(data).split(":");
  if (!ivHex || !encryptedHex) return "";
  const iv = Buffer.from(ivHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

module.exports = { encryptAES, decryptAES };
