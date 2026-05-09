// flowdesk-backend/utils/jwt.js
// FIXED: logout() now clears the cookie with matching sameSite + secure attributes.
// Without matching attributes, the browser ignores the clear instruction and the
// cookie stays alive — causing the user to appear still logged in then get a 401
// and be kicked back to login immediately.

const jwt = require("jsonwebtoken");

const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
};

// Shared helper so login and logout use IDENTICAL cookie options
// (browser only clears a cookie if the attributes match exactly)
const getCookieOptions = (expires) => ({
  expires,
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
});

const sendTokenResponse = (user, statusCode, res) => {
  const token = generateToken(user._id);

  // Remove sensitive fields
  const userObj = user.toObject ? user.toObject() : { ...user };
  delete userObj.password;
  delete userObj.twoFactorSecret;
  delete userObj.passwordResetToken;
  delete userObj.passwordResetExpires;

  res
    .status(statusCode)
    .cookie("token", token, getCookieOptions(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)))
    .json({ success: true, token, user: userObj });
};

// FIX: clearTokenCookie must use SAME sameSite + secure as sendTokenResponse,
// otherwise the browser will NOT remove the cookie and the session lingers.
const clearTokenCookie = (res) => {
  res.cookie("token", "", getCookieOptions(new Date(0)));
};

const verifyToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET);
};

module.exports = { generateToken, sendTokenResponse, clearTokenCookie, verifyToken };
