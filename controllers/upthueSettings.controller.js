const mongoose = require("mongoose");
const {
  tb_upthue_time_packageModel,
  tb_upthue_serverModel,
  tb_upthue_optionModel,
} = require("../models/vpsphong");
const { loadAllUpthueConfigForAdmin, ensureUpthueConfigSeeded } = require("../utils/upthueCatalog");

const SETTINGS_URL = "/admin/upthue/settings";

function redirectSettings(req, flash) {
  const q = new URLSearchParams();
  if (flash?.ok) q.set("ok", flash.ok);
  if (flash?.err) q.set("err", flash.err);
  const qs = q.toString();
  return `${SETTINGS_URL}${qs ? `?${qs}` : ""}`;
}

function parsePositiveNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Máy chủ: value lưu đơn = tên hiển thị (trim). */
function serverValueFromName(name) {
  return String(name || "").trim();
}

/** Gói up: mã code từ tên (bỏ dấu, chữ thường, không khoảng). */
function optionCodeFromName(name) {
  return String(name || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

async function uniqueOptionCode(baseCode, excludeId) {
  if (!baseCode) return "";
  let code = baseCode;
  let n = 0;
  while (true) {
    const q = { code };
    if (excludeId) q._id = { $ne: excludeId };
    const dup = await tb_upthue_optionModel.findOne(q);
    if (!dup) return code;
    n += 1;
    code = `${baseCode}${n}`;
  }
}

function parseExtraPricesFromBody(body, timePackages) {
  const extraPrices = [];
  for (const tp of timePackages) {
    const key = `extraPrice_${tp._id}`;
    if (body[key] === undefined || body[key] === "") continue;
    const price = parsePositiveNum(body[key]);
    if (price === null) return { error: `Phụ thu cho "${tp.name}" không hợp lệ.` };
    extraPrices.push({ timePackageId: tp._id, price });
  }
  return { extraPrices };
}

async function renderSettings(req, res, flash = {}) {
  await ensureUpthueConfigSeeded();
  const { timePackages, servers, options } = await loadAllUpthueConfigForAdmin();
  res.render("admin/upthue_settings", {
    admin: res.locals.user,
    timePackages,
    servers,
    options,
    timePackagesAll: timePackages,
    flashOk: flash.ok || req.query.ok || null,
    flashErr: flash.err || req.query.err || null,
  });
}

module.exports.getSettings = async (req, res) => {
  try {
    await renderSettings(req, res);
  } catch (e) {
    console.error(e);
    res.status(500).send("Lỗi tải cấu hình Up thuê");
  }
};

// ——— Gói thời gian ———
module.exports.postTimePackageCreate = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const days = parsePositiveNum(req.body.days);
    const price = parsePositiveNum(req.body.price);
    if (!name || days === null || days < 1 || price === null) {
      return res.redirect(redirectSettings(req, { err: "invalid_time" }));
    }
    await tb_upthue_time_packageModel.create({
      name,
      days: Math.floor(days),
      price,
      isActive: req.body.isActive !== "0",
    });
    return res.redirect(redirectSettings(req, { ok: "time_created" }));
  } catch (e) {
    console.error(e);
    return res.redirect(redirectSettings(req, { err: "server" }));
  }
};

module.exports.postTimePackageUpdate = async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const name = String(req.body.name || "").trim();
    const days = parsePositiveNum(req.body.days);
    const price = parsePositiveNum(req.body.price);
    if (!mongoose.Types.ObjectId.isValid(id) || !name || days === null || days < 1 || price === null) {
      return res.redirect(redirectSettings(req, { err: "invalid_time" }));
    }
    const doc = await tb_upthue_time_packageModel.findById(id);
    if (!doc) return res.redirect(redirectSettings(req, { err: "not_found" }));
    doc.name = name;
    doc.days = Math.floor(days);
    doc.price = price;
    await doc.save();
    return res.redirect(redirectSettings(req, { ok: "time_updated" }));
  } catch (e) {
    console.error(e);
    return res.redirect(redirectSettings(req, { err: "server" }));
  }
};

module.exports.postTimePackageToggle = async (req, res) => {
  try {
    const doc = await tb_upthue_time_packageModel.findById(req.params.id);
    if (!doc) return res.redirect(redirectSettings(req, { err: "not_found" }));
    doc.isActive = !doc.isActive;
    await doc.save();
    return res.redirect(redirectSettings(req, { ok: "time_toggled" }));
  } catch (e) {
    console.error(e);
    return res.redirect(redirectSettings(req, { err: "server" }));
  }
};

// ——— Máy chủ ———
module.exports.postServerCreate = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) return res.redirect(redirectSettings(req, { err: "invalid_server" }));
    const value = serverValueFromName(name);
    const dup = await tb_upthue_serverModel.findOne({ name });
    if (dup) return res.redirect(redirectSettings(req, { err: "server_dup" }));
    await tb_upthue_serverModel.create({
      name,
      value,
      isActive: req.body.isActive !== "0",
    });
    return res.redirect(redirectSettings(req, { ok: "server_created" }));
  } catch (e) {
    console.error(e);
    return res.redirect(redirectSettings(req, { err: "server" }));
  }
};

