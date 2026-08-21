# Trader Atlas IP Logo 候选 · 2026-08-21

本批共 10 张独立候选，均由 Codex 内置 ImageGen 单张生成，原生尺寸为 `1254 × 1254`。候选仅保存为评审素材，尚未替换 `build/icon.svg` 或任何现有图标资源。

## 候选清单

| 编号 | 方向 | 角色连接 | 构图 | 主体色 | 文件 |
| --- | --- | --- | --- | --- | --- |
| A1 | 猫头鹰观察员 | 盘面洞察、复盘 | 左下 | `#5e6ad2` + `#e8eaf6` | `A1-owl-indigo-ivory-lower-left.png` |
| A2 | 猫头鹰观察员 | 盘面洞察、复盘 | 右下 | `#5e6ad2` + `#e8eaf6` | `A2-owl-indigo-ivory-lower-right.png` |
| A3 | 猫头鹰观察员 | 盘面洞察、复盘 | 左下 | `#73c6a2` + `#f0e7d2` | `A3-owl-mint-ivory-lower-left.png` |
| A4 | 猫头鹰观察员 | 盘面洞察、复盘 | 右下 | `#5e6ad2` + `#e8eaf6` | `A4-owl-indigo-ivory-lower-right.png` |
| B1 | 海龟守护者 | 风险纪律、稳定执行 | 左下 | `#73c6a2` + `#f0e7d2` | `B1-turtle-mint-ivory-lower-left.png` |
| B2 | 海龟守护者 | 风险纪律、稳定执行 | 右下 | `#f2c94c` + `#5e6ad2` | `B2-turtle-gold-indigo-lower-right.png` |
| B3 | 海龟守护者 | 风险纪律、稳定执行 | 左下 | `#5e6ad2` + `#e8eaf6` | `B3-turtle-indigo-ivory-lower-left.png` |
| C1 | 狐狸领航员 | 方向判断、策略切换 | 右下 | `#f2c94c` + `#5e6ad2` | `C1-fox-gold-indigo-lower-right.png` |
| C2 | 狐狸领航员 | 方向判断、策略切换 | 左下 | `#e8eaf6` + `#5e6ad2` | `C2-fox-ivory-indigo-lower-left.png` |
| C3 | 狐狸领航员 | 方向判断、策略切换 | 右下 | `#f2c94c` + `#f0e7d2` | `C3-fox-gold-ivory-lower-right.png` |

每张图的背景均指定为产品深靛黑 `#12141a`；实际返回结果允许存在 ImageGen 的轻微明暗变化，但没有做自动筛除、重绘或后处理。

## Prompt 记录

执行方式：内置 ImageGen；生成模式：brand-new image；输入图片：无；约束传递：main-prompt constraints；每个候选独立调用一次。

所有候选共用以下 prompt 结构：

```text
Create one complete full-bleed 1:1 square image.
Background: fill the entire square with solid deep indigo-black #12141a. Keep this color visible in every open area and in the corners not occupied by the character; the assigned emergence corner must be occupied by the character.
Subject: place one extremely simplified, cute, endearing baby <subject> character, reduced to one soft rounded continuous silhouette and one defining feature: <defining feature>.
Complexity: use only 4–7 large basic shapes and at most two broad internal color regions. Use two simple eyes and add one tiny mouth only when it helps the expression. Remove every nonessential line, outline, anatomical detail, texture, and decoration. Keep the character readable at 32 × 32.
Color behavior: use exactly three semantic colors in the complete image: exactly two character colors, <color 1> and <color 2>, plus the solid deep indigo-black background #12141a. Organize both character colors into broad purposeful masses and reuse them for facial marks. Keep the character and face clearly separated from the background.
Composition: keep the character upright and emerging from the <lower-left or lower-right> corner, filling about 85–95% of the square so it remains visually dominant. Cropping at the bottom or assigned side is welcome when it strengthens the corner emergence. Preserve both paired identifying features. Never center or bottom-center the character.
Style: make simplification, cuteness, and lovable baby-like appeal the strongest qualities. Use large soft forms, compact proportions, thick rounded contours, and an ultra-clean graphic treatment. Prefer one clear shape over several explanatory details. Add an extremely, extremely subtle, almost imperceptible sense of depth through a barely-there neo-skeuomorphic treatment.
Finish: show only the character on the full-canvas background, with clean surfaces and normal square outer corners.
Constraints: Use no text or watermark. Add no borders, frames, cards, or presentation masks. Include one character only, with no extra subjects or scenery. Use no fragile lines, sharp tips, unnecessary outlines, tiny details, or decorative marks. Add no photorealistic material, dramatic bevel, glossy hotspot, deep occlusion, extrusion, strong three-dimensional rendering, or external cast shadow. Keep the background solid and uniform, with no texture, vignette, or lighting variation.
```

变量按上表逐项替换；A 方向的 defining feature 为圆润宽面盘，B 方向为宽大光滑圆壳，C1/C2 方向为一对圆钝大耳，C3 方向为一块宽大的圆润侧尾部轮廓。A1–A4、B1–B3、C1–C3 的实际 prompt 还分别加入了对应的轻微轮廓变体。

## 下一步

请从 `A1`–`C3` 中选择一个或多个偏好的编号。选定后会先把最终轮廓重绘为简洁 SVG 主图，再运行 `pnpm icons:app` 同步生成 favicon、Windows `.ico`、macOS `.png` 和安装器资源。
