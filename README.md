# Covered

Warranty and document tracking for iOS and Android. Photograph a receipt and
Covered reads the shop, date, price and items off it, then warns you before the
cover runs out.

Made by [Plenum](https://plenum.gr).

## What it does

- **Warranties** — track what you own, when cover ends, and the receipt that proves it
- **Storage Room** — tickets, cards and documents, with their barcodes rendered large enough to scan
- **AI receipt scanning** — one free scan; unlimited on Pro
- **Backup** — to your own Google Drive, or to Covered's storage

## Layout

```
src/app/        expo-router screens
src/components/ shared UI, including the Liquid Glass primitives
src/lib/        platform and API wrappers
src/store/      React context stores (auth, items, storage, backup, settings)
modules/        local native modules (Quick Look)
worker/         Cloudflare Worker: auth, scan proxy, entitlements, storage
```

## Running it

```bash
npm install
npx expo start
```

The native modules mean Expo Go cannot run this — build to a device or simulator:

```bash
cd ios && pod install && cd ..
npx expo run:ios
```

## Notes for anyone picking this up

- **Read the versioned Expo docs** at https://docs.expo.dev/versions/v57.0.0/ before writing code. SDK 57 changed a great deal.
- **Never run two builds at once.** Xcode and a CLI `xcodebuild` on the same workspace corrupt the build database and produce `disk I/O error` or PIF transfer failures.
- **Bump `CURRENT_PROJECT_VERSION`** for every upload. App Store Connect rejects duplicate build numbers and will otherwise keep serving the previous binary.
- Secrets live only as Cloudflare Worker secrets. Nothing sensitive belongs in the app bundle.

See [PRIVACY.md](PRIVACY.md) for what the app collects.
