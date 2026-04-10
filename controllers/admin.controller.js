const {
  tb_userModel,
  tb_vpsModel,
  tb_vps_categoryModel,
  tb_user_vpsModel,
  tb_transactionModel,
  tb_vps_logModel,
  tb_site_settingsModel,
  tb_voucherModel,
  tb_promo_modalModel,
} = require("../models/vpsphong");
const { getSiteSettings } = require("../utils/siteSettings");
const { normalizeCode } = require("../utils/voucher");
const { encrypt, decrypt } = require("../utils/vpsCrypto");

async function listVpsForAdminView() {
  const raw = await tb_vpsModel.find().populate("categoryId").sort({ createdAt: -1 }).lean();
  const sorted = raw.sort((a, b) => {
    const rank = (x) => {
      if (!x.isSold && x.status) return 0; // dang ban
      if (!x.isSold && !x.status) return 1; // ngung ban
      return 2; // da ban
    };
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  return sorted.map((v) => ({
    ...v,
    plainPassword: v.passwordEnc ? decrypt(v.passwordEnc) : "",
  }));
}

async function listActiveCategories() {
  return tb_vps_categoryModel.find({ isHidden: { $ne: true } }).sort({ name: 1 });
}

module.exports.getDashboard = async (req, res) => {
  const totalUsers = await tb_userModel.countDocuments({ role: "customer" });
  const totalVpsSold = await tb_vpsModel.countDocuments({ isSold: true });
  const totalVpsAvailable = await tb_vpsModel.countDocuments({ isSold: { $ne: true }, status: true });
  const totalVpsRunning = await tb_user_vpsModel.countDocuments({ status: "running" });
  const totalFixResolved = await tb_vps_logModel.countDocuments({
    action: { $in: ["start_approved", "stop_approved", "restart_approved"] },
  });

  const [customerBalanceAgg, usedAgg] = await Promise.all([
    tb_userModel.aggregate([
      { $match: { role: "customer" } },
      { $group: { _id: null, total: { $sum: "$balance" } } },
    ]),
    tb_transactionModel.aggregate([
      { $match: { status: "success", type: { $in: ["payment", "renew"] } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);

  const totalCustomerBalance = customerBalanceAgg[0]?.total || 0;
  const totalCustomerUsed = usedAgg[0]?.total || 0;

  res.render("admin/dashboard", {
    admin: res.locals.user,
    totalUsers,
    totalVpsSold,
    totalVpsAvailable,
    totalVpsRunning,
    totalFixResolved,
    totalCustomerBalance,
    totalCustomerUsed,
  });
};

module.exports.getVpsManager = async (req, res) => {
  const categories = await listActiveCategories();
  const vpsList = await listVpsForAdminView();
  let settings = await tb_site_settingsModel.findOne();
  if(!settings) settings = await tb_site_settingsModel.create({});
  const availableFeatures = settings.availableFeatures || [];
  res.render("admin/vps", { admin: res.locals.user, vpsList, categories, availableFeatures, error: null });
};

module.exports.postAddCategory = async (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) return res.redirect("/admin/vps");
  const dup = await tb_vps_categoryModel.findOne({
    name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
  });
  if (!dup) {
    await tb_vps_categoryModel.create({ name });
  } else if (dup.isHidden) {
    dup.isHidden = false;
    dup.isActive = true;
    await dup.save();
  }
  res.redirect("/admin/vps");
};

module.exports.postDeleteCategory = async (req, res) => {
  const { categoryId } = req.body;
  const used = await tb_vpsModel.countDocuments({ categoryId });
  if (used === 0) {
    await tb_vps_categoryModel.findByIdAndUpdate(categoryId, { $set: { isHidden: true, isActive: false } });
  }
  res.redirect("/admin/vps");
};

module.exports.postAddVps = async (req, res) => {
  const renderError = async (status, message) => {
    const categories = await listActiveCategories();
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
    const defaultFeatures = ["Win 12R2", "Bảo hành lỗi 1 đổi 1"];
    for (const ft of defaultFeatures) {
      if (!featuresArray.includes(ft)) featuresArray.push(ft);
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
    if (!cat || cat.isHidden) return renderError(400, "Loại VPS không hợp lệ.");
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
      disk: Number(disk) || 25,
      bandwidth: String(bandwidth || "").trim() === "" ? 0 : Number(bandwidth) || 0,
      price: Number(price) || 30000,
      billingCycleDays: Math.max(1, Number(billingCycleDays) || 30),
      serverIp: ip,
      serverUsername: (serverUsername || "Administrator").trim() || "Administrator",
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
    const categories = await listActiveCategories();
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

module.exports.getEditVps = async (req, res) => {
  try {
    const vpsId = req.params.id;
    const vps = await tb_vpsModel.findById(vpsId).lean();
    if (!vps) return res.redirect("/admin/vps");
    const categories = await listActiveCategories();
    let settings = await tb_site_settingsModel.findOne();
    if (!settings) settings = await tb_site_settingsModel.create({});
    const availableFeatures = settings.availableFeatures || [];
    res.render("admin/vps_edit", { admin: res.locals.user, vps, categories, availableFeatures, error: null });
  } catch (e) {
    console.error(e);
    res.redirect("/admin/vps");
  }
};

module.exports.postUpdateVps = async (req, res) => {
  const vpsId = req.params.id;
  const renderError = async (status, message) => {
    const vps = await tb_vpsModel.findById(vpsId).lean();
    if (!vps) return res.redirect("/admin/vps");
    const categories = await listActiveCategories();
    let settings = await tb_site_settingsModel.findOne();
    if (!settings) settings = await tb_site_settingsModel.create({});
    const availableFeatures = settings.availableFeatures || [];
    return res.status(status).render("admin/vps_edit", {
      admin: res.locals.user,
      vps,
      categories,
      availableFeatures,
      error: message,
    });
  };

  try {
    const vps = await tb_vpsModel.findById(vpsId);
    if (!vps) return res.redirect("/admin/vps");

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
    if (typeof features === "string") featuresArray = [features];
    else if (Array.isArray(features)) featuresArray = features.map((f) => String(f).trim()).filter(Boolean);

    if (newFeature && typeof newFeature === "string" && newFeature.trim()) {
      const nf = newFeature.trim();
      if (!featuresArray.includes(nf)) featuresArray.push(nf);
      await tb_site_settingsModel.findOneAndUpdate({}, { $addToSet: { availableFeatures: nf } }, { upsert: true });
    }

    const catId = categoryId && String(categoryId).length === 24 ? categoryId : null;
    if (!catId) return renderError(400, "Chọn loại VPS.");
    const cat = await tb_vps_categoryModel.findById(catId);
    if (!cat || cat.isHidden) return renderError(400, "Loại VPS không hợp lệ.");

    const ip = String(serverIp || "").trim();
    if (!ip) return renderError(400, "Vui lòng nhập địa chỉ IP máy chủ.");

    const kindRaw = String(productKind || "blank").toLowerCase();
    const resolvedKind = ["game", "blank", "datacenter"].includes(kindRaw) ? kindRaw : "blank";

    const durKind = durationKind === "until_date" ? "until_date" : "days";
    let until = null;
    if (durKind === "until_date") {
      until = rentValidUntil ? new Date(rentValidUntil) : null;
      if (!until || Number.isNaN(until.getTime())) return renderError(400, "Ngày hết hạn không hợp lệ.");
    }

    vps.categoryId = catId;
    vps.name = String(cat.name || "VPS").trim() || "VPS";
    vps.productKind = resolvedKind;
    vps.description = String(description || "").trim();
    vps.ipLocation = String(ipLocation || "Singapore").trim() || "Singapore";
    vps.features = featuresArray;
    vps.cpu = Math.max(1, Number(cpu) || 1);
    vps.ram = Math.max(1, Number(ram) || 1);
    vps.disk = Math.max(1, Number(disk) || 1000);
    vps.bandwidth = String(bandwidth || "").trim() === "" ? undefined : Number(bandwidth) || 0;
    vps.price = Math.max(0, Number(price) || 0);
    vps.billingCycleDays = Math.max(1, Number(billingCycleDays) || 30);
    vps.serverIp = ip;
    vps.serverUsername = String(serverUsername || "root").trim() || "root";
    if (String(serverPassword || "").trim()) {
      vps.passwordEnc = encrypt(String(serverPassword).trim());
    }
    vps.durationKind = durKind;
    vps.initialRentDays = Math.max(1, Number(initialRentDays) || 30);
    vps.rentValidUntil = durKind === "until_date" ? until : undefined;

    await vps.save();
    res.redirect("/admin/vps");
  } catch (e) {
    console.error(e);
    return renderError(500, "Lỗi cập nhật VPS, thử lại.");
  }
};

module.exports.getFixRequests = async (req, res) => {
  try {
    const list = await tb_user_vpsModel
      .find({ powerActionStatus: "pending", pendingPowerAction: { $ne: "none" } })
      .populate("userId", "username email phone")
      .populate("vpsId", "name saleCode serverIp")
      .sort({ powerActionRequestedAt: -1, createdAt: -1 })
      .lean();
    res.render("admin/fix_requests", { admin: res.locals.user, list });
  } catch (e) {
    console.error(e);
    res.status(500).send("Lỗi tải danh sách fix lỗi");
  }
};

module.exports.postResolveFixRequest = async (req, res) => {
  try {
    const userVpsId = String(req.params.id || "");
    const uv = await tb_user_vpsModel.findById(userVpsId);
    if (!uv || uv.powerActionStatus !== "pending" || uv.pendingPowerAction === "none") {
      return res.redirect("/admin/fix-requests");
    }

    const action = uv.pendingPowerAction;
    if (action === "stop") uv.status = "stopped";
    else if (action === "start" || action === "restart") uv.status = "running";

    uv.pendingPowerAction = "none";
    uv.powerActionStatus = "idle";
    uv.powerActionRequestedAt = undefined;
    await uv.save();

    await tb_vps_logModel.create({
      userId: res.locals.user._id,
      ownerUserId: uv.userId,
      userVpsId: uv._id,
      action: `${action}_approved`,
      category: "admin",
      description: `Admin đã xử lý yêu cầu ${action} VPS`,
    });
  } catch (e) {
    console.error(e);
  }
  return res.redirect("/admin/fix-requests");
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

module.exports.postRenameUserVps = async (req, res) => {
  try {
    const userId = req.params.id;
    const userVpsId = String(req.body.userVpsId || "");
    const displayName = String(req.body.displayName || "").trim();
    if (displayName.length > 80) {
      return res.redirect(`/admin/users/${userId}`);
    }

    const uv = await tb_user_vpsModel.findOne({ _id: userVpsId, userId });
    if (!uv) return res.redirect(`/admin/users/${userId}`);

    uv.displayName = displayName;
    await uv.save();

    await tb_vps_logModel.create({
      userId: res.locals.user._id,
      ownerUserId: userId,
      userVpsId: uv._id,
      action: "rename",
      category: "admin",
      description: displayName
        ? `Admin đổi tên hiển thị VPS: ${displayName}`
        : "Admin xóa tên hiển thị tùy chỉnh của VPS",
    });
  } catch (e) {
    console.error(e);
  }
  return res.redirect(`/admin/users/${req.params.id}`);
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
    const vouchers = await tb_voucherModel.find({ isHidden: { $ne: true } }).sort({ createdAt: -1 }).lean();
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

    const existed = await tb_voucherModel.findOne({ code });
    if (existed) {
      existed.discountType = discountType;
      existed.discountValue = discountValue;
      existed.maxUses = maxUses;
      existed.expiresAt = expiresAt;
      existed.minOrderAmount = minOrderAmount;
      existed.note = note;
      existed.isActive = true;
      existed.isHidden = false;
      await existed.save();
    } else {
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
    }
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
    await tb_voucherModel.findByIdAndUpdate(voucherId, { $set: { isHidden: true, isActive: false } });
    res.redirect("/admin/vouchers");
  } catch (e) {
    res.redirect("/admin/vouchers");
  }
};

/* ===== PROMO MODAL ===== */

module.exports.getPromoModal = async (req, res) => {
  try {
    let modal = await tb_promo_modalModel.findOne().lean();
    if (!modal) modal = await tb_promo_modalModel.create({});
    res.render("admin/settings_promo_modal", {
      admin: res.locals.user,
      modal,
      saved: req.query.saved === "1",
      error: null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).send("Lỗi tải cấu hình modal");
  }
};

module.exports.postPromoModal = async (req, res) => {
  try {
    const isEnabled   = req.body.isEnabled === "1";
    const title       = String(req.body.title       || "").trim().slice(0, 200);
    const bodyHtml    = String(req.body.bodyHtml    || "").trim().slice(0, 5000);
    const facebookUrl = String(req.body.facebookUrl || "").trim().slice(0, 500);
    const zaloNumber  = String(req.body.zaloNumber  || "").trim().slice(0, 50);
    const hideHours   = Math.max(0, Math.min(720, Number(req.body.hideHours) || 1));

    const existing = await tb_promo_modalModel.findOne();
    if (existing) {
      existing.isEnabled   = isEnabled;
      existing.title       = title;
      existing.bodyHtml    = bodyHtml;
      existing.facebookUrl = facebookUrl;
      existing.zaloNumber  = zaloNumber;
      existing.hideHours   = hideHours;
      existing.version     = (existing.version || 1) + 1;
      await existing.save();
    } else {
      await tb_promo_modalModel.create({
        isEnabled, title, bodyHtml, facebookUrl, zaloNumber, hideHours, version: 1,
      });
    }
    res.redirect("/admin/settings/promo-modal?saved=1");
  } catch (e) {
    console.error(e);
    res.status(500).send("Lỗi lưu cấu hình modal");
  }
};

