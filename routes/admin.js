const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middlewares/auth.middleware');
const adminController = require('../controllers/admin.controller');
const upthueSettingsController = require('../controllers/upthueSettings.controller');
const { getAdminBadgeCounts } = require('../utils/adminBadges');

router.use(requireAdmin);
router.use(async (req, res, next) => {
  try {
    res.locals.adminBadges = await getAdminBadgeCounts(res.locals.user);
  } catch (e) {
    console.error(e);
    res.locals.adminBadges = { fixRequests: 0, withdrawRequests: 0, upthue: 0, logs: 0 };
  }
  next();
});

router.get('/', adminController.getDashboard);
router.get('/vps', adminController.getVpsManager);
router.post('/vps/category/add', adminController.postAddCategory);
router.post('/vps/category/delete', adminController.postDeleteCategory);
router.post('/vps/add', adminController.postAddVps);
router.post('/vps/toggle', adminController.postToggleVps);
router.get('/vps/:id/edit', adminController.getEditVps);
router.post('/vps/:id/update', adminController.postUpdateVps);
router.get('/upthue/settings', upthueSettingsController.getSettings);
router.post('/upthue/settings/time-package/create', upthueSettingsController.postTimePackageCreate);
router.post('/upthue/settings/time-package/:id/update', upthueSettingsController.postTimePackageUpdate);
router.post('/upthue/settings/time-package/:id/toggle', upthueSettingsController.postTimePackageToggle);
router.post('/upthue/settings/server/create', upthueSettingsController.postServerCreate);
router.post('/upthue/settings/server/:id/update', upthueSettingsController.postServerUpdate);
router.post('/upthue/settings/server/:id/toggle', upthueSettingsController.postServerToggle);
router.post('/upthue/settings/option/create', upthueSettingsController.postOptionCreate);
router.post('/upthue/settings/option/:id/update', upthueSettingsController.postOptionUpdate);
router.post('/upthue/settings/option/:id/toggle', upthueSettingsController.postOptionToggle);

router.get('/upthue', adminController.getUpthueOrders);
router.post('/upthue/:id/status', adminController.postUpthueStatus);

router.get('/fix-requests', adminController.getFixRequests);
router.post('/fix-requests/:id/resolve', adminController.postResolveFixRequest);
router.get('/withdraw-requests', adminController.getWithdrawRequests);
router.post('/withdraw-requests/:id/approve', adminController.postApproveWithdraw);

router.get('/users', adminController.getUsersManager);
router.post('/users/adjust-balance', adminController.postAdjustUserBalance);
router.post('/users/toggle-lock', adminController.postToggleUserLock);
router.get('/users/:id', adminController.getUserDetail);
router.post('/users/:id/vps-rename', adminController.postRenameUserVps);

router.get('/logs', adminController.getAllLogs);

router.get('/settings/support', adminController.getSupportSettings);
router.post('/settings/support', adminController.postSupportSettings);

router.get('/settings/promo-modal', adminController.getPromoModal);
router.post('/settings/promo-modal', adminController.postPromoModal);

router.get('/vouchers', adminController.getVouchers);
router.post('/vouchers/add', adminController.postAddVoucher);
router.post('/vouchers/toggle', adminController.postToggleVoucher);
router.post('/vouchers/delete', adminController.postDeleteVoucher);

router.get('/backups', adminController.getBackups);
router.post('/backups/create', adminController.postCreateBackup);
router.get('/backups/:fileName/download', adminController.getDownloadBackup);

module.exports = router;
