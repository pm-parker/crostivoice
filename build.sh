#!/usr/bin/env bash
# 构建发布包:CrostiVoice_v<version>.zip
set -euo pipefail
VERSION=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
OUT="dist/CrostiVoice_v${VERSION}.zip"
mkdir -p dist
rm -f "$OUT"
python3 - "$OUT" <<'PY'
import sys, zipfile, os
out = sys.argv[1]
include = ['manifest.json','background.js','content.js','offscreen.html','offscreen.js',
           'punct-engine.js','csc-engine.js','popup','options','onboarding','icons','vendor',
           'README.md','PRIVACY.md','LICENSE']
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
print(f'built {out}')
PY
ls -lh "$OUT"
