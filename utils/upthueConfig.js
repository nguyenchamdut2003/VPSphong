/** @deprecated Dùng utils/upthueCatalog.js — giữ re-export tương thích */
const catalog = require("./upthueCatalog");
const legacy = require("./upthueLegacyDefaults");

module.exports = {
  UPTHUE_STATUSES: catalog.UPTHUE_STATUSES,
  ensureUpthueConfigSeeded: catalog.ensureUpthueConfigSeeded,
  loadActiveUpthueCatalog: catalog.loadActiveUpthueCatalog,
  quoteUpthueOrder: catalog.quoteUpthueOrder,
  getGoiUpLabelFromOrder: catalog.getGoiUpLabelFromOrder,
  GOI_THOIGIAN: Object.fromEntries(
    legacy.LEGACY_TIME_PACKAGES.map((t, i) => [
      ["30ngay", "60ngay", "90ngay", "1nam"][i],
      { days: t.days, price: t.price },
    ]),
  ),
  EXTRA_BY_TIME: legacy.LEGACY_EXTRA_BY_DAYS,
};
