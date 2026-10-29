#!/bin/sh
# Downloads the CLIP models the eval scripts use (about 380 MB) into models/.
set -e
cd "$(dirname "$0")"
REV_BASE=6b7c523703ae26e39be4b03774966f8571c7f523 # same revision the extension pins
get() { # repo revision file
  mkdir -p "models/$1/$(dirname "$3")"
  [ -s "models/$1/$3" ] || curl -fL --retry 3 -o "models/$1/$3" "https://huggingface.co/$1/resolve/$2/$3"
}
for f in config.json preprocessor_config.json onnx/vision_model_int8.onnx; do
  get Xenova/clip-vit-base-patch32 "$REV_BASE" "$f"
  get Xenova/clip-vit-large-patch14 main "$f"
done
echo "models ready"
