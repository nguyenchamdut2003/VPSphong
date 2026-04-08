const { tb_user_vpsModel } = require("../models/vpsphong");

/** VPS còn ≤5 ngày và chưa hết hạn — thông báo gia hạn */
async function getVpsExpiryNotifications(userId) {
  const now = new Date();
  const limit = new Date(now);
  limit.setDate(limit.getDate() + 5);

  const rows = await tb_user_vpsModel
    .find({
      userId,
      status: { $in: ["running", "stopped"] },
      expireDate: { $gt: now, $lte: limit },
    })
    .populate({ path: "vpsId", select: "saleCode name" })
    .lean();

  return rows.map((uv) => {
    const exp = new Date(uv.expireDate);
    const daysLeft = Math.max(1, Math.ceil((exp.getTime() - now.getTime()) / 86400000));
    let code = "";
    if (uv.vpsId) {
      const v = uv.vpsId;
      code =
        typeof v.saleCode === "number" && v.saleCode > 0
          ? `#vpsphong${v.saleCode}`
          : `#vpsphong${String(v._id).slice(-6)}`;
    }
    return {
      userVpsId: uv._id,
      ip: uv.ip || "",
      daysLeft,
      expireDate: uv.expireDate,
      code,
    };
  });
}

module.exports = { getVpsExpiryNotifications };