module.exports.postServerUpdate = async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const name = String(req.body.name || "").trim();
    if (!mongoose.Types.ObjectId.isValid(id) || !name) {
      return res.redirect(redirectSettings(req, { err: "invalid_server" }));
    }
    const dup = await tb_upthue_serverModel.findOne({ name, _id: { $ne: id } });
    if (dup) return res.redirect(redirectSettings(req, { err: "server_dup" }));
    const doc = await tb_upthue_serverModel.findById(id);
    if (!doc) return res.redirect(redirectSettings(req, { err: "not_found" }));
    doc.name = name;
    doc.value = serverValueFromName(name);
    await doc.save();
    return res.redirect(redirectSettings(req, { ok: "server_updated" }));
  } catch (e) {
    console.error(e);
    return res.redirect(redirectSettings(req, { err: "server" }));
  }
};

module.exports.postServerToggle = async (req, res) => {
  try {
    const doc = await tb_upthue_serverModel.findById(req.params.id);
    if (!doc) return res.redirect(redirectSettings(req, { err: "not_found" }));
    doc.isActive = !doc.isActive;
    await doc.save();
    return res.redirect(redirectSettings(req, { ok: "server_toggled" }));
  } catch (e) {
    console.error(e);
    return res.redirect(redirectSettings(req, { err: "server" }));
  }
};

// ——— Gói up ———
module.exports.postOptionCreate = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const type = String(req.body.type || "").toLowerCase();
    if (!name || !["free", "paid"].includes(type)) {
      return res.redirect(redirectSettings(req, { err: "invalid_option" }));
    }
    const code = await uniqueOptionCode(optionCodeFromName(name));
    if (!code) return res.redirect(redirectSettings(req, { err: "invalid_option" }));

    const timePackages = await tb_upthue_time_packageModel.find().sort({ createdAt: 1 }).lean();
    let extraPrices = [];
    if (type === "paid") {
      const parsed = parseExtraPricesFromBody(req.body, timePackages);
      if (parsed.error) return res.redirect(redirectSettings(req, { err: "invalid_extra" }));
      extraPrices = parsed.extraPrices;
      if (extraPrices.length !== timePackages.length) {
        return res.redirect(redirectSettings(req, { err: "missing_extra" }));
      }
    }

    await tb_upthue_optionModel.create({
      name,
      code,
      type,
      extraPrices,
      isActive: req.body.isActive !== "0",
    });
    return res.redirect(redirectSettings(req, { ok: "option_created" }));
  } catch (e) {
    console.error(e);
    return res.redirect(redirectSettings(req, { err: "server" }));
  }
};

module.exports.postOptionUpdate = async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const name = String(req.body.name || "").trim();
    const type = String(req.body.type || "").toLowerCase();
    if (!mongoose.Types.ObjectId.isValid(id) || !name || !["free", "paid"].includes(type)) {
      return res.redirect(redirectSettings(req, { err: "invalid_option" }));
    }

    const doc = await tb_upthue_optionModel.findById(id);
    if (!doc) return res.redirect(redirectSettings(req, { err: "not_found" }));

    const code = await uniqueOptionCode(optionCodeFromName(name), id);
    if (!code) return res.redirect(redirectSettings(req, { err: "invalid_option" }));

    const timePackages = await tb_upthue_time_packageModel.find().sort({ createdAt: 1 }).lean();
    let extraPrices = [];
    if (type === "paid") {
      const parsed = parseExtraPricesFromBody(req.body, timePackages);
      if (parsed.error) return res.redirect(redirectSettings(req, { err: "invalid_extra" }));
      extraPrices = parsed.extraPrices;
      if (extraPrices.length !== timePackages.length) {
        return res.redirect(redirectSettings(req, { err: "missing_extra" }));
      }
    }

    doc.name = name;
    doc.code = code;
    doc.type = type;
    doc.extraPrices = extraPrices;
    await doc.save();
    return res.redirect(redirectSettings(req, { ok: "option_updated" }));
  } catch (e) {
    console.error(e);
    return res.redirect(redirectSettings(req, { err: "server" }));
  }
};

module.exports.postOptionToggle = async (req, res) => {
  try {
    const doc = await tb_upthue_optionModel.findById(req.params.id);
    if (!doc) return res.redirect(redirectSettings(req, { err: "not_found" }));
    doc.isActive = !doc.isActive;
    await doc.save();
    return res.redirect(redirectSettings(req, { ok: "option_toggled" }));
  } catch (e) {
    console.error(e);
    return res.redirect(redirectSettings(req, { err: "server" }));
  }
};
