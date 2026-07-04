# 回收站模块可行性评估报告

**评估日期**: 2026-06-27  
**项目**: Yunkoo Atlas  
**需求**: 为交易案例新增回收站功能，删除后进入回收站，30天后自动清空

---

## 一、现有架构分析

### 1.1 数据存储结构

**存储方案**: IndexedDB (linear-journal-v3)
- 使用 Zustand 状态管理 + IndexedDB 持久化
- 数据库版本: DB_VERSION = 1
- 存储Stores: `snapshot`、`assets`、`meta`

**案例数据模型** (`CaseRecord`):
```typescript
interface CaseRecord {
  id: string
  disputeTypeId: string          // 纠纷类型 ID
  initialVerdict: string         // 初始裁决
  confidence: 30 | 50 | 70 | 90  // 信心度
  images: CaseImage[]            // 截图（存储在 assets 表）
  finalVerdict?: string          // 最终裁决
  note?: string                  // 笔记
  tags?: string[]                // 标签
  star?: boolean                 // 典型案例
  recheck?: boolean              // 需要复看
  linkedTradeIds?: string[]      // 关联交易 ID
  comments?: CaseComment[]       // 评论
  createdAt: string              // 创建时间
  updatedAt: string              // 更新时间
}
```

**关键发现**:
- ✅ 已有时间戳字段 (`createdAt`, `updatedAt`)
- ✅ 已有关联数据字段 (`linkedTradeIds`, `images`)
- ⚠️ **缺失**: 无软删除标记字段、无删除时间字段

### 1.2 删除逻辑现状

**当前删除方式**: 硬删除（直接从数组中移除）
```typescript
// src/store/useStore.ts:208
removeCase: (id) => set((s) => ({ 
  cases: s.cases.filter((c) => c.id !== id) 
}))
```

**删除触发点**:
- `CaseDetail.tsx:152` - 详情页删除按钮
- `CaseList.tsx:245` - 列表页右键菜单
- `caseMenu.tsx:52` - 上下文菜单

**删除时处理**:
- ⚠️ **未清理关联图片** - 图片仍保留在 `assets` 表中
- ⚠️ **未断开交易关联** - `linkedTradeIds` 引用仍存在
- ⚠️ **不可恢复** - 直接删除，无撤销机制

### 1.3 关联数据影响

**关联交易**:
- `Trade` 对象可能引用案例（通过反向查询）
- 删除案例后，交易详情页的案例关联会显示缺失

**关联图片**:
- `CaseImage.fileId` 引用 `assets` 表中的 Blob
- 删除案例后，图片资源成为孤儿数据，占用存储空间

**评论数据**:
- `CaseComment[]` 内嵌在案例中，随案例一起删除

---

## 二、回收站设计方案

### 2.1 方案对比

#### 方案 A: 软删除标记（推荐）

**实现方式**: 在 `CaseRecord` 中添加 `deletedAt` 字段

```typescript
interface CaseRecord {
  // ... 现有字段
  deletedAt?: string  // 删除时间（ISO 字符串），null 表示未删除
}
```

**优点**:
- ✅ 实现简单，只需修改数据模型和查询逻辑
- ✅ 数据完整性高，关联数据自动保留
- ✅ 恢复速度快，只需清除 `deletedAt` 字段
- ✅ 与现有 Undo/Redo 机制兼容

**缺点**:
- ⚠️ 需要修改所有案例查询逻辑，添加 `deletedAt` 过滤
- ⚠️ 数据库体积暂时增大（30天内累积删除数据）
- ⚠️ 需要定期清理机制

---

#### 方案 B: 独立回收站表

**实现方式**: 创建独立的 `trash` 存储

```typescript
interface TrashRecord {
  id: string
  originalId: string          // 原案例 ID
  caseData: CaseRecord        // 原案例完整数据
  deletedAt: string           // 删除时间
  expiresAt: string           // 过期时间（deletedAt + 30天）
}
```

**优点**:
- ✅ 不影响现有查询逻辑
- ✅ 清晰的数据隔离
- ✅ 可单独备份/清理回收站

**缺点**:
- ⚠️ 需要修改 IndexedDB schema（升级 DB_VERSION）
- ⚠️ 数据迁移复杂度高
- ⚠️ 恢复时需要重新处理关联数据
- ⚠️ 破坏现有 Undo/Redo 机制

---

