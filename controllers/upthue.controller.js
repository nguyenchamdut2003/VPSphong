const {
  tb_userModel,
  tb_upthueModel,
  tb_transactionModel,
  tb_vps_logModel,
  tb_counterModel,
} = require("../models/vpsphong");
const { encryptAES } = require("../utils/accountAes");
const {
  loadActiveUpthueCatalog,
  quoteUpthueOrder,
  normalizeOptionIds,
  getGoiUpLabelFromOrder,
} = require("../utils/upthueCatalog");
const { nextTransactionOrderNumber } = require("../utils/nextTransactionOrderNumber");

async function nextMaUpthue() {
  const doc = await tb_counterModel.findOneAndUpdate(
    { _id: "upthue_ma" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  return doc.seq;
}

function isAdminUser(user) {
  return user && user.role === "admin";
}

function renderForm(res, opts) {
  const catalog = opts.catalog || { timePackages: [], servers: [], options: [] };
  const adminOrder = isAdminUser(res.locals.user);
  res.render("user/up-thue", {
    user: res.locals.user,
    timePackages: catalog.timePackages,
    servers: catalog.servers,
    options: catalog.options,
    isAdminOrder: adminOrder,
    catalogJson: JSON.stringify({
      timePackages: catalog.timePackages.map((t) => ({
        _id: String(t._id),
        name: t.name,
        days: t.days,
        price: t.price,
      })),
      options: catalog.options.map((o) => ({
        _id: String(o._id),
        type: o.type,
        extraPriceMap: o.extraPriceMap || {},
      })),
      adminFree: adminOrder,
    }),
    error: opts.error || null,
    message: opts.message || null,
    activeNav: "upthue",
    pageTitle: "Up thuê Ninja",
    headerTitle: "Up Thuê Ninja",
    headerSubtitle: adminOrder ? "Admin đặt đơn — thanh toán 0đ" : "Dịch vụ cày thuê NSO",
  });
}

module.exports.getUpThue = async (req, res) => {
  try {
    const catalog = await loadActiveUpthueCatalog();
    const message = req.query.success === "1" ? "Gửi đơn up thuê thành công." : null;
    if (!catalog.timePackages.length) {
      return renderForm(res, {
        catalog,
        error: "Chưa có gói thời gian thuê. Vui lòng liên hệ admin.",
      });
    }
    renderForm(res, { catalog, message });
  } catch (e) {
    console.error(e);
    renderForm(res, { catalog: { timePackages: [], servers: [], options: [] }, error: "Không tải được dữ liệu, thử lại sau." });
  }
};

module.exports.postUpThue = async (req, res) => {
  let charged = false;
  let chargeAmount = 0;
  let userId = null;

  try {
    const isAdmin = isAdminUser(res.locals.user);
    const { taikhoan, matkhau, map, timePackageId, serverId, optionIds } = req.body;

    if (!taikhoan || !matkhau || !map || !timePackageId || !serverId) {
      const catalog = await loadActiveUpthueCatalog();
      return renderForm(res, { catalog, error: "Vui lòng nhập đầy đủ thông tin." });
    }

    const quote = await quoteUpthueOrder({
      timePackageId,
      serverId,
      optionIds: normalizeOptionIds(optionIds),
    });

    if (!quote.ok) {
      const catalog = await loadActiveUpthueCatalog();
      return renderForm(res, { catalog, error: quote.error });
    }

    userId = res.locals.user._id;
    const catalogGia = quote.gia;
    chargeAmount = isAdmin ? 0 : catalogGia;

    let encPass;
    try {
      encPass = encryptAES(matkhau);
    } catch (encErr) {
      const catalog = await loadActiveUpthueCatalog();
      return renderForm(res, { catalog, error: "Hệ thống chưa cấu hình mã hóa (AES_SECRET)." });
    }

    if (!isAdmin) {
      const updatedUser = await tb_userModel.findOneAndUpdate(
        { _id: userId, role: "customer", balance: { $gte: chargeAmount } },
        { $inc: { balance: -chargeAmount } },
        { new: true },
      );

      if (!updatedUser) {
        const catalog = await loadActiveUpthueCatalog();
        const cur = await tb_userModel.findById(userId);
        const bal = cur ? cur.balance || 0 : 0;
        return renderForm(res, {
          catalog,
          error: `Số dư không đủ. Cần ${chargeAmount.toLocaleString("vi-VN")}đ, hiện có ${bal.toLocaleString("vi-VN")}đ.`,
        });
      }
      charged = true;
    }

    const now = new Date();
    const timeend = new Date(now.getTime() + quote.days * 24 * 60 * 60 * 1000);
    const maupthue = await nextMaUpthue();
    const orderNumber = await nextTransactionOrderNumber();

    const txDesc = isAdmin
      ? `Up thuê #${maupthue} — ${quote.days} ngày (${quote.goiupLabel}) [Admin 0đ]`
      : `Up thuê #${maupthue} — ${quote.days} ngày (${quote.goiupLabel})`;
    await tb_transactionModel.create({
      userId,
      amount: chargeAmount,
      type: "upthue",
      description: txDesc,
      status: "success",
      orderNumber,
    });

    await tb_upthueModel.create({
      userId,
      maupthue,
      timestart: now,
      timeend,
      goiup: quote.goiup,
      gia: chargeAmount,
      map: String(map).trim(),
      maychu: quote.serverSnapshot.value,
      taikhoan: String(taikhoan).trim(),
      matkhauEnc: encPass,
      status: "Đang chờ",
      timePackageId: quote.timePackageId,
      timePackageSnapshot: quote.timePackageSnapshot,
      serverId: quote.serverId,
      serverSnapshot: quote.serverSnapshot,
      optionIds: quote.optionIds,
      optionsSnapshot: quote.optionsSnapshot,
    });

    const logDesc = isAdmin
      ? `Admin đặt up thuê #${maupthue} — 0đ (giá catalog ${catalogGia.toLocaleString("vi-VN")}đ)`
      : `Đặt up thuê #${maupthue} — ${chargeAmount.toLocaleString("vi-VN")}đ`;
    await tb_vps_logModel.create({
      userId,
      ownerUserId: userId,
      action: "upthue_order",
      category: "billing",
      description: logDesc,
    });

    return res.redirect("/user/up-thue?success=1");
  } catch (e) {
    console.error(e);
    if (charged && userId && chargeAmount > 0) {
      await tb_userModel.findByIdAndUpdate(userId, { $inc: { balance: chargeAmount } });
    }
    try {
      const catalog = await loadActiveUpthueCatalog();
      return renderForm(res, { catalog, error: "Có lỗi xảy ra, vui lòng thử lại." });
    } catch {
      return res.status(500).send("Lỗi hệ thống");
    }
  }
};

module.exports.getUpThueHistory = async (req, res) => {
  try {
    const docs = await tb_upthueModel
      .find({ userId: res.locals.user._id })
      .sort({ maupthue: -1 })
      .lean();

    const list = docs.map((d) => ({
      ...d,
      goiupLabel: getGoiUpLabelFromOrder(d),
      timestartText: new Date(d.timestart).toLocaleDateString("vi-VN"),
      timeendText: new Date(d.timeend).toLocaleDateString("vi-VN"),
      giaText: `${(d.gia || 0).toLocaleString("vi-VN")}đ`,
      songay:
        Math.round((new Date(d.timeend) - new Date(d.timestart)) / (24 * 60 * 60 * 1000)) || 0,
      serverLabel: d.serverSnapshot?.name || d.maychu || "—",
      timeLabel: d.timePackageSnapshot?.name
        ? `${d.timePackageSnapshot.name}`
        : "—",
    }));

    res.render("user/up-thue-history", {
      user: res.locals.user,
      list,
      error: null,
      activeNav: "upthue",
      pageTitle: "Đơn Up thuê",
      headerTitle: "Up Thuê Ninja",
      headerSubtitle: "Lịch sử đơn của bạn",
    });
  } catch (e) {
    console.error(e);
    res.render("user/up-thue-history", {
      user: res.locals.user,
      list: [],
      error: "Không tải được dữ liệu.",
      activeNav: "upthue",
      pageTitle: "Đơn Up thuê",
      headerTitle: "Up Thuê Ninja",
      headerSubtitle: "Lịch sử đơn của bạn",
    });
  }
};
