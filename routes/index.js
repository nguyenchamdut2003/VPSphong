const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const homeController = require('../controllers/home.controller');

router.get('/', homeController.getHome);

// Auth
router.get('/login', authController.getLogin);
router.post('/login', authController.postLogin);
router.get('/register', authController.getRegister);
router.post('/register', authController.postRegister);
router.get('/logout', authController.logout);

module.exports = router;
