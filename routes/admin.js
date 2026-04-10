const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middlewares/auth.middleware');
const adminController = require('../controllers/admin.controller');

router.use(requireAdmin);

router.get('/', adminController.getDashboard);
router.get('/vps', adminController.getVpsManager);
router.post('/vps/category/add', adminController.postAddCategory);
router.post('/vps/category/delete', adminController.postDeleteCategory);
router.post('/vps/add', adminController.postAddVps);
router.post('/vps/toggle', adminController.postToggleVps);
router.get('/vps/:id/edit', adminController.getEditVps);
router.post('/vps/:id/update', adminController.postUpdateVps);
router.get('/fix-requests', adminController.getFixRequests);
router.post('/fix-requests/:id/resolve', adminController.postResolveFixRequest);

router.get('/users', adminController.getUsersManager);
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

module.exports = router;
