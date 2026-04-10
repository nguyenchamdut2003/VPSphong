const { tb_vpsModel, tb_userModel, tb_vps_categoryModel, tb_user_vpsModel, tb_transactionModel } = require("../models/vpsphong");

module.exports.getHome = async (req, res) => {
  try {
    const filter = { status: true, isSold: { $ne: true } };
    const catQ = req.query.category;
    if (catQ && /^[a-fA-F0-9]{24}$/.test(String(catQ))) {
      filter.categoryId = catQ;
    }
    const kind = String(req.query.kind || "").toLowerCase();
    if (kind === "game" || kind === "datacenter") {
      filter.productKind = kind;
    } else if (kind === "blank") {
      filter.$or = [{ productKind: "blank" }, { productKind: { $exists: false } }, { productKind: null }];
    }

    const listVpsRaw = await tb_vpsModel.find(filter).populate("categoryId").sort({ createdAt: -1 });
    
    // Group identical VPS packages
    const groupedMap = {};
    for (let vps of listVpsRaw) {
      const sig = `${vps.name}_${vps.cpu}_${vps.ram}_${vps.disk}_${vps.price}_${vps.ipLocation}`;
      if (!groupedMap[sig]) {
        groupedMap[sig] = vps.toObject ? vps.toObject() : { ...vps };
        groupedMap[sig].stock = 1;
      } else {
        groupedMap[sig].stock += 1;
      }
    }
    const listVps = Object.values(groupedMap);


    let filterKind = "";
    let filterCategoryName = "";
    if (kind === "game") filterKind = "Treo game";
    else if (kind === "blank") filterKind = "VPS trắng";
    else if (kind === "datacenter") filterKind = "IP Datacenter";
    if (catQ && /^[a-fA-F0-9]{24}$/.test(String(catQ))) {
      const catDoc = await tb_vps_categoryModel.findById(catQ).select("name").lean();
      filterCategoryName = catDoc && catDoc.name ? catDoc.name : "";
    }

    // Check if user logged in to display user info on Navbar
    let user = null;
    let isAdmin = false;
    let demoVps = null;
    if (req.session.userId) {
      user = await tb_userModel.findById(req.session.userId);
      if (user && user.role === "admin") isAdmin = true;
      demoVps = await tb_user_vpsModel.findOne({ userId: req.session.userId }).populate({ path: 'vpsId', populate: { path: 'categoryId' } }).sort({ createdAt: -1 });
    }

    let demoPurchaseOrderNumber = null;
    if (demoVps) {
      const payTx = await tb_transactionModel
        .findOne({ userVpsId: demoVps._id, type: "payment", status: "success" })
        .sort({ createdAt: -1 })
        .select("orderNumber")
        .lean();
      if (payTx && typeof payTx.orderNumber === "number") demoPurchaseOrderNumber = payTx.orderNumber;
    }

    res.render("index", {
      vpsPackages: listVps,
      user,
      isAdmin,
      demoVps,
      demoPurchaseOrderNumber,
      filterKind,
      filterCategoryName,
    });
  } catch (err) {
    console.log(err);
    res.send("Lỗi tải trang chủ");
  }
};
