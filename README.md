# defi360

Code and content for [defi360.news](https://defi360.news): a briefing on on-chain finance for readers who think in traditional-finance terms.

## Layout

| Folder | Holds |
| --- | --- |
| `site/` | The public site and tracker pages, served as static files by the Cloudflare Worker |
| `src/` | The Worker script: the signup API and the emails it sends |
| `test/` | Tests for the Worker (`npm test`) |
| `pipeline/` | Scheduled jobs that collect sources, tag items by topic and draft issues |
| `content/issues/` | Drafts and sent issues of The 360 Brief |
| `docs/` | Editorial rules, source list, working notes |

## How we work

Two-week sprints, one shipped outcome per sprint. Stories are GitHub issues tracked on the project board.

## Newsletter sign-up

The form on the home page posts to the Worker, which uses [Resend](https://resend.com) to send email and hold the subscriber list. Sign-up is double opt-in:

1. `POST /api/subscribe` checks the address and emails a confirmation link. Nothing is stored yet.
2. `GET /api/confirm` checks the link, adds the contact in Resend and sends the welcome email.

The link carries the address, an expiry day and a signature, so there is no database. Wording of both emails is in `src/emails.js`.

### Settings

| Name | Kind | Purpose |
| --- | --- | --- |
| `RESEND_API_KEY` | Secret, required | Resend API key with full access |
| `SIGNING_SECRET` | Secret, required | Any long random string; signs the confirmation links |
| `SITE_URL` | Variable, in `wrangler.jsonc` | Base address used in email links |
| `FROM_ADDRESS` | Variable, in `wrangler.jsonc` | Sender shown on the emails |
| `REPLY_TO` | Variable, optional | Address that receives replies. The sending domain cannot receive mail |
| `RESEND_SEGMENT_ID` | Variable, optional | Resend segment to add each new subscriber to |

Add the two secrets in the Cloudflare dashboard (Workers & Pages > defi360 > Settings > Variables and Secrets) or with `npx wrangler secret put NAME`. Until both are set, the form answers "not available right now" and sends nothing.

### Run it locally

```
printf 'RESEND_API_KEY=...\nSIGNING_SECRET=...\n' > .dev.vars   # not committed
npx wrangler dev
npm test
```

### Abuse limits

A hidden field catches simple bots, posts from other sites are refused, and Resend sends at most one confirmation per address per day. There is no per-visitor rate limit yet; add a Cloudflare rate limiting rule on `/api/subscribe` before promoting the site widely.
