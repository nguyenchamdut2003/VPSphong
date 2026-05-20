const mongoose = require("mongoose");
const {
  tb_upthue_time_packageModel,
  tb_upthue_serverModel,
  tb_upthue_optionModel,
} = require("../models/vpsphong");
const {
  LEGACY_TIME_PACKAGES,
  LEGACY_EXTRA_BY_DAYS,
  LEGACY_SERVERS,
  LEGACY_OPTIONS,
  REMOVED_OPTION_CODES,
  UPTHUE_TYPE_LABELS,
} = require("./upthueLegacyDefaults");

const UPTHUE_STATUSES = ["Đang chờ", "Đang làm", "Hoàn thành", "Hủy"];

function normalizeOptionIds(raw) {
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const ids = [...new Set(arr.map((x) => String(x || "").trim()).filter(Boolean))];
  return ids;
}

function getGoiUpLabelFromOrder(order) {
  if (order.optionsSnapshot && order.optionsSnapshot.length) {
    return order.optionsSnapshot.map((o) => o.name || o.code).filter(Boolean).join(", ");
  }
  if (!order.goiup) return "";
  return String(order.goiup)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
}

function getServerDisplay(order) {
  if (order.serverSnapshot && order.serverSnapshot.name) {
    return order.serverSnapshot.name;
  }
  return order.maychu || "—";
}

function getTimePackageDisplay(order) {
  if (order.timePackageSnapshot && order.timePackageSnapshot.name) {
    return `${order.timePackageSnapshot.name} (${order.timePackageSnapshot.days} ngày)`;
  }
  return "—";
}

async function deactivateRemovedLegacyOptions() {
  if (!REMOVED_OPTION_CODES.length) return;
  await tb_upthue_optionModel.updateMany(
    { code: { $in: REMOVED_OPTION_CODES } },
    { $set: { isActive: false } },
  );
}

async function ensureUpthueConfigSeeded() {
  await deactivateRemovedLegacyOptions();
  const n = await tb_upthue_time_packageModel.countDocuments();
  if (n > 0) return;

  const timeDocs = await tb_upthue_time_packageModel.insertMany(
    LEGACY_TIME_PACKAGES.map((t) => ({
      name: t.name,
      days: t.days,
      price: t.price,
      isActive: true,
    })),
  );

  await tb_upthue_serverModel.insertMany(
    LEGACY_SERVERS.map((s) => ({
      name: s.name,
      value: s.value,
      isActive: true,
    })),
  );

  const extraByTpId = {};
  for (const tp of timeDocs) {
    extraByTpId[tp.days] = tp._id;
  }

  const optionPayload = LEGACY_OPTIONS.map((o) => {
    const extraPrices =
      o.type === "paid"
        ? timeDocs.map((tp) => ({
            timePackageId: tp._id,
            price: LEGACY_EXTRA_BY_DAYS[tp.days] ?? 0,
          }))
        : [];
    return {
      name: o.name,
      code: o.code,
      type: o.type,
      extraPrices,
      isActive: true,
    };
  });

  await tb_upthue_optionModel.insertMany(optionPayload);
}

async function loadActiveUpthueCatalog() {
  await ensureUpthueConfigSeeded();
  const [timePackages, servers, options] = await Promise.all([
    tb_upthue_time_packageModel.find({ isActive: true }).sort({ createdAt: 1 }).lean(),
    tb_upthue_serverModel.find({ isActive: true }).sort({ createdAt: 1 }).lean(),
    tb_upthue_optionModel.find({ isActive: true }).sort({ createdAt: 1 }).lean(),
  ]);

  const optionsForView = options
    .filter((o) => !REMOVED_OPTION_CODES.includes(o.code))
    .map((o) => ({
      ...o,
      extraPriceMap: Object.fromEntries(
        (o.extraPrices || []).map((ep) => [String(ep.timePackageId), ep.price]),
      ),
    }));

  return { timePackages, servers, options: optionsForView };
}

