const {
  tb_userModel,
  tb_vpsModel,
  tb_vps_categoryModel,
  tb_user_vpsModel,
  tb_transactionModel,
  tb_vps_logModel,
  tb_site_settingsModel,
  tb_voucherModel,
} = require("../models/vpsphong");
const { getSiteSettings } = require("../utils/siteSettings");
const { normalizeCode } = require("../utils/voucher");
const { encrypt, decrypt } = require("../utils/vpsCrypto");

async function listVpsForAdminView() {
  const raw = await tb_vpsModel.find().populate("categoryId").sort({ createdAt: -1 }).lean();
  return raw.map((v) => ({
    ...v,
    plainPassword: v.passwordEnc ? decrypt(v.passwordEnc) : "",
  }));
}

module.exports.getDashboard = async (req, res) => {
  const totalUsers = await tb_userModel.countDocuments({ role: "customer" });
  const totalVpsSold = await tb_user_vpsModel.countDocuments();
  res.render("admin/dashboard", { admin: res.locals.user, totalUsers, totalVpsSold });
};

module.exports.getVpsManager = async (req, res) => {
  const categories = await tb_vps_categoryModel.find().sort({ name: 1 });
  const vpsList = await listVpsForAdminView();
  let settings = await tb_site_settingsModel.findOne();
  if(!settings) settings = await tb_site_settingsModel.create({});
  const availableFeatures = settings.availableFeatures || [];
  res.render("admin/vps", { admin: res.locals.user, vpsList, categories, availableFeatures, error: null });
};

module.exports.postAddCategory = async (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) return res.redirect("/admin/vps");
  const dup = await tb_vps_categoryModel.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
  if (!dup) await tb_vps_categoryModel.create({ name });
  res.redirect("/admin/vps");
};

module.exports.postDeleteCategory = async (req, res) => {
  const { categoryId } = req.body;
  const used = await tb_vpsModel.countDocuments({ categoryId });
  if (used === 0) await tb_vps_categoryModel.findByIdAndDelete(categoryId);
  res.redirect("/admin/vps");
};

