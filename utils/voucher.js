const { tb_voucherModel } = require("../models/vpsphong");

function normalizeCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

/**
 * Tìm voucher đang hiệu lực (chưa hết hạn, còn lượt). Không kiểm tra minOrder — dùng trong calculate.
 */
async function findEligibleVoucher(rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) return null;
  const v = await tb_voucherModel.findOne({ code, isActive: true }).lean();
  if (!v) return null;
  if (v.expiresAt && new Date(v.expiresAt) < new Date()) return null;
  if (v.maxUses != null && v.usedCount >= v.maxUses) return null;
  return v;
}

/**
 * @returns {{ ok: true, finalPrice, discountAmount, voucher } | { ok: false, error: string }}
 */
function calculateVoucherDiscount(voucher, originalPrice) {
  const original = Number(originalPrice) || 0;
  const minOrder = Number(voucher.minOrderAmount) || 0;
  if (original < minOrder) {
    return { ok: false, error: `Đơn tối thiểu ${minOrder.toLocaleString()}đ mới áp dụng được mã này.` };
  }
  let discount = 0;
  if (voucher.discountType === "percent") {
    const p = Math.min(100, Math.max(0, Number(voucher.discountValue) || 0));
    discount = Math.floor((original * p) / 100);
  } else {
    discount = Math.min(original, Math.max(0, Math.floor(Number(voucher.discountValue) || 0)));
  }
  const finalPrice = Math.max(0, original - discount);
  return { ok: true, finalPrice, discountAmount: discount, voucher };
}

/**
 * Giữ chỗ lượt dùng voucher (atomic). Gọi trước khi trừ tiền; nếu sau đó mua lỗi cần rollback bằng releaseVoucherUse.
 */
async function reserveVoucherUse(voucherId) {
  const v = await tb_voucherModel.findById(voucherId).lean();
  if (!v || !v.isActive) return { ok: false };
  const filter = {
    _id: voucherId,
    isActive: true,
    $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }],
  };
  if (v.maxUses != null) filter.usedCount = { $lt: v.maxUses };
  const updated = await tb_voucherModel.findOneAndUpdate(filter, { $inc: { usedCount: 1 } }, { new: true });
  return { ok: !!updated };
}

async function releaseVoucherUse(voucherId) {
  await tb_voucherModel.updateOne({ _id: voucherId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
}

module.exports = {
  normalizeCode,
  findEligibleVoucher,
  calculateVoucherDiscount,
  reserveVoucherUse,
  releaseVoucherUse,
};
