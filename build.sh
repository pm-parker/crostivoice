#!/usr/bin/env bash
# 构建发布包:CrostiVoice_v<version>.zip
set -euo pipefail
VERSION=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
OUT="dist/CrostiVoice_v${VERSION}.zip"

# ---- 语法门禁(先于打包) ----
# 坑(实测 v0.17.0-beta.2~v0.17.2 连发三个坏包):node --check 对含 import
# 语句的 .js(CJS 检查路径)静默跳过、exit 0 —— ESM 文件等于没检查。
# 统一复制为 .mjs 强制走 ESM 语法检查,任何文件有语法错误直接终止构建。
TMP_CHECK=$(mktemp -d)
trap 'rm -rf "$TMP_CHECK"' EXIT
shopt -s nullglob
CHECK_FILES=(*.js options/*.js onboarding/*.js popup/*.js)
for f in "${CHECK_FILES[@]}"; do
  cp "$f" "$TMP_CHECK/audit.mjs"
  if ! node --check "$TMP_CHECK/audit.mjs" 2> "$TMP_CHECK/err.txt"; then
    echo "✗ 语法错误: $f" >&2
    head -6 "$TMP_CHECK/err.txt" >&2
    exit 1
  fi
done
echo "语法门禁:${#CHECK_FILES[@]} 个 JS 文件全部通过(ESM 模式)"

mkdir -p dist
rm -f "$OUT"
python3 - "$OUT" <<'PY'
import sys, zipfile, os, glob
out = sys.argv[1]
# 根目录所有 .js 全部打包(坑:v0.16/v0.17 曾把 whisper-engine.js /
# sensevoice-engine.js 漏出包外,offscreen.js import 404 → 模块图永远
# 挂起 → 监听器不注册 → "唤不起语音" 且无任何报错)
include = sorted(glob.glob('*.js')) + [
    'manifest.json', 'offscreen.html', 'beta.json',
    'popup', 'options', 'onboarding', 'icons', 'vendor',
    'README.md', 'PRIVACY.md', 'LICENSE',
]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for name in include:
        if not os.path.exists(name):
            continue
        if os.path.isfile(name):
            z.write(name)
        else:
            for root, dirs, files in os.walk(name):
                dirs[:] = [d for d in dirs if not d.startswith('.')]
                for f in files:
                    if not f.startswith('.'):
                        z.write(os.path.join(root, f))
# 打包自检 1:zip 内每个 JS 的静态 import 都必须能在 zip 内解析
import re
with zipfile.ZipFile(out) as zc:
  names = set(zc.namelist())
  bad = []
  for n in names:
    if not n.endswith('.js'):
        continue
    src = zc.read(n).decode('utf-8', errors='replace')
    for m in re.finditer(r'from\s+"(\.\.?/[^"]+)"', src):
        target = os.path.normpath(os.path.join(os.path.dirname(n), m.group(1))).replace('\\', '/')
        if target not in names and target + '.js' not in names:
            bad.append(f'{n} → {m.group(1)} (zip 内缺失!)')
  # 打包自检 2:扩展 HTML 禁止内联脚本(MV3 默认 CSP script-src 'self',
  # 内联 script 被静默拒执行——v0.17.3 的 offscreen 因此全灭)。先剥注释再查。
  for n in names:
    if not n.endswith('.html'):
        continue
    html = zc.read(n).decode('utf-8', errors='replace')
    html = re.sub(r'<!--.*?-->', '', html, flags=re.S)
    if re.search(r'<script(?![^>]*\bsrc=)[^>]*>', html):
        bad.append(f'{n}: 含内联 script 标签,会被 MV3 CSP 拒执行!')
if bad:
    print('✗ 打包自检失败: ' + ' | '.join(bad), file=sys.stderr)
    sys.exit(1)
print(f'built {out} ({len(names)} files, import 自检通过)')
PY
ls -lh "$OUT"
