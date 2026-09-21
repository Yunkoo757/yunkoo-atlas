# Execution Trainer

独立的固定次数训练完成器。创建训练只填名称、总次数、每日最低量；完成一次写入时间，进度只增不减。支持多个独立训练，不关联 Trader Atlas 数据。

## 运行

Windows：右键 `start.ps1` 使用 PowerShell 运行，或在此目录运行 `powershell -ExecutionPolicy Bypass -File .\start.ps1`。

当前工作区可复用父目录已有 Electron 运行时。移到任意独立目录后，先执行 `npm install`，再 `npm start`。macOS 同样使用 `npm install`、`npm start`。这是源码运行版本，尚未制作或发布双平台安装包。

## 规则

- 创建当日开始，每个自然日都计入；名称、总次数和每日最低量创建后固定。
- 每次记录只有成功写盘后才显示增加，不提供撤销、删除、重置或补录。
- 创建时固定系统时区；跨午夜结算，关闭程序期间的空白日也算 MISSED。
- 当天显示进行中或 DONE；完成率只包含已结束的日子。达到总目标时立即结算最后一天并停止后续天数。
- 最后一天以剩余次数为最低量；多做的次数计入总进度，不抵扣未来日承诺。
- 系统时间早于最近持久记录时阻止写入，提示校正时间。不是联网可信时钟。

## 存储

Windows 默认 `%APPDATA%/Execution Trainer/records`，macOS 默认 `~/Library/Application Support/Execution Trainer/records`。与 Atlas 完全分离。`EXECUTION_TRAINER_DATA` 可指定隔离测试目录。

每个事件独立 UTF-8 JSON 文件，先写入临时文件并 fsync，再用不覆盖目标的硬链接发布。单实例串行处理；不提供记录编辑接口。SHA-256 前序链可检测中间缺失和普通修改；不能防止有文件权限的人删除末尾记录或重写整个链。未发布的临时文件不计数。备份时关闭程序，复制整个数据目录；损坏时保留原目录并恢复完整备份，程序不会自动清空。数据目录需位于支持硬链接的本地文件系统。

## 验证

`npm test` 检查日期结算、时区、持久化、写入失败、损坏、目标上限和时钟回退。
`npm run test:desktop` 在独立临时数据目录运行实际 Electron 交互，截图和几何记录输出至 `test-results/`。
