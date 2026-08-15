# CSS AST typography audit report

## 基线与范围

- 父提交：`3cdb6ffd76c036ca27c99e0abd94ca47c74c9645`
- 仅修改 `package.json`、`pnpm-lock.yaml`、`src/lib/typographySystem.design.test.ts`，并新增本报告。
- 未修改生产 CSS、UI、布局、月分组或构建行为。

## RED 证据

先加入 quoted `;font-size:;` 正向 fixture，并在父提交的 regex declaration extractor 上运行：

```text
pnpm exec node scripts/run-regression-tests.mjs --unit-only src/lib/typographySystem.design.test.ts
exit 1
testLiteralFontSizeContractRejectsRogueUiPixels: Got unwanted exception.
src/views/example.css .ok::before has unapproved literal font-size:
```

该失败证明旧规则/声明正则会把字符串中的伪声明误判为真实 `font-size` 声明。新增的 quoted `font`、custom property 字符串、data URL 和 quoted fake block fixtures 固化同一错误边界。

## GREEN 实现

- 将 `postcss@8.5.18` 加为显式 dev dependency，并用 `postcss.parse(css, { from: path })` 解析每份完整 CSS source；解析失败携带 source path 并 fail closed。
- 使用 `root.walkDecls()` 只审计真实 declaration；`font-size` / `font` property 名大小写不敏感，value 中 custom property identifier 保持原始大小写。
- selector 直接取 declaration 的 AST rule parent，继续把 Editor `path + selector + value` 作为唯一 longhand 字面值例外。
- 合法 priority 由 PostCSS 从 value 中分离并读取 `declaration.important`；残留 value 中的 malformed priority 另由 Fix Round 1 的顶层 bang gate fail closed。
- 继续复用 longhand、shorthand slot、CSS-wide keyword、批准 token 与大小写语义 validators；空值、comment-only 和 priority-only 真实声明仍被拒绝。
- 新增正向 fixtures 覆盖 quoted `font-size` / `font`、custom property 字符串、data URL、quoted fake rule block；新增解析错误路径及 mixed-case property 对照。

## GREEN 验证

```text
pnpm exec node scripts/run-regression-tests.mjs --unit-only src/lib/typographySystem.design.test.ts
exit 0; 11 tests PASS

pnpm typecheck
exit 0

pnpm install --frozen-lockfile
exit 0; Lockfile is up to date

git diff --check
exit 0

exact staged scope + no unstaged changes
exit 0; exactly 4 brief-scoped files

UTF-8 fatal decode + BOM check
exit 0; all 4 scoped files are UTF-8 without BOM
```

## Fix Round 1/5：malformed priority residual

- 父提交：`cecb34b378b69b30a52c9a193e2e67d7a73ac4e7`
- 范围：仅 `src/lib/typographySystem.design.test.ts` 与本报告。

### RED

先加入 size 与 family 均已批准、唯一非法因素为尾随 `!urgent` 的 shorthand fixture：

```text
pnpm exec node scripts/run-regression-tests.mjs --unit-only src/lib/typographySystem.design.test.ts
exit 1
testLiteralFontSizeContractRejectsRogueUiPixels: Missing expected exception.
```

这证明初版报告所称“残留 malformed priority 会由既有 validators fail closed”并不成立：shorthand helper 只验证 family 起点，未检查其后的 token，因而会放行残留 priority。

### GREEN

- 新增 quote/escape/parenthesis-aware `hasTopLevelBang(value)`；对真实 `font-size` / `font` declaration，在原有 semantic validators 前统一拒绝残留的顶层未转义 `!`。
- PostCSS 已确认的合法末尾 priority 仍由 `declaration.important` 抽离，纯 value 继续进入原 semantic validators。
- shorthand 负向 fixtures 覆盖 `!urgent`、重复 `!important`、`!important garbage` 以及 canonical size/line-height slash 后的 `!urgent`。
- longhand 的批准 token 继续覆盖 malformed、重复和尾随 priority；两种 property 现在经过同一顶层 bang gate。
- 正向对照覆盖 quoted family 内 `!`、转义 bang、括号/`var()` 内字符串以及合法 mixed-case `! IMPORTANT`，避免误杀。

```text
pnpm exec node scripts/run-regression-tests.mjs --unit-only src/lib/typographySystem.design.test.ts
exit 0; 11 tests PASS

pnpm typecheck
exit 0

git diff --check
exit 0

exact scope check
exit 0; exactly 2 brief-scoped files

UTF-8 fatal decode + BOM check
exit 0; both scoped files are UTF-8 without BOM
```
