const { tb_userModel } = require("../models/vpsphong");

module.exports.requireLogin = async (req, res, next) => {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  try {
    const user = await tb_userModel.findById(req.session.userId);
    if (!user) {
      // Session invalid, redirect
      return res.redirect('/login');
    }
    if (!user.isActive) {
      // Customer is blocked
      return res.render('error', { message: 'Tài khoản của bạn đã bị khóa bởi người quản trị.', error: { status: 403 } });
    }
    // Inject user info to locals so EJS can read it everywhere
    res.locals.user = user;
    next();
  } catch (err) {
    console.log(err);
    res.redirect('/login');
  }
};

module.exports.requireAdmin = async (req, res, next) => {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  try {
    const user = await tb_userModel.findById(req.session.userId);
    // Role must be admin
    if (!user || user.role !== 'admin') {
      return res.render('error', { message: 'Lỗi quyền truy cập: Bạn không phải Admin.', error: { status: 403 } });
    }
    res.locals.user = user;
    next();
  } catch (err) {
    console.log(err);
    res.redirect('/login');
  }
};
