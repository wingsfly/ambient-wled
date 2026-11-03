#!/bin/sh
# 构建模拟服务器要用的 liblamp。源码在 lamp-core 子模块（usermods/lamp）。
set -e
cd "$(dirname "$0")"
exec ../usermods/lamp/capi/build.sh "$PWD"
