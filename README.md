# To My Future Self

Save today. Revisit tomorrow. Create digital time capsules with photos, letters, videos, music, and snapshots of life right now.

## Run it

Open `index.html` in a modern browser for the local time-capsule features, or serve this folder with any static web server. No build step is required. Friend letters need the Supabase setup below and must be served from an allowed HTTP or HTTPS address.

## How it works

- Use separate pages for letters, photo and video memories, and "My Life Right Now" snapshots.
- Write a letter or journal entry, attach photos, videos, or audio files, and choose an unlock date.
- Letters and journal entries are private by default. You can opt in to sharing, then use the device share sheet or copy the text once the letter unlocks. Nothing is sent unless you choose to share it.
- Pick a suggested date such as one month, one year, five years, an 18th or 21st birthday, or graduation. Birthday and graduation dates are entered by you.
- Save periodic "My Life Right Now" snapshots with prompts about how you feel, where you are, and what you are looking forward to.
- Capsules remain locked until their chosen date, then become readable from the capsule list.
- Search and filter your saved capsules, and delete them when you no longer need them.
- Content and media are stored in this browser using IndexedDB. They are not uploaded or synced, so they remain on this browser and device unless you explicitly share letter text using your device.
- Add friends by email, accept friend requests, and schedule letters for accepted friends. Recipients cannot query a letter until its unlock time; an email notice is sent at that time.

## Friend letters setup

Friend letters are shared across accounts and use Supabase Auth, Postgres row-level security, Supabase Edge Functions, and Resend for unlock notices. Until configured, the Friends page displays setup instructions; local capsules continue to work independently.

1. Create a Supabase project and run [`supabase/migrations/20261126180000_friend_letters.sql`](./supabase/migrations/20261126180000_friend_letters.sql) in its SQL Editor.
2. Copy your project URL and public anon/publishable key into [`supabase-config.js`](./supabase-config.js). The anon key is intended for browser use; the database policies protect the letter content. Never put a service-role key in this file.
3. Configure Supabase Auth email sign-in and add your deployed site URL (and local development URL, if used) to the allowed redirect URLs.
4. Deploy the unlock-notification function: `supabase functions deploy notify-unlocked --project-ref YOUR_PROJECT_REF`.
5. Add the Resend API key, a verified sender address, and your website URL as Edge Function secrets: `supabase secrets set RESEND_API_KEY=YOUR_RESEND_KEY RESEND_FROM_EMAIL="To My Future Self <letters@example.com>" APP_URL=https://YOUR_SITE_URL --project-ref YOUR_PROJECT_REF`. Supabase supplies the function URL and service-role key automatically.
6. Enable the Supabase `pg_cron`, `pg_net`, and Vault extensions. In the SQL Editor, run [`supabase/schedule-notifications.sql`](./supabase/schedule-notifications.sql) after replacing its project URL and service-role key placeholders. The schedule calls the protected function every minute. Keep the service-role key in Supabase Vault; never commit it.

Friend invitations use Supabase email sign-in links. The unlock email contains only a link back to the site, not the letter. Letter text is displayed in the recipient’s account only after the database unlock time.
