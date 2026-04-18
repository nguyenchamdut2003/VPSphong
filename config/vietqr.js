/**
 * Cấu hình VietQR (theo cách dùng trong webbayacc — ảnh QR từ img.vietqr.io).
 * Đặt trong .env: VIETQR_BANK_CODE, VIETQR_ACCOUNT_NO, VIETQR_ACCOUNT_NAME
 * Tuỳ chọn: VIETQR_BANK_LABEL, VIETQR_ADDINFO_PREFIX (mặc định SEVQR — nội dung CK: SEVQR + username)
 *
 * Mặc định (khi không set .env): VietinBank — mã VietQR là ICB (api.vietqr.io).
 */
require("dotenv").config();

const DEFAULT_VIETQR = {
  bankCode: "ICB",
  accountNo: "100879996462",
  accountName: "DO VAN PHONG",
  bankLabel: "Ngân hàng VietinBank",
};

function getVietQrConfigForUser(username) {
  const bankCode = (process.env.VIETQR_BANK_CODE || DEFAULT_VIETQR.bankCode).trim();
  const accountNo = (process.env.VIETQR_ACCOUNT_NO || DEFAULT_VIETQR.accountNo).trim();
  const accountName = (process.env.VIETQR_ACCOUNT_NAME || DEFAULT_VIETQR.accountName).trim();
  const bankLabel = (process.env.VIETQR_BANK_LABEL || DEFAULT_VIETQR.bankLabel).trim();
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
