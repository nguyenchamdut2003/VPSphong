const {
  tb_userModel,
  tb_user_vpsModel,
  tb_transactionModel,
  tb_vps_logModel,
  tb_upthueModel,
} = require("../models/vpsphong");

const CUSTOMER_IDS_TTL_MS = 60_000;
const LOG_LOOKBACK_HOURS = 48;

let customerIdsCache = null;
let customerIdsCacheAt = 0;

async function getCustomerIds() {
  const now = Date.now();
  if (customerIdsCache && now - customerIdsCacheAt < CUSTOMER_IDS_TTL_MS) {
    return customerIdsCache;
  }
  customerIdsCache = await tb_userModel.find({ role: "customer" }).distinct("_id");
  customerIdsCacheAt = now;
  return customerIdsCache;
}

/** Số thông báo đỏ trên menu admin (thao tác / yêu cầu từ khách). */
async function getAdminBadgeCounts(adminUser) {
  const [fixRequests, withdrawRequests, upthuePending, customerIds] = await Promise.all([
    tb_user_vpsModel.countDocuments({
      powerActionStatus: "pending",
      pendingPowerAction: { $ne: "none" },
    }),
    tb_transactionModel.countDocuments({ type: "withdraw", status: "pending" }),
    tb_upthueModel.countDocuments({ status: "Đang chờ" }),
    getCustomerIds(),
  ]);

  let customerLogs = 0;
  if (customerIds.length) {
    const seenAt = adminUser?.adminPanelSeenLogsAt;
    const since = seenAt
      ? new Date(seenAt)
      : new Date(Date.now() - LOG_LOOKBACK_HOURS * 60 * 60 * 1000);
    customerLogs = await tb_vps_logModel.countDocuments({
      userId: { $in: customerIds },
      category: { $in: ["billing", "control"] },
      createdAt: { $gt: since },
    });
  }

  return {
    fixRequests,
    withdrawRequests,
    upthue: upthuePending,
    logs: customerLogs,
  };
}

async function markAdminLogsSeen(adminId) {
  const now = new Date();
  await tb_userModel.findByIdAndUpdate(adminId, { adminPanelSeenLogsAt: now });
  return now;
}

module.exports = { getAdminBadgeCounts, markAdminLogsSeen };