#### 方案 C: 快照备份

**实现方式**: 删除前创建完整快照到 `snapshot` 表

**优点**:
- ✅ 不修改数据模型
- ✅ 可保留完整历史记录

**缺点**:
- ⚠️ 存储空间消耗大
- ⚠️ 快照管理复杂
- ⚠️ 恢复逻辑繁琐
- ⚠️ 不适合频繁操作

---

### 2.2 推荐方案: 方案 A（软删除标记）

**理由**:
1. **实现成本低** - 最小化代码改动，无需修改数据库 schema
2. **数据完整性高** - 关联数据（图片、评论）自然保留
3. **用户体验好** - 恢复操作即时完成，无延迟
4. **兼容性好** - 与现有 Undo/Redo、导入导出机制无缝集成

---

## 三、详细实现方案

### 3.1 数据模型扩展

**修改 `CaseRecord` 类型定义**:
```typescript
// src/data/case.ts
export interface CaseRecord {
  // ... 现有字段
  deletedAt?: string     // 删除时间（ISO 格式），undefined 表示未删除
  deletedBy?: string     // 删除操作来源（可选，用于审计）
}
```

**推导函数更新**:
```typescript
// 新增函数：判断案例是否已删除
export function isDeleted(rec: CaseRecord): boolean {
  return rec.deletedAt !== undefined
}

// 新增函数：判断案例是否已过期（30天）
export function isExpired(rec: CaseRecord): boolean {
  if (!rec.deletedAt) return false
  const deletedTime = new Date(rec.deletedAt).getTime()
  const now = Date.now()
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
  return (now - deletedTime) > thirtyDaysMs
}
```

---

### 3.2 删除逻辑改造

**修改 `removeCase` 为软删除**:
```typescript
// src/store/useStore.ts
removeCase: (id) => set((s) => ({
  cases: s.cases.map((c) => 
    c.id === id 
      ? { ...c, deletedAt: new Date().toISOString() }
      : c
  )
}))
```

**新增 `purgeCase` 方法（彻底删除）**:
```typescript
purgeCase: (id) => set((s) => ({
  cases: s.cases.filter((c) => c.id !== id)
}))
```

**新增 `restoreCase` 方法（恢复）**:
```typescript
restoreCase: (id) => set((s) => ({
  cases: s.cases.map((c) => 
    c.id === id 
      ? { ...c, deletedAt: undefined, updatedAt: new Date().toISOString() }
      : c
  )
}))
```

---

### 3.3 查询逻辑调整

**所有案例列表查询需添加过滤**:
```typescript
// 示例：获取未删除的案例
const activeCases = cases.filter(c => !c.deletedAt)

// 示例：获取回收站中的案例
const trashCases = cases.filter(c => c.deletedAt && !isExpired(c))
```

**影响范围**:
- `CaseList.tsx` - 主列表视图
- `BoardView.tsx` - 看板视图
- `DetailView.tsx` - 交易详情页的案例关联
- `StrategiesView.tsx` - 策略页的案例引用
- `Dashboard.tsx` - 统计面板（需排除已删除数据）

---

### 3.4 自动清理机制

**方案 1: 应用启动时清理（推荐）**
```typescript
// src/App.tsx 或 storage 初始化逻辑
function cleanExpiredTrash() {
  const expiredCases = cases.filter(c => isExpired(c))
  for (const c of expiredCases) {
    // 清理关联图片
    for (const img of c.images) {
      await deleteAsset(img.fileId)
    }
    // 从数据库移除
    purgeCase(c.id)
  }
}
```

**方案 2: 定时器清理**
```typescript
// 每 24 小时检查一次
setInterval(cleanExpiredTrash, 24 * 60 * 60 * 1000)
```

**推荐方案 1** 的理由:
- ✅ 简单可靠，不依赖定时器
- ✅ 用户每次打开应用时自动执行
- ✅ 避免后台运行时的性能开销
- ✅ 与应用生命周期绑定，易于调试

---

### 3.5 导入导出兼容性

**导出时需处理软删除数据**:
```typescript
// src/lib/importExport.ts
export function buildExportPayload(): ExportPayload {
  return {
    cases: cases.filter(c => !c.deletedAt), // 仅导出未删除数据
    // ... 其他数据
  }
}
```

