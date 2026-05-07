const nodemailer = require("nodemailer");

const createTransporter = () => {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};

const sendEmail = async ({ to, subject, html, text }) => {
  try {
    const transporter = createTransporter();
    const info = await transporter.sendMail({
      from: `"FlowDesk" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
      text,
    });
    return info;
  } catch (error) {
    console.error("Email send error:", error.message);
    throw error;
  }
};

const sendPasswordResetEmail = async (email, resetToken) => {
  const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #6366f1;">FlowDesk Password Reset</h2>
      <p>You requested a password reset. Click the button below to reset your password.</p>
      <p>This link expires in 10 minutes.</p>
      <a href="${resetUrl}" style="
        display: inline-block;
        background: #6366f1;
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        text-decoration: none;
        margin: 16px 0;
      ">Reset Password</a>
      <p style="color: #666;">If you didn't request this, ignore this email.</p>
      <hr />
      <p style="color: #999; font-size: 12px;">FlowDesk — Your team productivity platform</p>
    </div>
  `;
  return sendEmail({ to: email, subject: "FlowDesk — Password Reset Request", html });
};

const sendWorkspaceInviteEmail = async (email, inviterName, workspaceName, inviteToken) => {
  const inviteUrl = `${process.env.CLIENT_URL}/invite?token=${inviteToken}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #6366f1;">You've been invited to FlowDesk</h2>
      <p><strong>${inviterName}</strong> has invited you to join <strong>${workspaceName}</strong> on FlowDesk.</p>
      <a href="${inviteUrl}" style="
        display: inline-block;
        background: #6366f1;
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        text-decoration: none;
        margin: 16px 0;
      ">Accept Invitation</a>
      <p style="color: #666;">This invite expires in 48 hours.</p>
      <hr />
      <p style="color: #999; font-size: 12px;">FlowDesk — Your team productivity platform</p>
    </div>
  `;
  return sendEmail({ to: email, subject: `${inviterName} invited you to ${workspaceName} on FlowDesk`, html });
};

const sendWeeklyDigestEmail = async (email, name, summary) => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #6366f1;">Your Weekly FlowDesk Summary</h2>
      <p>Hi ${name},</p>
      <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 16px 0;">
        ${summary}
      </div>
      <a href="${process.env.CLIENT_URL}/dashboard" style="
        display: inline-block;
        background: #6366f1;
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        text-decoration: none;
        margin: 16px 0;
      ">Open FlowDesk</a>
      <hr />
      <p style="color: #999; font-size: 12px;">To unsubscribe from weekly digests, update your notification preferences in settings.</p>
    </div>
  `;
  return sendEmail({ to: email, subject: "Your Weekly FlowDesk Summary", html });
};

module.exports = {
  sendEmail,
  sendPasswordResetEmail,
  sendWorkspaceInviteEmail,
  sendWeeklyDigestEmail,
};
