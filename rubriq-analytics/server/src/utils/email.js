const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.hostinger.com',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendWelcomeEmail({ firstName, lastName, email, password, role }) {
  const roleLabel = { FACULTY: 'Faculty', HOD: 'Head of Department', STUDENT: 'Student', REVIEWER: 'External Reviewer' }[role] || role;
  const loginUrl = process.env.CLIENT_URL || 'https://www.rubriq.swapnilgorde.com';

  await transporter.sendMail({
    from: `"RubriQ Analytics" <${process.env.SMTP_USER}>`,
    to: email,
    subject: 'Your RubriQ Analytics Account is Ready',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #0f2035, #1a2f4a); padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 22px;">RubriQ Analytics</h1>
          <p style="color: #94a3b8; margin: 4px 0 0; font-size: 13px;">Academic Assessment Platform</p>
        </div>
        <div style="background: #f8fafc; padding: 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
          <h2 style="color: #1e293b; margin: 0 0 8px;">Welcome, ${firstName}!</h2>
          <p style="color: #64748b; margin: 0 0 24px;">Your account has been created successfully. Here are your login details:</p>
          <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 8px 0; color: #64748b; font-size: 13px; width: 120px;">Portal URL</td><td style="padding: 8px 0; font-weight: bold;"><a href="${loginUrl}" style="color: #2563eb;">${loginUrl}</a></td></tr>
              <tr><td style="padding: 8px 0; color: #64748b; font-size: 13px;">Email</td><td style="padding: 8px 0; font-weight: bold;">${email}</td></tr>
              <tr><td style="padding: 8px 0; color: #64748b; font-size: 13px;">Password</td><td style="padding: 8px 0; font-weight: bold; font-family: monospace; background: #f1f5f9; padding: 4px 8px; border-radius: 4px;">${password}</td></tr>
              <tr><td style="padding: 8px 0; color: #64748b; font-size: 13px;">Role</td><td style="padding: 8px 0;"><span style="background: #dbeafe; color: #1d4ed8; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600;">${roleLabel}</span></td></tr>
            </table>
          </div>
          <p style="color: #ef4444; font-size: 13px; margin: 0 0 24px;">⚠️ Please login and change your password immediately.</p>
          <a href="${loginUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px;">Login to RubriQ Analytics</a>
          <p style="color: #94a3b8; font-size: 12px; margin: 24px 0 0;">This is an automated message. Please do not reply to this email.</p>
        </div>
      </div>
    `,
  });
}

module.exports = { sendWelcomeEmail };
