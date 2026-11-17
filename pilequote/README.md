# PileQuote

Instant photo quotes for junk removal companies.

A hauler puts their PileQuote link on their website, Google listing or Facebook page. Their customer snaps photos of the junk. AI estimates how much of the truck it fills, the app prices it from the **hauler's own price sheet**, and the customer requests a pickup. The hauler gets the photos, price, address and phone number by email (and text, once texting is set up).

Haulers pay $49/month after a 14-day free trial (no card needed for the trial).

- **Call script for selling it:** [CALL-SCRIPT.md](CALL-SCRIPT.md)
- **Demo page to show prospects:** `/q/demo` on your live site

## What's built

| Page | Who it's for | What it does |
|---|---|---|
| `/` | Haulers | Sales page with a "try it with a photo" demo |
| `/signup` | Haulers | Sign up with their prices; starts the 14-day trial |
| `/q/<company>` | Their customers | Photo upload → price range → pick a day and time → pickup request |
| `/dash` | Haulers | Leads with photos, call/text buttons, status; quote link + QR code |
| `/dash/settings` | Haulers | Prices, item fees, truck size, work days, time windows, alerts, password |
| `/dash/billing` | Haulers | Add a card (Stripe Checkout), manage or cancel (Stripe portal) |
| `/admin` | You | Every company, its status and leads; open any dashboard; extend trials; reset passwords; AI spend |

Every customer who asks for a price leaves a name and phone number first (owners can turn this off), so haulers can call back people who don't book. If the AI fails, the lead is still saved and the owner is still alerted.

---

## Go live (about 30 minutes)

Do steps 1 and 2 first so you have the keys ready for step 3.

### 1. Anthropic API key (5 minutes, about $5)

1. Go to **console.anthropic.com** and sign up.
2. **Billing**: add $5 of credit.
3. **API keys** → **Create key**. Copy it (starts with `sk-ant-`). You only see it once.