**导入时需合并软删除标记**:
```typescript
export function mergeImportPayload(payload: ExportPayload) {
  // 保留本地已删除数据，不覆盖导入数据
  const localDeletedIds = localCases.filter(c => c.deletedAt).map(c => c.id)
  const mergedCases = [
    ...payload.cases,
    ...localCases.filter(c => c.deletedAt)
  ]
}
```

---

## 四、UI/UX 设计要点

### 4.1 回收站入口

**位置建议**: 侧边栏底部，与设置入口同级
```
侧边栏结构:
├─ 工作区头像
├─ 导航菜单
│  ├─ 交易列表
│  ├─ 看板
│  ├─ 策略
│  └─ 判例库
├─ 设置
└─ 回收站 ⭐ 新增
```

**图标**: `Trash2` (lucide-react) 或 `Archive`

**样式**: 
- 默认隐藏，当有删除数据时显示
- 显示删除数量徽章（如 `回收站 (3)`）

---

### 4.2 回收站视图设计

**列表展示**:
- 卡片式布局（类似 CaseList）
- 显示删除倒计时（如 `剩余 28 天`）
- 高亮即将过期数据（剩余 < 7 天）

**操作按钮**:
- 恢复按钮（主按钮，绿色）
- 彻底删除按钮（次要按钮，红色，需二次确认）

**分组方式**:
- 按删除时间分组（今天、本周、本月、即将过期）

---

### 4.3 删除流程改造

**原删除流程**:
```
用户点击删除 → 直接移除 → Toast 提示 "已删除"
```

**新删除流程**:
```
用户点击删除 → 软删除标记 → Toast 提示 "已移至回收站，30天后自动删除"
                                        [查看回收站] 按钮
```

**右键菜单调整**:
- "删除" 改名为 "移至回收站"
- 回收站中增加 "彻底删除" 选项

---

### 4.4 恢复流程设计

**从回收站恢复**:
```
点击恢复 → 清除 deletedAt → Toast "已恢复"
         → 自动返回原位置（保留原排序）
```

**撤销恢复**:
- 支持 Undo 操作（类似现有交易撤销）

---

## 五、实现工作量评估

### 5.1 开发任务清单

| 模块 | 任务 | 工时估算 | 难度 |
|------|------|----------|------|
| 数据层 | 扩展 CaseRecord 类型 | 1h | 低 |
| 数据层 | 新增推导函数 | 0.5h | 低 |
| 数据层 | 改造 removeCase/restoreCase/purgeCase | 2h | 中 |
| 数据层 | 实现自动清理机制 | 3h | 中 |
| 视图层 | 修改所有案例查询过滤 | 4h | 中 |
| 视图层 | 新建 TrashView 组件 | 6h | 中 |
| 视图层 | 改造删除交互流程 | 3h | 中 |
| 导入导出 | 兼容性处理 | 2h | 低 |
| 测试 | 功能测试 | 3h | 低 |

**总工时**: 约 **19.5 小时**（约 2-3 个工作日）

---

### 5.2 风险点

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 查询性能下降 | 软删除后数组增大 | 定期清理过期数据 |
| 数据迁移兼容性 | 旧版本数据无 deletedAt | 默认 undefined 表示未删除 |
| 关联数据清理 | 图片资源未及时释放 | 清理时同步删除 assets |
| 用户误操作 | 恢复后数据覆盖 | 保持 updatedAt，不回退时间戳 |

---

## 六、总结与建议

### 6.1 核心结论

✅ **回收站功能可行性高，推荐实现**

**理由**:
1. 现有架构支持良好（IndexedDB + Zustand）
2. 软删除方案实现成本低、风险小
3. 数据完整性保障充分
4. 用户需求明确，价值显著

---

### 6.2 实施建议

**优先级**: P1（高优先级，建议本周规划）

**实施路径**:
1. **阶段 1**: 数据层改造（类型、方法、清理机制）
2. **阶段 2**: 视图层过滤逻辑调整
3. **阶段 3**: 回收站 UI 开发
4. **阶段 4**: 交互流程优化

**关键里程碑**:
- M1: 软删除机制上线（后台逻辑完成）
- M2: 回收站视图可用（用户可见）
- M3: 自动清理运行（30天机制生效）

---

### 6.3 后续优化方向

- 批量恢复功能
- 回收站搜索过滤
- 删除原因记录（可选）
- 回收站容量限制（如最多保留 100 条）
- 导出回收站数据（数据恢复工具）