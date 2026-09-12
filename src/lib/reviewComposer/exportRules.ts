import evidence from './evidence.json'
import options from './options.json'
import engineSource from './engine.js?raw'
import scenarioSource from './scenario.js?raw'
import adapterSource from './service.ts?raw'
import modelSource from './model.ts?raw'
import { ENGINE_VERSION, type RulePack } from './model'

/** Export the actual bundled sources as well as prose: a parameter file is not the rule library. */
export function completeRulesMarkdown(rules: RulePack): string {
  return [
    '# ' + rules.name + ' · 完整规则',
    `规则版本：${rules.version}；引擎版本：${ENGINE_VERSION}。`,
    '本文件包含内置规则全文、当前配置、选项定义和实际生成/校验代码。文字依据与执行实现分别保留；若两者有差异，可据此核对，不能把文字依据误认为已经实现的分支。',
    '维护方式：文字依据可在 Markdown 中整理。Atlas 当前导入入口仅接受参数 JSON；修改本文或代码不会自动更新应用。事件与校验逻辑修改需要更新引擎、通过回归后发布客户端。',
    '## 一、规则全文',
    `${evidence.name}\n\n${evidence.basis}`,
    ...evidence.modules.map(m => `### ${m.title}\n\n类别：${m.kind}；原始启用状态：${m.enabled ? '启用' : '停用'}。\n\n${m.text}`),
    '## 二、离线执行补充约束',
    '- 默认模拟采用现行口径；单独 ibos 的激进观察由组合器设置单独启用。\n- 导航2的2M默认目标限HTF内部/波段点；3C使用HTF波段点。提前到MTF退出需要额外依据，当前不随机补写。\n- 模型C须给出POI区域边界，流动性点不能位于该区域内。\n- 预期A重入须同时保留MTF背景与本次扫描极值。\n- 模拟校验只检查声明的条件、对象及事件关系，不识别真实K线。完整执行分支见第四部分源码。',
    '## 三、当前参数与选项',
    '下列参数仅是完整规则的一部分。defaults 用于手动搭建默认条件；phrases 按顺序替换正文表述；allowedNavigations 约束可选导航。',
    '```json\n' + JSON.stringify(rules, null, 2) + '\n```',
    '### 可选条件定义',
    '```json\n' + JSON.stringify(options, null, 2) + '\n```',
    '## 四、实际执行规则源码',
    '以下为本次运行版本内置的完整代码，保留默认值、周期对应、对象映射、分支、事件顺序、校验和输出句式，供维护核对。',
    '### 生成与管理引擎（engine.js）',
    '```javascript\n' + engineSource.trim() + '\n```',
    '### 场景构建、关系校验与排版（scenario.js）',
    '```javascript\n' + scenarioSource.trim() + '\n```',
    '### Atlas 参数应用与兼容性校验（service.ts / model.ts）',
    '```typescript\n' + adapterSource.trim() + '\n```',
    '```typescript\n' + modelSource.trim() + '\n```',
  ].join('\n\n') + '\n'
}

export async function completeRulesArchive(rules: RulePack): Promise<Blob> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  zip.file('完整复盘规则.md', completeRulesMarkdown(rules))
  zip.file('参数配置.json', JSON.stringify(rules, null, 2))
  zip.file('规则依据.json', JSON.stringify(evidence, null, 2))
  zip.file('选项定义.json', JSON.stringify(options, null, 2))
  zip.file('engine.js', engineSource)
  zip.file('scenario.js', scenarioSource)
  zip.file('service.ts', adapterSource)
  zip.file('model.ts', modelSource)
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}
