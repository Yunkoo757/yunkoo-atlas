# Final contract reconciliation report

## 基线与范围

- 父提交：`cf74cded59db3fbe775a072777d568081d98ce15`
- 仅修改 brief 指定的四个源码/测试文件，并新增本报告。
- 未修改布局、月分组或其他生产文件。

## RED 证据

在父提交生产行为上先更新合同与负向 fixtures，再运行：

```text
node scripts/run-regression-tests.mjs --unit-only src/lib/desktopVisualTokens.test.ts src/lib/typographySystem.design.test.ts
exit 1
missing --text-primary: lch(92% 0.8 272 / 1)
testLiteralFontSizeContractRejectsRogueUiPixels: Missing expected exception.
```

```text
TypographyRoles browser focused runner
exit 1
--text-primary 必须保留精确 LCH 灰阶
```

上述失败分别证明旧五级 LCH 值不满足精确合同，以及 shorthand 扫描器会放过新增负向输入。

暂存审查后追加未知 token fixture，确认有限集合边界：

```text
node scripts/run-regression-tests.mjs --unit-only src/lib/typographySystem.design.test.ts
exit 1
font: 500 var(--type-rogue-size) var(--font-ui): Missing expected exception.
```

## GREEN 实现

- 五级文字令牌统一为 hue `272`、显式 alpha `/ 1` 的批准值；静态和浏览器合同同步精确值。
- `font:` 除 CSS-wide keywords 外默认拒绝，仅接受 size 位置的有限批准 canonical `--type-*-size` 或现有批准 `--fs-*` 令牌。
- 增加 `calc(22px)`、`clamp(20px, 2vw, 22px)`、`large`、`0` 的负向 fixtures；保留 `font-size: 0.85em` Editor code 长属性例外。

## GREEN 验证

```text
node scripts/run-regression-tests.mjs --unit-only src/lib/desktopVisualTokens.test.ts src/lib/typographySystem.design.test.ts
exit 0; 14 tests PASS

TypographyRoles browser focused runner
exit 0; fixture PASS

pnpm typecheck
exit 0

git diff --check
exit 0

UTF-8 fatal decode + BOM check
exit 0; all scoped files UTF-8 without BOM
```
