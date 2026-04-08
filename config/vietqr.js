/**
 * Cấu hình VietQR (theo cách dùng trong webbayacc — ảnh QR từ img.vietqr.io).
 * Đặt trong .env: VIETQR_BANK_CODE, VIETQR_ACCOUNT_NO, VIETQR_ACCOUNT_NAME
 * Tuỳ chọn: VIETQR_BANK_LABEL, VIETQR_ADDINFO_PREFIX (mặc định SEVQR — nội dung CK: SEVQR + username)
 */
require("dotenv").config();

function getVietQrConfigForUser(username) {
  const bankCode = (process.env.VIETQR_BANK_CODE || "").trim();
  const accountNo = (process.env.VIETQR_ACCOUNT_NO || "").trim();
  const accountName = (process.env.VIETQR_ACCOUNT_NAME || "").trim();
  const bankLabel = (process.env.VIETQR_BANK_LABEL || "Ngân hàng").trim();
  const prefix = (process.env.VIETQR_ADDINFO_PREFIX || "SEVQR").trim();
  const uname = (username || "").trim();
  const addInfo = uname ? `${prefix} ${uname}` : "";

  const enabled = Boolean(bankCode && accountNo && accountName && addInfo);

  let imageUrl = "";
  if (enabled) {
    imageUrl =
      "https://img.vietqr.io/image/" +
      bankCode +
      "-" +
      accountNo +
      "-compact.png" +
      "?accountName=" +
      encodeURIComponent(accountName) +
      "&addInfo=" +
      encodeURIComponent(addInfo);
  }

  return {
    enabled,
    bankCode,
    bankLabel,
    accountNo,
    accountName,
    addInfo,
    prefix,
    imageUrl,
  };
}

module.exports = { getVietQrConfigForUser };
