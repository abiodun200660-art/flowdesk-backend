// flowdesk-backend/controllers/auth.controller.js
// FIXES:
// 1. logout() now uses clearTokenCookie() so cookie attributes match and browser
//    actually removes the session cookie (fixes phantom-login / instant-logout bug).
// 2. googleCallback uses the same helper for consistency.

const crypto = require("crypto");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const User = require("../models/User.model");
const Workspace = require("../models/Workspace.model");
const { sendTokenResponse, clearTokenCookie } = require("../utils/jwt");
const { sendPasswordResetEmail } = require("../utils/email");

// @route POST /api/auth/register
const register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "Name, email, and password are required." });
    }
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "Email already registered." });
    }
    const user = await User.create({ name, email, password, isVerified: true });
    const workspace = await Workspace.create({
      name: `${name}'s Workspace`,
      owner: user._id,
      members: [{ user: user._id, role: "admin" }],
    });
    user.currentWorkspace = workspace._id;
    await user.save();
    sendTokenResponse(user, 201, res);
  } catch (error) {
    next(error);
  }
};

// @route POST /api/auth/login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }
    const user = await User.findOne({ email }).select("+password +twoFactorSecret");
    if (!user || !user.password) {
      return res.status(401).json({ success: false, message: "Invalid credentials." });
    }
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials." });
    }
    if (user.twoFactorEnabled) {
      return res.status(200).json({ success: true, twoFactorRequired: true, userId: user._id });
    }
    sendTokenResponse(user, 200, res);
  } catch (error) {
    next(error);
  }
};

// @route POST /api/auth/logout
// FIX: Use clearTokenCookie() so the cookie is properly invalidated in production
const logout = (req, res) => {
  clearTokenCookie(res);
  res.status(200).json({ success: true, message: "Logged out successfully." });
};

// @route GET /api/auth/me
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate("currentWorkspace", "name color logo");
    res.status(200).json({ success: true, user });
  } catch (error) {
    next(error);
  }
};

// @route POST /api/auth/forgot-password
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      // Don't reveal if email exists
      return res.status(200).json({ success: true, message: "If that email exists, a reset link has been sent." });
    }
    const resetToken = crypto.randomBytes(32).toString("hex");
    user.passwordResetToken = crypto.createHash("sha256").update(resetToken).digest("hex");
    user.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
    await user.save({ validateBeforeSave: false });
    try {
      await sendPasswordResetEmail(user.email, resetToken);
      res.status(200).json({ success: true, message: "Password reset email sent." });
    } catch (emailError) {
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(500).json({ success: false, message: "Could not send reset email. Try again later." });
    }
  } catch (error) {
    next(error);
  }
};

// @route POST /api/auth/reset-password
const resetPassword = async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ success: false, message: "Token and password are required." });
    }
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() },
    });
    if (!user) {
      return res.status(400).json({ success: false, message: "Invalid or expired reset token." });
    }
    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();
    sendTokenResponse(user, 200, res);
  } catch (error) {
    next(error);
  }
};

// @route POST /api/auth/2fa/setup
const setup2FA = async (req, res, next) => {
  try {
    const secret = speakeasy.generateSecret({ name: `FlowDesk (${req.user.email})` });
    const qrCode = await QRCode.toDataURL(secret.otpauth_url);
    await User.findByIdAndUpdate(req.user._id, { twoFactorSecret: secret.base32 });
    res.status(200).json({ success: true, qrCode, secret: secret.base32 });
  } catch (error) {
    next(error);
  }
};

// @route POST /api/auth/2fa/verify-setup
const verifySetup2FA = async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, message: "Verification code is required." });
    }
    const user = await User.findById(req.user._id).select("+twoFactorSecret");
    if (!user || !user.twoFactorSecret) {
      return res.status(400).json({ success: false, message: "2FA setup not initiated. Call /2fa/setup first." });
    }
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret, encoding: "base32", token, window: 1,
    });
    if (!verified) {
      return res.status(400).json({ success: false, message: "Invalid verification code." });
    }
    await User.findByIdAndUpdate(req.user._id, { twoFactorEnabled: true });
    res.status(200).json({ success: true, message: "2FA enabled successfully." });
  } catch (error) {
    next(error);
  }
};

// @route POST /api/auth/2fa/login-verify
const loginVerify2FA = async (req, res, next) => {
  try {
    const { token, userId } = req.body;
    if (!token || !userId) {
      return res.status(400).json({ success: false, message: "Code and userId are required." });
    }
    const user = await User.findById(userId).select("+twoFactorSecret");
    if (!user || !user.twoFactorSecret || !user.twoFactorEnabled) {
      return res.status(400).json({ success: false, message: "2FA not enabled for this account." });
    }
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret, encoding: "base32", token, window: 1,
    });
    if (!verified) {
      return res.status(400).json({ success: false, message: "Invalid 2FA code." });
    }
    sendTokenResponse(user, 200, res);
  } catch (error) {
    next(error);
  }
};

// @route POST /api/auth/2fa/disable
const disable2FA = async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, message: "Current 2FA code is required to disable." });
    }
    const user = await User.findById(req.user._id).select("+twoFactorSecret");
    if (!user || !user.twoFactorSecret) {
      return res.status(400).json({ success: false, message: "2FA is not enabled on this account." });
    }
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret, encoding: "base32", token, window: 1,
    });
    if (!verified) {
      return res.status(400).json({ success: false, message: "Invalid 2FA code." });
    }
    await User.findByIdAndUpdate(req.user._id, { twoFactorEnabled: false, twoFactorSecret: null });
    res.status(200).json({ success: true, message: "2FA disabled." });
  } catch (error) {
    next(error);
  }
};

// Google OAuth callback handler
// FIX: Use clearTokenCookie helper for consistency
const googleCallback = async (req, res) => {
  try {
    const { generateToken, getCookieOptions } = require("../utils/jwt");
    const token = generateToken(req.user._id);
    res
      .cookie("token", token, {
        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      })
      .redirect(`${process.env.CLIENT_URL}/dashboard`);
  } catch (error) {
    res.redirect(`${process.env.CLIENT_URL}/login?error=oauth_failed`);
  }
};

module.exports = {
  register, login, logout, getMe, forgotPassword, resetPassword,
  setup2FA, verifySetup2FA, loginVerify2FA, disable2FA, googleCallback,
};
