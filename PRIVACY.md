# Covered — Privacy Policy

**Last updated: 20 August 2026**

Covered is made by Plenum, Mesogeion 109, Marousi 15126, Greece.
Questions: **support@plenum.gr**

This policy describes what Covered actually does with your data. Where the app
can work without collecting something, it does.

## What stays on your phone

Your warranties, stored files, receipts and photos live on your device. You can
use Covered without signing in at all — the app tracks items and reminds you
before cover ends with no account and nothing sent anywhere.

Reminders are scheduled locally by iOS. We do not run a notification server and
we do not know when a reminder fires.

## What we collect when you sign in

Signing in creates an account so scanning and backup can work. We store:

- **A stable account identifier** from Google or Apple
- **Your email address**, if the provider gives us one

If you use **Sign in with Apple** and choose *Hide My Email*, Apple gives us a
private relay address instead. We never receive your real address and cannot
work out what it is.

We do not collect your name, contacts, location, advertising identifiers or
device fingerprints. We do not use analytics or tracking SDKs, and Covered shows
no advertising.

## AI receipt scanning

When you scan a receipt, the image is sent to our server, which forwards it to
**Google Gemini** to read the shop, date, price and items. The image is
processed to produce that text and is **not retained** by us after the response
returns. It is not used to train any model.

The scan runs through our server so the API key never ships inside the app.

## Backups

Backup is optional and off until you turn it on. Two destinations exist:

**Your Google Drive.** Covered requests only the `drive.appdata` scope, which
grants access to a hidden folder that this app creates. We cannot see, list or
open any other file in your Drive. The data stays in your own account, and
removing Covered's access from your Google account removes ours.

**Covered's storage.** Items and attachments are stored on Google Cloud Storage
under your account identifier so they survive a lost phone and reach your other
devices.

Accounts signed in with Apple or Plenum SSO have no Google credential, so their
backups use Covered's storage.

## Purchases

Subscriptions are processed by **Apple**. We never see your payment details.
Purchase status is handled by **RevenueCat**, which tells our server whether your
subscription is active and when it expires. We record which account a
subscription belongs to, so that one subscription unlocks one account.

## Who else sees your data

Only the processors needed to run the features above:

| Service | Purpose |
|---|---|
| Google Gemini | Reading receipts you choose to scan |
| Google Cloud Storage | Storing backups, if enabled |
| Cloudflare | Running our server and database |
| RevenueCat | Subscription status |
| Apple | Payment processing |

We do not sell your data, share it for advertising, or disclose it to anyone
else except where the law requires it.

## Deleting everything

Settings → Delete Account removes your account, entitlements, backups and stored
files from our servers. It is immediate and cannot be undone. Data held in your
own Google Drive is yours to delete from Drive.

Deleting the app from your phone removes everything stored locally.

## Your rights

Under the GDPR you can ask us for a copy of your data, ask us to correct or
delete it, or object to how we use it. Write to **support@plenum.gr** and we
will respond within 30 days. You may also complain to the Hellenic Data
Protection Authority.

## Children

Covered is not directed at children under 13, and we do not knowingly collect
their data.

## Changes

If this policy changes materially we will update the date above and note the
change in the app before it takes effect.
