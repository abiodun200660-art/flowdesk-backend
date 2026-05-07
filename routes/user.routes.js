const express = require("express");
const router = express.Router();
const { getProfile, updateProfile, updatePassword, uploadAvatar, switchWorkspace, deleteAccount } = require("../controllers/user.controller");
const { protect } = require("../middleware/auth.middleware");
const { uploadAvatar: avatarUpload } = require("../middleware/upload.middleware");

router.use(protect);

router.get("/profile", getProfile);
router.put("/profile", updateProfile);
router.put("/password", updatePassword);
router.post("/avatar", avatarUpload.single("avatar"), uploadAvatar);
router.put("/workspace", switchWorkspace);
router.delete("/account", deleteAccount);

module.exports = router;
