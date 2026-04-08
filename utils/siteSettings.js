const { tb_site_settingsModel } = require("../models/vpsphong");

async function getSiteSettings() {
  let doc = await tb_site_settingsModel.findOne().lean();
  if (!doc) {
    await tb_site_settingsModel.create({});
    doc = await tb_site_settingsModel.findOne().lean();
  }
  return doc;
}

module.exports = { getSiteSettings };
