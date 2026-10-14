#!/bin/bash
source ~/.nvm/nvm.sh >/dev/null; nvm use 24 >/dev/null
timeout 900 node compare.mjs fabric lhbx5 llvmpipe 1 compare3.json 2>&1 | grep -E '^\{|rror' | tail -2 | cut -c1-600
for show in part1 lhb lhbx5; do
  for cond in "swiftshader 1" "llvmpipe 1" "llvmpipe 4" "llvmpipe 6"; do
    set -- $cond
    timeout 600 node compare.mjs proto2d $show $1 $2 compare3.json 2>&1 | grep -E '^\{|rror' | tail -2 | cut -c1-600
  done
done
echo MATRIX3 DONE
