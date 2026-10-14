#!/bin/bash
source ~/.nvm/nvm.sh >/dev/null; nvm use 24 >/dev/null
for show in part1 lhb lhbx5; do
  for cond in "llvmpipe 1" "llvmpipe 4" "llvmpipe 6" "swiftshader 1"; do
    set -- $cond
    timeout 900 node compare.mjs fabric $show $1 $2 compare2.json 2>&1 | grep -E '^\{|rror' | tail -2 | cut -c1-600
  done
done
echo MATRIX2 DONE
