const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middlewares/auth.middleware');
const userController = require('../controllers/user.controller');
const { tb_vps_categoryModel } = require('../models/vpsphong');
const { getSiteSettings } = require('../utils/siteSettings');
const { getVpsExpiryNotifications } = require('../utils/vpsExpiryNotifications');

router.use(requireLogin);
router.use(async (req, res, next) => {
  try {
    res.locals.customerCategories = await tb_vps_categoryModel.find({ isHidden: { $ne: true } }).sort({ name: 1 }).lean();
    res.locals.supportSettings = await getSiteSettings();
    res.locals.expiryNotifications = await getVpsExpiryNotifications(res.locals.user._id);
  } catch (e) {
    res.locals.customerCategories = [];
    res.locals.supportSettings = { supportZaloUrl: '', supportFacebookUrl: '' };
    res.locals.expiryNotifications = [];
  }
  next();
});

router.get('/dashboard', userController.getDashboard);
router.get('/account', userController.getAccount);
router.post('/account/password', userController.postAccountPassword);
router.get('/chuyen-khoan', userController.getChuyenKhoan);
router.post('/withdraw', userController.postWithdraw);
router.post('/buy-vps', userController.postBuyVps);

router.get('/vps', userController.getMyVps);
router.post('/toggle-autorenew', userController.postToggleAutoRenew);
router.post('/renew', userController.postRenew);
router.post('/vps-action', userController.postVpsAction);

router.get('/history', userController.getHistory);
router.get('/logs', userController.getLogs);

module.exports = router;