**Cost:** each quote is one AI call on Claude Opus 5.5. My estimate is roughly **3–10 cents per quote** (2–3 photos plus the AI's reasoning). The admin page shows what you actually spend. At 100 quotes a month, a hauler costs you about $3–10 against $49 of revenue. A cheaper model (`AI_MODEL=claude-haiku-5-5`) costs a small fraction of that but may be less accurate; test before switching.

### 2. Gmail for sending alerts (5 minutes, free)

Use a new Gmail account just for the app, not your personal one.

1. In that Google account, turn on **2-Step Verification** (Google Account → Security).
2. Go to **myaccount.google.com/apppasswords**, create an app password named "PileQuote", and copy the 16 characters.

Gmail allows a few hundred emails a day, which is plenty to start.

### 3. Put it online with Render (10 minutes, about $7.25/month)

1. Go to **render.com** and sign up with your GitHub account. Let it see the `money` repository.
2. **New +** → **Blueprint** → pick the `money` repo. Pick the branch with this code (`ccr-f6065e33-t0ktee`, or `main` once it's merged). Render reads `render.yaml` from the repo.
3. Fill in the values it asks for:
   - `ANTHROPIC_API_KEY`: from step 1
   - `ADMIN_PASSWORD`: make up a long password for your `/admin` page
   - `ADMIN_EMAIL`: your email. Demo-page leads and "new signup" notices go here.
   - `SMTP_USER`: the Gmail address from step 2
   - `SMTP_PASS`: the 16-character app password from step 2
4. Click **Apply** and wait 3–5 minutes. Render shows your address, something like `https://pilequote-xxxx.onrender.com`.
5. Open `https://<your address>/admin` and log in. The badges at the top should say **AI estimates: on** and **Email: on**.
6. Open `/q/demo` on your phone and quote 10 real piles (your garage, a neighbor's curb). Check the numbers make sense **before** you show it to haulers.

The plan is Render's Starter instance ($7/month) plus a 1 GB disk (about $0.25/month). The disk is what keeps companies, leads and photos when the app restarts. Free instances lose their files on restart, so don't use one.

**If the Blueprint gives an error**, create the service by hand instead: **New +** → **Web Service** → pick the repo and branch, then set:
- Root Directory: `pilequote`
- Build Command: `npm ci`
- Start Command: `npm start`
- Instance type: Starter
- **Disks** → Add disk: mount path `/var/data`, size 1 GB
- **Environment**: `NODE_VERSION=22.23.4`, `DATA_DIR=/var/data`, `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, plus the five values from step 3.

### 4. Turn on billing with Stripe (when your first hauler wants to keep it)

Trials don't need a card, so you can skip this until someone's trial is close to ending.

1. Create a **Stripe** account and activate payments (business details and a bank account).
2. **Product catalog** → **Add product**: "PileQuote", **recurring**, $49 per month. Save, then copy the **Price ID** (`price_…`).
3. **Developers** → **API keys**: copy the **Secret key** (`sk_live_…`).
4. **Developers** → **Webhooks** → **Add endpoint**:
   - URL: `https://<your address>/stripe/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Copy the **Signing secret** (`whsec_…`).
5. **Settings** → **Billing** → **Customer portal**: save the default settings. This page is where haulers update their card or cancel.
6. In Render → your service → **Environment**, add `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` and `STRIPE_WEBHOOK_SECRET`, then save. The app restarts.

The **Add card** button on each hauler's Billing page now works. A hauler who adds a card during the trial isn't charged until the trial ends. When a trial ends without a card, their quote page shows their phone number instead of quotes, until they subscribe.

To try it without real money first, use Stripe's **test mode** keys and the card number `4242 4242 4242 4242`.

### 5. Text alerts (optional, later)

The app can text owners through **Twilio** (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`). US carriers require business texting to be registered first (A2P 10DLC or toll-free verification), which takes days to weeks and has fees. Until then owners get email alerts, which most people see on their phone right away.

---

## Signing up a hauler during a call

1. Log in to `/admin` and click **Sign up a new company**.
2. Enter their business name, their email, a temporary password, phone, truck size and prices. Click **Create my quote link**.
3. You're now looking at their dashboard. Copy their quote link and text it to them with their email and temporary password. They can change both under **Settings**.
4. Their 14-day trial starts now. Use **+14 days** on the admin page if they need longer.

## How the price is worked out

1. The hauler sets prices for a minimum load, 1/4, 1/2, 3/4 and a full truck. Eighths in between are halfway.
2. The AI looks at the photos and reports the items and a low-to-high **volume** in cubic yards. It never sets a price.
3. The app turns volume into truck eighths using the hauler's truck size. The low end rounds to the nearest eighth and the high end rounds up. Anything under 1/16 of a truck is the minimum charge; more than a truck is full loads plus the rest.
4. Per-item fees (mattresses, fridges/freezers/AC units, TVs, tires, pianos, hot tubs) are added to both ends.
5. The customer sees the range and a note that the final price is confirmed on site.

If the photos don't show anything haulable or are too dark, the customer is asked for a better photo instead of getting a guess. Heavy materials (concrete, dirt, shingles) and items the hauler doesn't take are flagged to both the customer and the owner.

## Settings you can change (environment variables)

| Variable | What it does |
|---|---|
| `ANTHROPIC_API_KEY` | Turns on real AI estimates. Without it the app runs in **demo mode** with simulated estimates, clearly labeled. |
| `AI_MODEL` | Default `claude-opus-5-5`. |
| `AI_EFFORT` | Default `medium`. `low` is faster and cheaper; `high` thinks harder. |
| `ADMIN_PASSWORD` | Password for `/admin`. The admin page is off without it. |
| `ADMIN_EMAIL` | Where demo-page leads and new-signup notices go. |
| `SUPPORT_EMAIL` | Shown in the footer and on the login page. |
| `APP_URL` | Your public address. Render sets this automatically; set it yourself if you add a custom domain. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Outgoing email. Without them, emails are saved to `DATA_DIR/outbox/` instead. |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` | Billing. |
| `PRICE_LABEL`, `MONTHLY_PRICE` | What the site *says* the price is (`$49/month`, `49`). The real charge is your Stripe price. |
| `TRIAL_DAYS` | Free trial length. Default 14. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Text alerts. |
| `DATA_DIR` | Where the database and photos live. `/var/data` on Render. |
| `APP_NAME` | Product name shown everywhere. Default `PileQuote`. |
| `LIMIT_ESTIMATES_PER_IP_HOUR`, `LIMIT_ESTIMATES_PER_IP_DAY`, `LIMIT_ESTIMATES_PER_COMPANY_DAY`, `LIMIT_ESTIMATES_PER_DAY` | Caps that protect your AI bill from abuse. Defaults 12, 40, 200, 2000. |

## Run it on your own computer

You need Node.js 22.13 or newer.

```bash
cd pilequote
npm install
npm start          # http://localhost:3000, demo mode unless ANTHROPIC_API_KEY is set
```

## Tests

```bash
npm test           # pricing and estimate-cleanup unit tests
npm run test:e2e   # full flow in a headless browser against fake AI, Stripe and Twilio servers (needs Playwright)
```

The end-to-end test covers: sign-up, settings, a customer quote on a phone screen, the request sent to the AI, booking, owner emails with photos, texts, the lead dashboard, private photo links, CSRF protection, bad photos, AI failure, Stripe checkout and webhooks (including out-of-order events), trial expiry, the admin page, login, HTML escaping and 404s. Screenshots go to `test-output/`.

## Known limits

- **The AI's accuracy hasn't been measured on real photos yet.** The tests use a fake AI, so test it on real piles (step 3.6) before you demo it. Likely weak spots: piles that are partly hidden, unclear scale, and dense materials.
- One server with a SQLite database on the disk. That's fine for hundreds of haulers but can't run on several servers at once.
- No "forgot password" email. Owners ask you, and you reset it from `/admin`.
- Photos are kept on the disk (about 150–300 KB each). A 1 GB disk holds several thousand quotes; make it bigger in Render when needed.
- The Privacy and Terms pages are plain-language placeholders. Have them reviewed.
- Customer photos are sent to Anthropic's API for analysis. The privacy page says so.
