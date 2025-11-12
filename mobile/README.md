# Arise Mobile (Expo)

This Expo React Native project consumes the same Express API and auth flow that power the `web/` SPA. Shared networking code lives in `../shared/api-client`, so both clients stay in sync with minimal duplication.

## Getting started

```bash
cd mobile
cp .env.example .env                # set EXPO_PUBLIC_API_BASE to your server URL
npm install
npm run android                     # opens the Expo dev client + Android emulator
```

Use `npm run ios` (requires macOS) or `npm run web` for a quick web preview inside Expo Go.

`app.config.ts` reads `EXPO_PUBLIC_API_BASE` from `.env` and injects it into `Constants.expoConfig.extra.apiBase`, which the app uses to hit the same Express backend as the website.

## Building a release AAB

1. Ensure you have a keystore (create with `keytool`) and record the alias/passwords securely.
2. Log into Expo (`npx expo login`) and configure credentials via `npx eas credentials` or supply Gradle env vars locally.
3. Produce the bundle:
   - Local Gradle: `npx expo run:android --variant release`
   - Managed cloud build (uses `.eas.json` + projectId `d0147d54-e8aa-450f-acc7-3c24bc6c72bf`): `npx eas build --platform android --profile production`
4. Upload the generated `.aab` to Google Play Console (internal testing track first, then production rollout).

Remember to deploy any backend changes through the Contabo workflow before publishing a mobile build so both clients remain compatible.
