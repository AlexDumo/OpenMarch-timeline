#!/bin/bash
source ~/.nvm/nvm.sh >/dev/null; nvm use 24 >/dev/null
rm -f compare.json
for show in part1 lhb lhbx5; do
  for cond in "llvmpipe 1" "llvmpipe 4" "llvmpipe 6" "swiftshader 1"; do
    set -- $cond
    for app in fabric proto; do
      timeout 300 node compare.mjs $app $show $1 $2 compare.json 2>&1 | tail -1 | cut -c1-400
    done
  done
done
echo MATRIX DONE
