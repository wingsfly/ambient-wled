# lamp 分支已冻结（2026-11-03）

自制板（ESP32-S3 + INMP441）固件停在本分支当前状态，不再更新。现行代码在：

- 灯效与音频分析核心：ambient-lamp-core 仓库（原 `usermods/lamp/`、`tools/lamp_capi.*`、单测、Python 发送端）
- macOS 发送端 LampSender：ambient-lampkit 仓库 `Apps/LampSender`
- 原厂板固件的 WLED 部分：本仓库 `lamp-v5` 分支（`usermods/lamp` 是 ambient-lamp-core 子模块）

冻结点标签：`lamp-frozen-20261103`。
