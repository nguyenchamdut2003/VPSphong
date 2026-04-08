const crypto = require('crypto');

const ALGO = 'aes-256-cbc';

// Chuỗi bí mật dễ nhớ của bạn – NHỚ giữ kín
const SECRET = process.env.AES;  

// Tạo KEY 32 byte từ chuỗi SECRET
const KEY = crypto.createHash("sha256").update(SECRET).digest();

// Hàm mã hóa AES
function encryptAES(text) {
  const iv = crypto.randomBytes(16); // 16 byte
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);

  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final()
  ]);

  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

// Hàm giải mã AES (nếu cần)
function decryptAES(data) {
  const [ivHex, encryptedHex] = data.split(':');

  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
}

module.exports = { encryptAES, decryptAES };
