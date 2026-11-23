# Building the Android APK in CI (Linux)

The original build is the Windows script `scripts/build-android.ps1`. `scripts/build-android.sh`
performs the same steps on Linux (vite mobile assets, javac, d8, aapt2, zipalign, apksigner), and
`.github/workflows/myraa-android.yml` runs it after typecheck and all unit suites.
No application source was changed to make this possible.

## Output
- Workflow artifact `MYRAA-Mobile-apk` and the pre-release `myraa-android-latest` (`MYRAA-test.apk`).
- Signed with `android/signing/myraa-debug.keystore` (a **debug** key, password `android`). It keeps the signature
  stable so each build installs as an update. It is not a release key and must not be used for the Play Store.

## Character model (not included yet)
The 3D character is a third-party asset that is licensed for **private testing only** and must not be redistributed.
The source export omits it, so by default the APK is built without it.

To build with it for private testing:
1. Put the model folder at `assets/characters/evelyn` (the `/assets/` path is git-ignored on purpose), or set
   `MYRAA_MODEL_DIR` to the folder, then run `./scripts/build-android.sh` on your own machine.
2. Do not commit the model and do not publish an APK containing it in a public repository or release.

## Local build
Requirements: Node 22, JDK 17+, Python 3 with Pillow, Android SDK (`ANDROID_HOME`).
```
npm ci
./scripts/build-android.sh
```
