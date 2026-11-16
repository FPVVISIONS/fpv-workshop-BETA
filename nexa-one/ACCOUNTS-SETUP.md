# Real accounts with Supabase

By default the app keeps accounts on the phone only. With Supabase, accounts live
online: the same login works on any phone, and the password-reset and confirmation
emails are really sent. It takes about 15 minutes, and the free plan is enough.

> The app code is finished and tested against a **stand-in for Supabase** that I
> wrote from Supabase's documented API (33 checks through the real screens). I
> can't reach a real Supabase project from here, so **your first real sign-up is
> the real test.** The things most likely to go wrong are listed in §7.

## 1. Create the project

1. Go to **supabase.com**, sign up, and click **New project**.
2. Pick a name (for example `nexa-one`), a region close to you, and a strong
   database password (save it; the app never needs it).
3. Wait a minute or two until the project is ready.

## 2. Sign-in settings

*Authentication → Sign In / Providers* (the dashboard wording changes now and then):

- **Email** provider: on.
- **Confirm email**: **on** (recommended). The app handles it: after sign-up it
  says "we sent you a confirmation email" and moves to the sign-in screen. If you
  turn it off, people are signed in straight after sign-up.
- **Minimum password length:** 8 (the app already asks for 8, with a letter and a number).

*Authentication → URL Configuration:* set **Site URL** to any page you own (the
confirmation link sends people there afterwards; the app doesn't need it).

## 3. The reset-password email must contain the code

The app asks the user to type a **6-digit code**. Supabase's default reset email
contains a link instead. Change it:

*Authentication → Emails (Email Templates) → Reset Password*, replace the body with:

```html
<h2>Your NEXA ONE code</h2>
<p>Type this code in the app to choose a new password:</p>
<h1>{{ .Token }}</h1>
<p>If you didn't ask for this, ignore this email.</p>
```

Leave **Confirm signup** as it is: that one is a link, and the app tells people to click it.

## 4. One SQL function (for "delete my account")

*SQL Editor → New query*, paste the contents of **`supabase/setup.sql`**, click **Run**.
It lets a signed-in user delete only their own account.

## 5. Put your keys in the app

*Project Settings → API*. Copy:

- **Project URL** (`https://xxxxxxxx.supabase.co`)
- the **`anon` `public`** key

> **Never use the `service_role` key.** Anything inside an app can be extracted.
> The build script refuses that key.

Then build:

```bash
python3 build/build_apk.py --apk NEXA-ONE.apk \
    --keystore keys/release.p12 --storepass-file keys/release.pass \
    --supabase-url https://xxxxxxxx.supabase.co \
    --supabase-anon-key eyJ... \
    --out dist/NEXA-ONE-supabase.apk
```

(In the app's source project instead, put the two values in `public/nexa-config.js`.
The anon key is meant to be public.)

## 6. Try it

1. Install the APK, create an account with a **real email**, tap the link in the email.
2. Sign in. *Authentication → Users* in the dashboard now lists you.
3. Test **Forgot password**: you should get an email with a 6-digit code.
4. Sign in on a second phone with the same email and password.

## 7. If something doesn't work

| Symptom | Likely cause |
|---|---|
| "No connection to the server" immediately | The URL or key was pasted wrong; open `nexa-config.js` inside the APK build. The URL must start with `https://` |
| Reset email has a link, not a code | Step 3: the template doesn't contain `{{ .Token }}` |
| "Wrong code" for a code you just received | It expired (about an hour) or you requested a second one: use the newest |
| Confirmation email never arrives | Check spam. Supabase's built-in email sender is for testing and allows only a few emails per hour: use your own mail service (below) |
| Delete account says "something went wrong" | Step 4 wasn't run |
| Sign-in says "confirm your email" | The user hasn't clicked the link yet |

**For real users:** *Authentication → SMTP Settings* and connect an email service
(Resend, Brevo, and similar have free tiers). Otherwise Supabase's test sender
will block you quickly.

## 8. Safety and privacy

- The app never stores a password. Supabase stores a hash; the app stores a
  login token on the phone and refreshes it by itself. Signing out deletes it.
- The `anon` key is public by design. It can only do what the database rules
  allow; no tables are used yet, so there is nothing else to expose.
- You will be storing people's email addresses, so link the **terms and privacy
  policy** line on the sign-up screen to real pages before you publish.

## 9. Not included yet

- **Syncing the bottle's history to the account.** That needs a table and rules;
  say the word and I'll add it.
- Signing in with Google or Apple, and changing the email address.