module.exports.postAddVps = async (req, res) => {
  const renderError = async (status, message) => {
    const categories = await tb_vps_categoryModel.find().sort({ name: 1 });
    const vpsList = await listVpsForAdminView();
    let settings = await tb_site_settingsModel.findOne();
    if(!settings) settings = await tb_site_settingsModel.create({});
    const availableFeatures = settings.availableFeatures || [];
    return res.status(status).render("admin/vps", {
      admin: res.locals.user,
      vpsList,
      categories,
      availableFeatures,
      error: message,
    });
  };

  try {
    const {
      categoryId,
      cpu,
      ram,
      disk,
      bandwidth,
      price,
      billingCycleDays,
      serverIp,
      serverUsername,
      serverPassword,
      durationKind,
      initialRentDays,
      rentValidUntil,
      description,
      productKind,
      ipLocation,
      features,
      newFeature,
    } = req.body;

    let featuresArray = [];
    if (typeof features === 'string') {
      featuresArray = [features];
    } else if (Array.isArray(features)) {
      featuresArray = features.map(f => String(f).trim()).filter(f => f.length > 0);
    }

    if (newFeature && typeof newFeature === 'string' && newFeature.trim()) {
      const nf = newFeature.trim();
      if (!featuresArray.includes(nf)) {
         featuresArray.push(nf);
      }
      await tb_site_settingsModel.findOneAndUpdate({}, { $addToSet: { availableFeatures: nf } }, { upsert: true });
    }

    const pwd = (serverPassword || "").trim();
    if (!pwd) return renderError(400, "Vui lòng nhập mật khẩu máy chủ.");

    const kind = durationKind === "until_date" ? "until_date" : "days";
    let until = null;
    if (kind === "until_date") {
      until = rentValidUntil ? new Date(rentValidUntil) : null;
      if (!until || Number.isNaN(until.getTime())) {
        return renderError(400, "Chọn ngày hết hạn thuê hoặc đổi sang nhập số ngày.");
      }
    }

    const ip = (serverIp || "").trim();
    if (!ip) return renderError(400, "Vui lòng nhập địa chỉ IP máy chủ.");

    const catId = categoryId && String(categoryId).length === 24 ? categoryId : null;
    if (!catId) return renderError(400, "Chọn loại VPS.");

    const cat = await tb_vps_categoryModel.findById(catId);
    const resolvedName = cat && cat.name ? String(cat.name).trim() : "VPS";

    const kindRaw = String(productKind || "blank").toLowerCase();
    const resolvedKind = ["game", "blank", "datacenter"].includes(kindRaw) ? kindRaw : "blank";

    const last = await tb_vpsModel.findOne({ saleCode: { $exists: true, $ne: null } }).sort({ saleCode: -1 }).select("saleCode").lean();
    const saleCode = last && typeof last.saleCode === "number" ? last.saleCode + 1 : 1;

    await tb_vpsModel.create({
      name: resolvedName,
      saleCode,
      categoryId: catId,
      productKind: resolvedKind,
      description: (description || "").trim(),
      ipLocation: (ipLocation || "Singapore").trim(),
      features: featuresArray,
      cpu: Number(cpu) || 1,
      ram: Number(ram) || 1,
      disk: Number(disk) || 20,
      bandwidth: bandwidth ? Number(bandwidth) : undefined,
      price: Number(price) || 0,
      billingCycleDays: Math.max(1, Number(billingCycleDays) || 30),
      serverIp: ip,
      serverUsername: (serverUsername || "root").trim() || "root",
      passwordEnc: encrypt(pwd),
      durationKind: kind,
      initialRentDays: Math.max(1, Number(initialRentDays) || 30),
      rentValidUntil: kind === "until_date" ? until : undefined,
      status: true,
      isSold: false,
    });

    res.redirect("/admin/vps");
  } catch (e) {
    console.error(e);
    const categories = await tb_vps_categoryModel.find().sort({ name: 1 });
    const vpsList = await listVpsForAdminView();
    let settings = await tb_site_settingsModel.findOne();
    if(!settings) settings = await tb_site_settingsModel.create({});
    const availableFeatures = settings.availableFeatures || [];
    res.status(500).render("admin/vps", {
      admin: res.locals.user,
      vpsList,
      categories,
      availableFeatures,
      error: "Lỗi lưu VPS, thử lại.",
    });
  }
};

module.exports.postToggleVps = async (req, res) => {
  const { vpsId } = req.body;
  const vps = await tb_vpsModel.findById(vpsId);
  if (vps && !vps.isSold) {
    vps.status = !vps.status;
    await vps.save();
  }
  res.redirect("/admin/vps");
};

module.exports.getUsersManager = async (req, res) => {
  const users = await tb_userModel.find({ role: "customer" });
  res.render("admin/users", { admin: res.locals.user, users });
};

module.exports.postToggleUserLock = async (req, res) => {
  const { blockUserId } = req.body;
  const user = await tb_userModel.findById(blockUserId);
  if (user) {
    user.isActive = !user.isActive;
    await user.save();
  }
  res.redirect("/admin/users");
};

module.exports.getUserDetail = async (req, res) => {
  const userId = req.params.id;
  const targetUser = await tb_userModel.findById(userId);
  const userVpsList = await tb_user_vpsModel.find({ userId }).populate("vpsId");
  const vpsIdList = userVpsList.map((uv) => uv._id);
  const userLogs = await tb_vps_logModel
    .find({
      $or: [{ userVpsId: { $in: vpsIdList } }, { ownerUserId: userId }],
    })
    .populate("userVpsId")
    .sort({ createdAt: -1 });

  res.render("admin/user_detail", { admin: res.locals.user, targetUser, userVpsList, userLogs });
};

module.exports.getAllLogs = async (req, res) => {
  const logs = await tb_vps_logModel.find().populate("userId").populate("userVpsId").sort({ createdAt: -1 });
  res.render("admin/logs", { admin: res.locals.user, logs });
};

