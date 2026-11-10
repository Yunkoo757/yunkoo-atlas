import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const dir = path.dirname(fileURLToPath(import.meta.url))
const plans = [
 ['A1','猫头鹰','观察与判断','lower-left','rounded baby owl with a single broad two-lobed facial disk, both softly rounded ear nubs visible','#E8D5AD','#3F405A','#747AB4'],
 ['A2','猫头鹰','观察与判断','lower-right','plump baby owl, round head and broad heart-like facial disk with every tip blunt and rounded, both small rounded ear nubs visible','#B9CEE0','#3C4664','#AB9DBD'],
 ['A3','猫头鹰','观察与判断','lower-left','compact round baby owl with tiny rounded ear nubs and one simple continuous wide face region, both ear nubs visible','#DDBA80','#544333','#839BA4'],
 ['A4','猫头鹰','观察与判断','lower-right','soft squat baby owl with an oversized round head, one large gently scalloped facial region and two visibly rounded ear nubs','#D7D0F0','#514773','#8594AC'],
 ['B1','狐狸','快捷与敏捷操作','lower-left','cute baby fox with an oversized rounded head and both thick blunt rounded ears, one continuous cream muzzle region, no tail detail','#D89168','#FAE0B0','#727CA6'],
 ['B2','狐狸','快捷与敏捷操作','lower-right','endearing compact baby fox with a broad cheek silhouette, two short blunt rounded ears and one simple broad muzzle region','#B86E61','#F4D5B2','#8B9E9B'],
 ['B3','狐狸','快捷与敏捷操作','lower-left','tiny calm baby fox with a broad round head, two capsule-like blunt rounded ears, one large connected muzzle and cheek region','#E3AD69','#5C443F','#A294B9'],
 ['C1','水豚','沉着与耐心','lower-right','extremely simple baby capybara with a broad rounded rectangular head, both tiny round ears visible and one large blunt muzzle region, no nostrils','#D3B98F','#675240','#899EAB'],
 ['C2','水豚','沉着与耐心','lower-left','sleepy friendly baby capybara, broad soft capsule head, two visible tiny rounded ears and one broad continuous muzzle color region, no nostrils','#DDBAA0','#765758','#9293B4'],
 ['C3','水豚','沉着与耐心','lower-right','calm endearing baby capybara, oversized wide rounded head, both small rounded ears and one softly rectangular broad muzzle color region, no nostrils','#C9C791','#505D49','#AF9691'],
]
const constraints = 'Use no text or watermark. Add no borders, frames, cards, or presentation masks. Include one character only, with no extra subjects or scenery. Use no fragile lines, sharp tips, unnecessary outlines, tiny details, or decorative marks. Add no photorealistic material, dramatic bevel, glossy hotspot, deep occlusion, extrusion, strong three-dimensional rendering, or external cast shadow. Keep the background solid and uniform, with no texture, vignette, or lighting variation.'
const candidates = plans.map(([label,subject,rationale,corner,treatment,c1,c2,bg])=>({label,subject,rationale,corner,colors:{subject:[c1,c2],background:bg},requestedDimensions:[1536,1536],provider:'built-in image_gen',constraintMode:'main-prompt constraints',prompt:`Create one complete full-bleed 1:1 square image, approximately 1536 × 1536.
Background: fill the entire square with solid ${bg}. Keep ${bg} visible in every open area and in the corners not occupied by the character; the assigned emergence corner must be occupied by the character.
Subject: place one extremely simplified, cute, endearing ${treatment} IP character on the background, reduced to one soft rounded continuous silhouette and one defining feature.
Complexity: use only 4–7 large basic shapes and at most two broad internal color regions. Use two simple eyes and add one tiny mouth only when it helps the expression. Remove every nonessential line, outline, anatomical detail, texture, and decoration. Keep the character readable at 32 × 32.
Color behavior: use exactly three semantic colors in the complete image: exactly two IP base colors ${c1} and ${c2}, plus the background color ${bg}. Organize the two IP colors into broad purposeful masses, and reuse the darker one for facial marks. Use the second color in one broad continuous defining region. Keep the background gently muted but clearly chromatic, clean, and intentional. Keep the IP, facial marks, and background clearly separated.
Composition: keep the character upright and emerging from the assigned ${corner}, filling about 85–95% of the square so it remains visually dominant. Cropping at the bottom or assigned side is welcome when it strengthens the corner emergence. Preserve both paired identifying features. Never center or bottom-center the character.
Style: make simplification, cuteness, and lovable baby-like appeal the strongest qualities. Use large soft forms, compact proportions, thick rounded contours, and an ultra-clean graphic treatment. Prefer one clear shape over several explanatory details. Add an extremely, extremely subtle, almost imperceptible sense of depth through a barely-there neo-skeuomorphic treatment.
Finish: show only the character on the full-canvas background, with clean surfaces and normal square outer corners.
Constraints: ${constraints}`}))
await fs.mkdir(path.join(dir,'images'),{recursive:true})
await fs.writeFile(path.join(dir,'prompts.json'),JSON.stringify({brief:'TradingView 插件 Atlas：图表控制、快捷操作、沉浸模式与回放复盘。候选仅为设计资产。',skill:'ip-as-logo',quantity:10,cornerDistribution:{'lower-left':5,'lower-right':5},constraints,candidates},null,2)+'\n','utf8')
console.log('Prepared 10 independent prompts.')
