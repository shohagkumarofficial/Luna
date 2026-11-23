#!/usr/bin/env bash
# Linux/CI equivalent of scripts/build-android.ps1 (same steps, same inputs, same output).
# Build pipeline: vite mobile assets -> (optional) character model -> personality export ->
# javac -> d8 -> aapt2 compile/link -> add dex -> zipalign -> apksigner -> verify.
#
# Environment:
#   ANDROID_HOME        Android SDK (platform android-35 + build-tools 35.0.0 are installed if missing)
#   MYRAA_KEYSTORE      keystore to sign with (default: android/signing/myraa-debug.keystore, a DEBUG key)
#   MYRAA_KS_PASS       keystore/key password (default: android)
#   MYRAA_MODEL_DIR     optional folder copied to assets/characters/evelyn (private test builds only)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -n "$SDK" ] || { echo "ANDROID_HOME is not set" >&2; exit 1; }
BT_VER="35.0.0"
PLATFORM="android-35"
if [ ! -f "$SDK/platforms/$PLATFORM/android.jar" ] || [ ! -x "$SDK/build-tools/$BT_VER/aapt2" ]; then
  SDKM="$(command -v sdkmanager || true)"
  [ -n "$SDKM" ] || SDKM="$SDK/cmdline-tools/latest/bin/sdkmanager"
  echo "Installing platform $PLATFORM and build-tools $BT_VER"
  yes | "$SDKM" --sdk_root="$SDK" --licenses >/dev/null || true
  "$SDKM" --sdk_root="$SDK" "platforms;$PLATFORM" "build-tools;$BT_VER"
fi
BT="$SDK/build-tools/$BT_VER"
ANDROID_JAR="$SDK/platforms/$PLATFORM/android.jar"

KEYSTORE="${MYRAA_KEYSTORE:-$ROOT/android/signing/myraa-debug.keystore}"
KS_PASS="${MYRAA_KS_PASS:-android}"
OUT_DIR="$ROOT/artifacts/android"
APK_NAME="${MYRAA_APK_NAME:-MYRAA-Mobile-1.0.0-rc.5-private.apk}"
ASSETS="$ROOT/android/app/src/main/assets"
BUILD="$ROOT/android/app/build/linux-$(date +%Y%m%d-%H%M%S)"

step() { printf '\n==> %s\n' "$*"; }

step "Launcher icon (neutral mark, only if artwork is absent)"
mkdir -p build
if [ ! -f build/icon.png ]; then
  python3 - <<'PY'
from PIL import Image, ImageDraw, ImageFont
img = Image.new("RGB", (256, 256), (15, 22, 27))
d = ImageDraw.Draw(img)
font = None
for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"):
    try:
        font = ImageFont.truetype(p, 174); break
    except OSError:
        pass
font = font or ImageFont.load_default(174)
d.text((128, 128), "M", font=font, fill=(142, 225, 219), anchor="mm")
img.save("build/icon.png")
PY
fi

step "Mobile web assets (vite)"
npx vite build --config vite.mobile.config.ts

step "Character model"
if [ -n "${MYRAA_MODEL_DIR:-}" ] && [ -d "$MYRAA_MODEL_DIR" ]; then
  mkdir -p "$ASSETS/characters"
  cp -R "$MYRAA_MODEL_DIR" "$ASSETS/characters/evelyn"
  echo "Included model from $MYRAA_MODEL_DIR (PRIVATE test build — do not redistribute)"
elif [ -d "$ROOT/assets/characters/evelyn" ]; then
  mkdir -p "$ASSETS/characters"
  cp -R "$ROOT/assets/characters/evelyn" "$ASSETS/characters/evelyn"
  echo "Included assets/characters/evelyn (PRIVATE test build — do not redistribute)"
else
  echo "No character model supplied: building WITHOUT the 3D character (add it later, see docs/BUILD-ANDROID-CI.md)"
fi

step "Shared personality export"
node --import tsx scripts/export-mobile-personality.ts

step "Compile Java"
mkdir -p "$BUILD/classes" "$BUILD/dex" "$BUILD/res/drawable"
find android/app/src/main/java -name '*.java' > "$BUILD/sources.txt"
javac -encoding UTF-8 -source 8 -target 8 -Xlint:-options -classpath "$ANDROID_JAR" -d "$BUILD/classes" @"$BUILD/sources.txt"
jar --create --file "$BUILD/classes.jar" -C "$BUILD/classes" .

step "Dex"
"$BT/d8" --lib "$ANDROID_JAR" --min-api 26 --output "$BUILD/dex" "$BUILD/classes.jar"

step "Package resources and assets"
cp build/icon.png "$BUILD/res/drawable/myraa_icon.png"
"$BT/aapt2" compile --dir "$BUILD/res" -o "$BUILD/resources.zip"
"$BT/aapt2" link --manifest android/app/src/main/AndroidManifest.xml -I "$ANDROID_JAR" -A "$ASSETS" \
  --min-sdk-version 26 --target-sdk-version 35 -o "$BUILD/unsigned.apk" "$BUILD/resources.zip"
(cd "$BUILD/dex" && zip -q -j "$BUILD/unsigned.apk" ./*.dex)

step "Align and sign"
"$BT/zipalign" -f -p 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"
mkdir -p "$OUT_DIR"
APK="$OUT_DIR/$APK_NAME"
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-key-alias androiddebugkey --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --out "$APK" "$BUILD/aligned.apk"
"$BT/apksigner" verify --verbose "$APK"

step "Result"
"$BT/aapt2" dump badging "$APK" | sed -n '1,12p'
sha256sum "$APK"
echo "APK: $APK"