module.exports.getSupportSettings = async (req, res) => {
  try {
    const settings = await getSiteSettings();
    res.render("admin/settings_support", {
      admin: res.locals.user,
      settings,
      saved: req.query.saved === "1",
    });
  } catch (e) {
    console.error(e);
    res.status(500).send("Lỗi tải cấu hình");
  }
};

module.exports.postSupportSettings = async (req, res) => {
  try {
    const supportZaloUrl = String(req.body.supportZaloUrl || "").trim();
    const supportFacebookUrl = String(req.body.supportFacebookUrl || "").trim();
    await tb_site_settingsModel.findOneAndUpdate(
      {},
      { $set: { supportZaloUrl, supportFacebookUrl } },
      { upsert: true, new: true },
    );
    res.redirect("/admin/settings/support?saved=1");
  } catch (e) {
    console.error(e);
    res.status(500).send("Lỗi lưu cấu hình");
  }
};

module.exports.getVouchers = async (req, res) => {
  try {
    const vouchers = await tb_voucherModel.find().sort({ createdAt: -1 }).lean();
    res.render("admin/vouchers", {
      admin: res.locals.user,
      vouchers,
      flashError: req.query.err ? String(req.query.err) : null,
      flashOk: req.query.ok === "1",
    });
  } catch (e) {
    console.error(e);
    res.status(500).send("Lỗi tải voucher");
  }
};

module.exports.postAddVoucher = async (req, res) => {
  try {
    const code = normalizeCode(req.body.code || "");
    if (!code || code.length < 2) {
      return res.redirect("/admin/vouchers?err=" + encodeURIComponent("Mã voucher tối thiểu 2 ký tự."));
    }
    const discountType = req.body.discountType === "fixed" ? "fixed" : "percent";
    const discountValue = Number(req.body.discountValue);
    if (Number.isNaN(discountValue) || discountValue <= 0) {
      return res.redirect("/admin/vouchers?err=" + encodeURIComponent("Giá trị giảm không hợp lệ."));
    }
    if (discountType === "percent" && discountValue > 100) {
      return res.redirect("/admin/vouchers?err=" + encodeURIComponent("Giảm % tối đa 100."));
    }
    const maxUsesRaw = req.body.maxUses;
    let maxUses = null;
    if (String(maxUsesRaw ?? "").trim() !== "") {
      const n = parseInt(String(maxUsesRaw), 10);
      if (!Number.isFinite(n) || n < 1) {
        return res.redirect("/admin/vouchers?err=" + encodeURIComponent("Số lượt dùng phải ≥ 1 hoặc để trống (không giới hạn)."));
      }
      maxUses = n;
    }
    let expiresAt = null;
    if (req.body.expiresAt && String(req.body.expiresAt).trim()) {
      const d = new Date(req.body.expiresAt);
      if (!Number.isNaN(d.getTime())) expiresAt = d;
    }
    const minOrderAmount = Math.max(0, Number(req.body.minOrderAmount) || 0);
    const note = String(req.body.note || "").trim().slice(0, 500);

    await tb_voucherModel.create({
      code,
      discountType,
      discountValue,
      maxUses,
      expiresAt,
      minOrderAmount,
      note,
      isActive: true,
      usedCount: 0,
    });
    res.redirect("/admin/vouchers?ok=1");
  } catch (e) {
    console.error(e);
    if (e.code === 11000) {
      return res.redirect("/admin/vouchers?err=" + encodeURIComponent("Mã voucher đã tồn tại."));
    }
    res.redirect("/admin/vouchers?err=" + encodeURIComponent("Không thể tạo voucher."));
  }
};

module.exports.postToggleVoucher = async (req, res) => {
  try {
    const { voucherId } = req.body;
    const v = await tb_voucherModel.findById(voucherId);
    if (v) {
      v.isActive = !v.isActive;
      await v.save();
    }
    res.redirect("/admin/vouchers");
  } catch (e) {
    res.redirect("/admin/vouchers");
  }
};

module.exports.postDeleteVoucher = async (req, res) => {
  try {
    const { voucherId } = req.body;
    await tb_voucherModel.findByIdAndDelete(voucherId);
    res.redirect("/admin/vouchers");
  } catch (e) {
    res.redirect("/admin/vouchers");
  }
};
