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
- 合法 priority 由 PostCSS 从 value 中分离并读取 `declaration.important`；重复、错位和尾随垃圾仍留在语义 value 中并由既有 validators fail closed。
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
