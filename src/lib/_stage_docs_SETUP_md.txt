# Setup guide

End-to-end instructions for getting `stfc-gift-redeemer` running on your fork
of this repository.

## Prerequisites

- A Scopely account that you log in to the STFC web store with.
- A fork (or clone) of this repository on GitHub with Actions enabled.

## Step-by-step

1. Open `https://home.startrekfleetcommand.com/store` in a normal browser
   (Chrome, Firefox, Edge — anything with DevTools).
2. **Log in normally** with your Scopely account. Wait until the store fully
   loads and you can see your inventory / offers.
3. Open browser DevTools (`F12` on most browsers) and switch to the **Console**
   tab.
4. Open [`docs/BOOKMARKLET.md`](BOOKMARKLET.md) and **paste the snippet** into
   the Console, then press Enter.
5. The script scans `localStorage` (and `sessionStorage`) for any JWT-shaped
   tokens, validates each one against the STFC store API
   (`GET /auth/me`), and copies the first one that returns **200 OK** to your
   clipboard. You should see an `alert()` popup that says
   `Copied valid token to clipboard. Expires <date>`. If it says no valid
   token was found, make sure you're actually logged in and try again.
6. In your repo on GitHub, go to **Settings → Secrets and variables → Actions
   → New repository secret**.
7. **Name:** `STFC_ACCOUNTS`. **Value:** paste the following JSON, replacing
   `<JWT>` with the token your clipboard now contains:

   ```json
   [{"name":"main","token":"<JWT>"}]
   ```

   For multiple accounts, repeat steps 1–5 in a **different browser profile**
   (so cookies don't collide) and add more entries to the array:

   ```json
   [
     {"name":"main", "token":"<JWT-1>"},
     {"name":"alt",  "token":"<JWT-2>"}
   ]
   ```

8. Go to your repo's **Actions** tab and click **I understand my workflows,
   go ahead and enable them** if prompted.
9. Find the **Redeem gifts** workflow, click **Run workflow**, and trigger it
   manually once to verify everything works. The job summary should list
   what was claimed and any tokens that need re-capture.
10. From now on the cron schedule runs **every 4 hours** automatically. The
    job summary on each run shows what was claimed, which codes were already
    used, and any tokens that have expired.

## Troubleshooting

### `STFC_ACCOUNTS not valid JSON`
Make sure you pasted **raw JSON** into the secret value, with no surrounding
quotes and no leading/trailing whitespace. The value should start with `[`
and end with `]`. GitHub does not parse the secret — it just stores the
exact bytes you give it.

### `token is not JWT-shaped`
A JWT has exactly three base64url segments separated by `.` (e.g.
`eyJhbGciOi...eyJpc3M...SflKxw...`). If you see this error you most likely
copied the wrong value (a session cookie, a refresh token, a UUID, etc).
Re-run the bookmarklet from [BOOKMARKLET.md](BOOKMARKLET.md) — it
specifically validates each candidate against `/auth/me` before copying, so
the result is guaranteed to be a JWT the API accepts.

### `TOKEN_EXPIRED` outcome on a run
Your stored JWT's `exp` claim is in the past. Re-run the bookmarklet in a
freshly logged-in browser session, then update the `STFC_ACCOUNTS` secret
with the new JWT (you can edit the existing secret — paste the entire JSON
array again with the updated `token` field). Other accounts in the array
are unaffected and continue to run normally.

### Workflow doesn't run on schedule
GitHub Actions disables scheduled workflows on forks after **60 days of
repo inactivity**. Just push a commit (or click **Run workflow** manually)
to wake it up.
