#!/usr/bin/env bash
# 拉取第三方运行时到 vendor/(不进仓库,避免 GitHub 密钥误报与仓库膨胀)
set -euo pipefail
ORT_VER="1.31.0-dev.20260914-8d85527a0"
ORT_BASE="https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist"
TF_VER="4.3.2"

mkdir -p vendor
cd vendor

if [ ! -f transformers.web.min.js ]; then
  echo "→ transformers.js ${TF_VER}"
  tmp=$(mktemp -d)
  ( cd "$tmp" && npm pack "@huggingface/transformers@${TF_VER}" >/dev/null 2>&1 && tar -xzf ./*.tgz )
  cp "$tmp"/package/dist/transformers.web.min.js .
  cp "$tmp"/package/dist/ort-wasm-simd-threaded.jsep.mjs .
  rm -rf "$tmp"
  # 修正裸模块说明符为相对路径(MV3 扩展内无法解析 bare specifier)
  python3 - <<'PY'
import re
p = 'transformers.web.min.js'
s = open(p).read()
s = s.replace('from"onnxruntime-web/webgpu"', 'from"./ort.webgpu.mjs"')
s = s.replace('from"onnxruntime-common"', 'from"./ort.mjs"')
open(p, 'w').write(s)
PY
fi

for f in ort.mjs ort.webgpu.mjs \
         ort-wasm-simd-threaded.asyncify.mjs ort-wasm-simd-threaded.asyncify.wasm \
         ort-wasm-simd-threaded.mjs ort-wasm-simd-threaded.wasm; do
  [ -f "$f" ] || { echo "→ $f"; curl -sL -o "$f" "$ORT_BASE/$f"; }
done

echo "✓ vendor/ 就绪"
ls -lh .
