#!/usr/bin/env bash
set -e

# Ensure kaggle CLI is reachable
export PATH="$HOME/.local/bin:$PATH"

if ! command -v kaggle &>/dev/null; then
  echo "Error: kaggle CLI not found in PATH or ~/.local/bin"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$ROOT_DIR/demos/kaggle/data"

mkdir -p "$DATA_DIR"

PAIRS=(
  "titanic titanic"
  "house-prices-advanced-regression-techniques house-prices"
  "spaceship-titanic spaceship-titanic"
  "digit-recognizer digits"
  "nlp-getting-started disaster-tweets"
  "store-sales-time-series-forecasting store-sales"
  "bike-sharing-demand bike-sharing"
  "nyc-taxi-trip-duration nyc-taxi"
  "dogs-vs-cats dogs-vs-cats"
)

echo "Starting Kaggle datasets download..."

for PAIR in "${PAIRS[@]}"; do
  set -- $PAIR
  COMP="$1"
  TARGET_NAME="$2"
  TARGET_PATH="$DATA_DIR/$TARGET_NAME"

  echo "=============================================="
  echo "Processing: $COMP -> $TARGET_NAME"
  echo "=============================================="

  mkdir -p "$TARGET_PATH"

  # Download competition files
  echo "Downloading $COMP..."
  if ! kaggle competitions download -c "$COMP" -p "$TARGET_PATH"; then
    echo "Warning: Failed to download $COMP. Make sure you accepted the rules on Kaggle!"
    continue
  fi

  # Unpack zip files if present
  for ZIP in "$TARGET_PATH"/*.zip; do
    if [ -f "$ZIP" ]; then
      echo "Unpacking $(basename "$ZIP")..."
      unzip -q -o "$ZIP" -d "$TARGET_PATH"
      rm -f "$ZIP"
    fi
  done

  # For nested zips (e.g. dogs-vs-cats contains train.zip and test1.zip)
  for NESTED_ZIP in "$TARGET_PATH"/*.zip; do
    if [ -f "$NESTED_ZIP" ]; then
      echo "Unpacking nested $(basename "$NESTED_ZIP")..."
      unzip -q -o "$NESTED_ZIP" -d "$TARGET_PATH"
      rm -f "$NESTED_ZIP"
    fi
  done

  echo "Done: $TARGET_NAME"
done

echo "=============================================="
echo "All done! Data saved to $DATA_DIR"
