const express = require("express");
const router = express.Router();
const passport = require("../config/passport");
const {
  register, login, logout, getMe,
  forgotPassword, resetPassword,
  setup2FA, verifySetup2FA, loginVerify2FA, disable2FA,
  googleCallback,
} = require("../controllers/auth.controller");
const { protect } = require("../middleware/auth.middleware");
const { authLimiter } = require("../middleware/rateLimit.middleware");

router.post("/register", authLimiter, register);
router.post("/login", authLimiter, login);
router.post("/logout", logout);
router.get("/me", protect, getMe);
router.post("/forgot-password", authLimiter, forgotPassword);
router.post("/reset-password", authLimiter, resetPassword);

// 2FA — three separate, unambiguous routes
router.post("/2fa/setup", protect, setup2FA);               // Step 1: generate QR (authenticated)
router.post("/2fa/verify-setup", protect, verifySetup2FA);  // Step 2: confirm + enable (authenticated)
router.post("/2fa/login-verify", authLimiter, loginVerify2FA); // Login step: verify code + issue token (unauthenticated)
router.post("/2fa/disable", protect, disable2FA);           // Disable 2FA (authenticated)

// Google OAuth
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));
router.get(
  "/google/callback",
  passport.authenticate("google", { session: false, failureRedirect: `${process.env.CLIENT_URL}/login?error=oauth_failed` }),
  googleCallback
);

module.exports = router;
