# Recovery Journal

A small personal journal for tracking sleep, knee recovery, activity, and pain
— one entry per day, filled in whenever you have a spare minute. Runs as a
static site on GitHub Pages, with [Supabase](https://supabase.com) as the
database.

## Concepts used in this project

A few terms come up repeatedly in the steps below — quick definitions before
you dive in:

- **Supabase**: a hosted service that gives you a real Postgres database plus
  a ready-made web API for it, so you can read/write data straight from
  JavaScript in the browser without writing your own server.
- **GitHub Pages**: a free feature of GitHub that serves the plain
  HTML/CSS/JS files in a repository as a website. It cannot run a server or
  hide secrets — anything in the repo is downloadable by anyone who visits
  the site. This is exactly why the database (Supabase) and the auth step
  below matter: the website itself has no way to keep data private on its
  own.
- **anon key**: a public API key for your Supabase project. It's meant to be
  visible in client-side code (it's in `config.js` in this project) — it
  only grants whatever your Row Level Security policies allow.
- **Row Level Security (RLS)**: a Postgres feature that checks a rule on
  every single read/write to a table. This project's rule is "you may only
  see or change rows that belong to you," which is what stops a stranger who
  finds your site's URL from reading or editing your entries even though the
  anon key is public.
- **Upsert**: "update if a matching row already exists, otherwise insert a
  new one." This is how the app keeps exactly one row per date even though
  you might save the same day's entry several times (morning, evening, etc.).

## What's in this folder

| File | Purpose |
|---|---|
| `index.html` | Page structure (login screen + journal form) |
| `style.css` | Light theme, layout, responsive rules |
| `app.js` | All app logic: auth, loading/saving entries, CSV export |
| `config.js` | Where you paste your own Supabase URL + anon key |
| `supabase-schema.sql` | Creates the database table and its security rules |

## Setup, step by step

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in (or create a free
   account).
2. Click **New project**. Pick any name and a database password (save the
   password somewhere — you likely won't need it again, but Supabase asks
   for it once).
3. Wait about a minute for the project to finish provisioning.

### 2. Create the database table

1. In your new project, open **SQL Editor** in the left sidebar.
2. Click **New query**.
3. Open `supabase-schema.sql` from this folder, copy its entire contents,
   and paste them into the query editor.
4. Click **Run**. You should see "Success. No rows returned." This has
   created the `journal_entries` table along with its security rules.

### 3. Create your login (no public sign-up)

Since this app is just for you, it skips a public "create account" page.
Instead, you create your one user directly in the dashboard:

1. Open **Authentication -> Users** in the left sidebar.
2. Click **Add user -> Create new user**.
3. Enter an email address and a password you'll remember, and make sure
   **Auto Confirm User** is switched on (so you don't need to click an email
   confirmation link).
4. Click **Create user**.

This email + password is what you'll type into the site's sign-in screen.

### 4. Get your API URL and key

1. Open **Project Settings** (gear icon) **-> Data API**.
2. Copy the **Project URL**.
3. Still on that page, copy the **anon** **public** key (not `service_role`
   — that one must never appear in client-side code).

### 5. Fill in `config.js`

Open `config.js` in this folder and replace the two placeholder strings:

```js
const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";
```

with the values you just copied.

### 6. Try it locally (optional but recommended)

Browsers block some features (like this app's login) when you open an HTML
file directly with `file://`. Serve the folder over `http://localhost`
instead — for example, from a terminal in this folder:

```bash
python3 -m http.server 8000
```

then visit `http://localhost:8000` and sign in with the email/password from
step 3. If it works locally, it'll work once deployed too.

### 7. Push this folder to GitHub

1. Create a new repository on GitHub (public — GitHub Pages on a free plan
   requires the repository to be public; see the security note below on why
   that's fine here).
2. From inside this folder:

```bash
git init
git add .
git commit -m "Recovery journal"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

### 8. Turn on GitHub Pages

1. In the repository on GitHub, go to **Settings -> Pages**.
2. Under **Build and deployment -> Source**, choose **Deploy from a
   branch**.
3. Under **Branch**, choose `main` and folder `/ (root)`, then **Save**.
4. After a minute, the same page will show your site's URL
   (`https://YOUR-USERNAME.github.io/YOUR-REPO/`).

### 9. Use it

Visit your GitHub Pages URL on your laptop or iPhone, sign in, and you're
in. Add the page to your iPhone home screen (Share -> Add to Home Screen)
for quick access — it'll open full-screen like a regular app.

## How it works

- **One row per day**: every save is an upsert keyed on (your user id, the
  selected date). Open the journal in the morning and log sleep; open it
  again at night and log the knee/workout fields — both saves land on the
  same row instead of creating duplicates.
- **Partial entries are fine**: fields you haven't touched are saved as
  empty rather than as a default value like 0, so a pain slider you never
  touched today is stored as "no answer," not "no pain."
- **Date navigation**: the ‹ › arrows and the date field at the top move
  between days; the form reloads whatever was saved for that day (or a
  blank form if nothing was saved yet).
- **Export**: pick a From/To date under "Export data" and click "Download
  CSV" to get a spreadsheet-ready file of everything in that range.

## A note on security

GitHub Pages sites are public on the internet by default (a free GitHub
account can only publish Pages from a public repository, and even a paid
plan's "private" Pages site is still reachable by anyone with the URL) — so
the sign-in screen is doing real work here, not just decoration. Because
the table uses Row Level Security tied to your logged-in user, someone who
finds your URL and even reads the anon key out of the page source still
cannot see or modify your entries without your password. Two things worth
keeping in mind:

- Choose a real password for the user you created in step 3 — it's the one
  thing standing between your entries and the public internet.
- Don't add a public sign-up form to this app. As built, new accounts can
  only be created by you, from the Supabase dashboard.

## Assumptions made while building this

A few of the fields you listed didn't specify an exact input type or scale,
so reasonable defaults were picked. All of these are quick to change if you
want something different — the code is organized so each field's markup
(`index.html`), styling (`style.css`), and logic (`app.js`) can be edited on
its own:

- **Sleep quality**: a 1–5 scale (no scale was specified).
- **Workout**: a free-text field (e.g. "run 5k", "gym", "rest day"), since
  intensity is captured separately.
- **Wrist pain**: a 0–10 slider, matching hamstring pain's scale.
- **Knee status**: a short single-line text field; **Issues with knee**: a
  multi-line text area, for more detail.
- **Work / school / sitting hours**: sliders in half-hour steps (0–12).

## Ideas for later (not built yet)

- A weekly/summary view instead of one day at a time.
- Simple charts (e.g. pain trend over time) using the exported CSV.
- Reminder notifications to log an entry.
