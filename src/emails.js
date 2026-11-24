// The two emails the signup flow sends. Each function returns a subject,
// an HTML body and a plain-text body. Edit the wording here.
//
// These are plain on purpose: one column, system fonts, no images. That
// keeps them readable in every mail client and out of the Promotions tab.

const WRAP = 'style="margin:0;padding:24px;background:#ffffff;color:#111417;font-family:Menlo,Consolas,monospace;font-size:15px;line-height:1.6"';
const BOX = 'style="max-width:560px;margin:0 auto"';
const MUTED = 'style="color:#4b535c;font-size:13px"';
const BUTTON = 'style="display:inline-block;padding:12px 20px;background:#f2b33d;color:#111417;text-decoration:none;font-weight:600"';

function page(inner) {
  return `<!doctype html><html lang="en"><body ${WRAP}><div ${BOX}>${inner}</div></body></html>`;
}

export function confirmationEmail(link) {
  return {
    subject: "Confirm your subscription to The 360 Brief",
    html: page(
      `<p><strong>DEFI360</strong></p>` +
      `<p>Someone, hopefully you, asked to receive The 360 Brief at this address.</p>` +
      `<p><a ${BUTTON} href="${link}">Confirm subscription</a></p>` +
      `<p>The link works for three days. If you did not ask for this, ignore this email and you will not hear from us again.</p>` +
      `<p ${MUTED}>If the button does not work, copy this address into your browser:<br>${link}</p>` +
      `<p ${MUTED}>The DeFi360 Desk</p>`
    ),
    text:
      `Someone, hopefully you, asked to receive The 360 Brief at this address.\n\n` +
      `Confirm your subscription by opening this link:\n${link}\n\n` +
      `The link works for three days. If you did not ask for this, ignore this email and you will not hear from us again.\n\n` +
      `The DeFi360 Desk\n`,
  };
}

export function welcomeEmail(siteUrl) {
  const sample = `${siteUrl}/issues/0.html`;
  return {
    subject: "You're subscribed to The 360 Brief",
    html: page(
      `<p><strong>DEFI360</strong></p>` +
      `<p>You're on the list. Thank you for subscribing.</p>` +
      `<p>The 360 Brief arrives every Friday: five things that moved on-chain finance that week, and what each one means for risk, yield and regulation.</p>` +
      `<p>While you wait for the first one, <a href="${sample}">read the sample issue</a>.</p>` +
      `<p>Add this address to your contacts so the brief reaches your inbox.</p>` +
      `<p ${MUTED}>Every issue carries an unsubscribe link. Information, not investment advice.</p>` +
      `<p ${MUTED}>The DeFi360 Desk</p>`
    ),
    text:
      `You're on the list. Thank you for subscribing.\n\n` +
      `The 360 Brief arrives every Friday: five things that moved on-chain finance that week, and what each one means for risk, yield and regulation.\n\n` +
      `While you wait for the first one, read the sample issue:\n${sample}\n\n` +
      `Add this address to your contacts so the brief reaches your inbox.\n\n` +
      `Every issue carries an unsubscribe link. Information, not investment advice.\n\n` +
      `The DeFi360 Desk\n`,
  };
}
