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

## Fix Round 1/5：font shorthand token smuggling

- 父提交：`da7456f97c2dc21b0ec86ddf99562d7ecd3fcf2b`
- 范围：仅 `src/lib/typographySystem.design.test.ts` 与本报告。

### RED

先加入要求的 line-height smuggling 与 size token 出现在 family/其他槽位的负向 fixtures：

```text
node scripts/run-regression-tests.mjs --unit-only src/lib/typographySystem.design.test.ts
exit 1
font: 500 22px / var(--type-row-size) var(--font-ui): Missing expected exception.
```

随后补测未批准的 `700` shorthand weight，旧修饰符集合再次 RED：

```text
node scripts/run-regression-tests.mjs --unit-only src/lib/typographySystem.design.test.ts
exit 1
font: 700 var(--type-row-size) var(--font-ui): Missing expected exception.
```

### GREEN

- 使用纯 helper 将 shorthand 拆成顶层 token，括号和引号内空白不拆分，只有顶层 `/` 被识别为 size/line-height 分隔符。
- 有顶层 `/` 时，只认 slash 前紧邻 token 为 size；无 `/` 时，只允许唯一批准 size token，且它之前只能是批准的 style/variant/400-600 weight/stretch 修饰符。
- 批准 size token 必须精确来自有限 allowlist，不能从 line-height、family、嵌套 `calc()` 或其他非 size 槽反向授权；size 后必须存在可判定 family。
- CSS-wide keyword 仅允许整值；Editor `font-size: 0.85em` 长属性例外没有扩展到 shorthand。

```text
node scripts/run-regression-tests.mjs --unit-only src/lib/typographySystem.design.test.ts
exit 0; 11 tests PASS

pnpm typecheck
exit 0

git diff --check + exact scope check
exit 0

UTF-8 fatal decode + BOM check
exit 0; scoped files UTF-8 without BOM
```

## Fix Round 3/5：font-size longhand fail-closed

- 父提交：`c777e4a101d17892d138dadd42cb0c6349fc6894`
- 范围：仅 `src/lib/typographySystem.design.test.ts` 与本报告。

### RED

先加入 longhand 负向 fixtures：`inherit 22px`、`VAR(--type-rogue-size)`、已定义为 `22px` 的 `var(--TYPE-ROW-SIZE)`、`revert 12px`；同时加入 mixed-case `VAR(--type-row-size)`、五个 mixed-case CSS-wide keywords，以及 Editor 唯一 path+selector 例外对照。

```text
node scripts/run-regression-tests.mjs --unit-only src/lib/typographySystem.design.test.ts
exit 1
font-size: inherit 22px: Missing expected exception.
```

### GREEN

- `font-size` 的 `var(...)` 使用大小写不敏感函数名匹配，但捕获的 custom property identifier 保持原样并与 longhand 有限 allowlist 精确比较。
- `inherit|initial|unset|revert|revert-layer` 仅允许整值，keyword 本身大小写不敏感。
- `0.85em` 仍只通过 `src/editor/Editor.css` 的 `.editor code` approval；相同值换 selector 会被拒绝。
- 产品 CSS 全量扫描继续通过，未误杀真实 canonical token。

```text
node scripts/run-regression-tests.mjs --unit-only src/lib/typographySystem.design.test.ts
exit 0; 11 tests PASS

pnpm typecheck
exit 0

git diff --check + exact scope check
exit 0

UTF-8 fatal decode + BOM check
exit 0; scoped files UTF-8 without BOM
```

## Fix Round 2/5：custom property 大小写合同

- 父提交：`397ec0425fc72887fa69611ccda6775f46675adf`
- 范围：仅 `src/lib/typographySystem.design.test.ts` 与本报告。

### RED

先加入三类大小写敏感负向 fixtures：已定义为 `22px` 的 `--TYPE-ROW-SIZE`/混合大小写 size、`--FONT-WEIGHT-SEMIBOLD` modifier、`--FONT-UI` family；同时加入 canonical identifier 与大小写混合 `VAR(...)`/CSS-wide keyword 正向对照。

```text
node scripts/run-regression-tests.mjs --unit-only src/lib/typographySystem.design.test.ts
exit 1
--TYPE-ROW-SIZE fixture: Missing expected exception.
```

### GREEN

- `customPropertyTokenName()` 保留捕获到的 custom property identifier 原始大小写，与有限 allowlist 精确比较。
- `var` 函数名和 CSS-wide keyword 继续按 CSS 语法做大小写不敏感匹配。
- 真实仓库的 canonical 小写 token 继续通过产品 CSS 扫描。

```text
node scripts/run-regression-tests.mjs --unit-only src/lib/typographySystem.design.test.ts
exit 0; 11 tests PASS

pnpm typecheck
exit 0

git diff --check + exact scope check
exit 0

UTF-8 fatal decode + BOM check
exit 0; scoped files UTF-8 without BOM
```