async function loadAllUpthueConfigForAdmin() {
  await ensureUpthueConfigSeeded();
  const [timePackages, servers, optionsRaw] = await Promise.all([
    tb_upthue_time_packageModel.find().sort({ createdAt: 1 }).lean(),
    tb_upthue_serverModel.find().sort({ createdAt: 1 }).lean(),
    tb_upthue_optionModel.find().sort({ createdAt: 1 }).lean(),
  ]);
  const options = optionsRaw.filter((o) => !REMOVED_OPTION_CODES.includes(o.code));
  return { timePackages, servers, options };
}

/**
 * Báo giá đơn từ DB — chỉ nhận ObjectId, không tin client về giá/tên.
 */
async function quoteUpthueOrder({ timePackageId, serverId, optionIds }) {
  await ensureUpthueConfigSeeded();

  if (!mongoose.Types.ObjectId.isValid(timePackageId)) {
    return { ok: false, error: "Gói thời gian thuê không hợp lệ." };
  }
  if (!mongoose.Types.ObjectId.isValid(serverId)) {
    return { ok: false, error: "Máy chủ không hợp lệ." };
  }

  const ids = normalizeOptionIds(optionIds);
  if (!ids.length) {
    return { ok: false, error: "Vui lòng chọn ít nhất 1 gói up." };
  }
  for (const id of ids) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return { ok: false, error: "Gói up không hợp lệ." };
    }
  }

  const [tp, server, options] = await Promise.all([
    tb_upthue_time_packageModel.findOne({ _id: timePackageId, isActive: true }).lean(),
    tb_upthue_serverModel.findOne({ _id: serverId, isActive: true }).lean(),
    tb_upthue_optionModel.find({ _id: { $in: ids }, isActive: true }).lean(),
  ]);

  if (!tp) return { ok: false, error: "Gói thời gian thuê không hợp lệ hoặc đã tắt." };
  if (!server) return { ok: false, error: "Máy chủ không hợp lệ hoặc đã tắt." };
  if (options.length !== ids.length) {
    return { ok: false, error: "Có gói up không hợp lệ hoặc đã tắt." };
  }

  const optById = new Map(options.map((o) => [String(o._id), o]));
  const sortedOptions = ids.map((id) => optById.get(id)).filter(Boolean);

  let extraTotal = 0;
  const optionsSnapshot = [];

  for (const opt of sortedOptions) {
    let extraPrice = 0;
    if (opt.type === "paid") {
      const row = (opt.extraPrices || []).find(
        (ep) => String(ep.timePackageId) === String(tp._id),
      );
      if (!row || row.price == null) {
        return {
          ok: false,
          error: `Gói "${opt.name}" chưa cấu hình phụ thu cho "${tp.name}". Vui lòng liên hệ admin.`,
        };
      }
      extraPrice = Number(row.price);
      if (extraPrice < 0) {
        return { ok: false, error: `Phụ thu gói "${opt.name}" không hợp lệ.` };
      }
      extraTotal += extraPrice;
    }
    optionsSnapshot.push({
      name: opt.name,
      code: opt.code,
      type: opt.type,
      extraPrice,
    });
  }

  const gia = Number(tp.price) + extraTotal;
  const goiup = optionsSnapshot.map((o) => o.code).join(",");

  return {
    ok: true,
    gia,
    days: tp.days,
    goiup,
    timePackageId: tp._id,
    timePackageSnapshot: { name: tp.name, days: tp.days, price: tp.price },
    serverId: server._id,
    serverSnapshot: { name: server.name, value: server.value },
    optionIds: sortedOptions.map((o) => o._id),
    optionsSnapshot,
    goiupLabel: optionsSnapshot.map((o) => o.name).join(", "),
  };
}

function getUpthueTypeLabel(type) {
  return UPTHUE_TYPE_LABELS[type] || type;
}

module.exports = {
  UPTHUE_STATUSES,
  UPTHUE_TYPE_LABELS,
  getUpthueTypeLabel,
  ensureUpthueConfigSeeded,
  loadActiveUpthueCatalog,
  loadAllUpthueConfigForAdmin,
  quoteUpthueOrder,
  getGoiUpLabelFromOrder,
  getServerDisplay,
  getTimePackageDisplay,
  normalizeOptionIds,
};
