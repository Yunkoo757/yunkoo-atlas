# Trade Detail Document Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the trade detail media wall with a lightweight editor-native document flow while keeping comments visible and system activity collapsed.

**Architecture:** Keep the existing Tiptap editor, note persistence, lightbox, and right-side properties unchanged. Add one pure activity partition helper, then simplify `DetailView` so editor images render in their original nodes, comments form a visible section, and non-comment events live behind a disclosure control.

**Tech Stack:** React 18, TypeScript, Tiptap, Zustand, React Router, CSS, Vite regression runner, Chrome local-app verification.

## Global Constraints

- Always read and write files as UTF-8 without BOM.
- Preserve all Chinese characters and never convert non-ASCII text.
- Do not modify the right-side trade properties sidebar or its responsive drawer behavior.
- Do not change the editor, image asset, import/export, backup, or trade persistence protocols.
- Existing trade notes require no migration.
- Keep comments visible by default and system activity collapsed by default.

## File Map

- `src/lib/activities.ts`: owns the pure split between user comments and system-generated activity.
- `src/regression.test.ts`: verifies activity partition semantics without rendering React.
- `src/views/DetailView.tsx`: owns the document-flow composition and disclosure state.
- `src/views/DetailView.css`: owns spacing and visual hierarchy for the editor, comments, and collapsed activity.
- `src/components/trades/TradeMedia.tsx`: delete after `DetailView` stops using the media wall.
- `src/components/trades/TradeMedia.css`: delete with the media-wall component and its editor-image hiding rule.

---

### Task 1: Partition comments from system activity

**Files:**
- Modify: `src/lib/activities.ts`
- Modify: `src/regression.test.ts`

**Interfaces:**
- Consumes: `DisplayActivityEvent[]` returned by `getTradeActivities(trade)`.
- Produces: `partitionDisplayActivities(events): { comments: DisplayActivityEvent[]; system: DisplayActivityEvent[] }`.

- [ ] **Step 1: Write the failing regression test**

Add `partitionDisplayActivities` to the activities import in `src/regression.test.ts`, then add:

```ts
export function testDisplayActivitiesSeparateVisibleCommentsFromSystemHistory(): void {
  const events: DisplayActivityEvent[] = [
    { id: 'create', kind: 'create', timestamp: '2026-07-01T00:00:00.000Z' },
    { id: 'comment', kind: 'comment', commentId: 'comment', text: '等待确认', timestamp: '2026-07-02T00:00:00.000Z' },
    { id: 'note', kind: 'note', timestamp: '2026-07-03T00:00:00.000Z' },
  ]
  const result = partitionDisplayActivities(events)

  assert(result.comments.map((event) => event.id).join(',') === 'comment', '评论应进入默认可见区域')
  assert(result.system.map((event) => event.id).join(',') === 'create,note', '系统活动应进入折叠区域并保持顺序')
}
```

- [ ] **Step 2: Run the test and verify the red state**

Run:

```powershell
pnpm test
```

Expected: build or test failure because `partitionDisplayActivities` is not exported.

- [ ] **Step 3: Implement the minimal pure helper**

Add to `src/lib/activities.ts` after `DisplayActivityEvent`:

```ts
export function partitionDisplayActivities(events: DisplayActivityEvent[]): {
  comments: DisplayActivityEvent[]
  system: DisplayActivityEvent[]
} {
  const comments: DisplayActivityEvent[] = []
  const system: DisplayActivityEvent[] = []
  for (const event of events) {
    if (event.kind === 'comment') comments.push(event)
    else system.push(event)
  }
  return { comments, system }
}
```

- [ ] **Step 4: Run the regression suite**

Run:

```powershell
pnpm test
```

Expected: all exported regression tests pass, including `testDisplayActivitiesSeparateVisibleCommentsFromSystemHistory`.

- [ ] **Step 5: Commit the activity boundary**

```powershell
git add -- src/lib/activities.ts src/regression.test.ts
git commit -m "test: separate comments from trade activity"
```

---

### Task 2: Replace the media wall with the editor-native document flow

**Files:**
- Modify: `src/views/DetailView.tsx`
- Modify: `src/views/DetailView.css`
- Delete: `src/components/trades/TradeMedia.tsx`
- Delete: `src/components/trades/TradeMedia.css`

**Interfaces:**
- Consumes: `partitionDisplayActivities(getTradeActivities(trade))` from Task 1.
- Preserves: `Editor`, `onEditorChange`, `resolveNoteForDisplay`, `normalizeNoteForStorage`, `openLightbox`, `TradeDetailLayout`, and the existing properties JSX.
- Produces: visible `.dv-comments` and collapsed `.dv-system-activity` regions.

- [ ] **Step 1: Remove media-wall state and imports**

In `src/views/DetailView.tsx`:

- Remove the `TradeMedia` import.
- Remove `extractEditorImages`.
- Remove `activeMediaIndex`, `editorImages`, and the effect that clamps the active index.
- Keep the editor and lightbox integration in `src/editor/Editor.tsx` unchanged.
- Import `partitionDisplayActivities` with `getTradeActivities`.
- Add `const [activityOpen, setActivityOpen] = useState(false)`.
- Reset both `activityOpen` and `feedExpanded` when `trade.id` changes.

Use:

```ts
useEffect(() => {
  setActivityOpen(false)
  setFeedExpanded(false)
}, [trade?.id])
```

- [ ] **Step 2: Derive comment and system feed items separately**

Replace the combined feed derivation with:

```ts
const activities = useMemo(
  () => (trade ? partitionDisplayActivities(getTradeActivities(trade)) : { comments: [], system: [] }),
  [trade],
)

const commentItems = useMemo(
  () => activities.comments.map((event) => ({
    event,
    node: trade ? renderActivity(event, strategies, trade.tradeKind) : null,
  })),
  [activities.comments, strategies, trade],
)

const systemFeedItems = useMemo(() => {
  const all = activities.system.map((event) => ({
    event,
    node: trade ? renderActivity(event, strategies, trade.tradeKind) : null,
  }))
  if (feedExpanded || all.length <= FEED_VISIBLE) return all
  return all.slice(-FEED_VISIBLE)
}, [activities.system, strategies, trade, feedExpanded])

const feedHiddenCount =
  feedExpanded || activities.system.length <= FEED_VISIBLE
    ? 0
    : activities.system.length - FEED_VISIBLE
```

- [ ] **Step 3: Render the editor directly after the title**

Replace `<TradeMedia>` and `.trade-media-editor` with:

```tsx
<div className="dv-document">
  <Editor
    content={editorHtml}
    onChange={onEditorChange}
    placeholder={
      trade.tradeKind === 'case'
        ? '写下这条案例记录的复盘思路… 输入 “- ” 开始清单，“> ” 引用，可直接粘贴/拖入截图'
        : undefined
    }
  />
</div>
```

This makes every image node visible once, in its original editor position.

- [ ] **Step 4: Render comments first and system activity behind disclosure**

Replace the existing `.dv-activity` section with:

```tsx
<section className="dv-comments" aria-label="复盘评论">
  {commentItems.length > 0 && (
    <ul className="dv-feed dv-comment-feed">
      {commentItems.map(({ event, node }) => (
        <FeedItem
          key={event.id}
          kind={event.kind}
          deletable
          onDelete={event.commentId ? () => {
            removeComment(trade.id, event.commentId!)
            toast('评论已删除')
          } : undefined}
        >
          {node}
        </FeedItem>
      ))}
    </ul>
  )}
  <div className="dv-comment">
    <UserAvatar className="dv-comment-avatar" />
    <div className="dv-comment-box">
      <textarea
        ref={commentRef}
        className="dv-comment-input"
        placeholder="留下复盘评论…"
        value={comment}
        onChange={(event) => {
          setComment(event.target.value)
          adjustCommentHeight()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            sendComment()
          }
        }}
        rows={1}
      />
      <div className="dv-comment-bar">
        <Tooltip content="发送评论" label="发送评论">
          <button
            type="button"
            className="dv-comment-send"
            disabled={!comment.trim()}
            onClick={sendComment}
            aria-label="发送评论"
          >
            <Send size={14} />
          </button>
        </Tooltip>
      </div>
    </div>
  </div>
</section>

{activities.system.length > 0 && (
  <section className="dv-system-activity">
    <button
      type="button"
      className="dv-activity-toggle"
      aria-expanded={activityOpen}
      onClick={() => setActivityOpen((open) => !open)}
    >
      <span>活动记录 · {activities.system.length}</span>
      <ChevronDown size={13} className={activityOpen ? 'is-open' : ''} />
    </button>
    {activityOpen && (
      <div className="dv-activity-panel">
        {feedHiddenCount > 0 && (
          <button type="button" className="dv-feed-more" onClick={() => setFeedExpanded(true)}>
            展开更早的 {feedHiddenCount} 条
          </button>
        )}
        <ul className="dv-feed">
          {systemFeedItems.map(({ event, node }) => (
            <FeedItem key={event.id} kind={event.kind}>{node}</FeedItem>
          ))}
        </ul>
      </div>
    )}
  </section>
)}
```

- [ ] **Step 5: Apply the lightweight document styles**

In `src/views/DetailView.css`, replace the old `.dv-activity` spacing and add:

```css
.dv-document {
  width: 100%;
  min-height: 220px;
}

.dv-document .editor .ProseMirror {
  min-height: 220px;
}

.dv-document .editor img {
  width: auto;
  max-width: 100%;
  height: auto;
  margin: var(--editor-block-spacing) 0;
  object-fit: contain;
}

.dv-comments {
  width: 100%;
  min-width: 0;
  margin-top: 36px;
  padding-top: 20px;
  border-top: 1px solid var(--border-subtle);
}

.dv-comment-feed {
  margin-bottom: 16px;
}

.dv-system-activity {
  margin-top: 18px;
  border-top: 1px solid var(--border-subtle);
}

.dv-activity-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 12px 0;
  color: var(--text-tertiary);
  font-size: var(--fs-mini);
}

.dv-activity-toggle:hover {
  color: var(--text-secondary);
}

.dv-activity-toggle svg {
  transition: transform var(--dur-fast) var(--ease-out);
}

.dv-activity-toggle svg.is-open {
  transform: rotate(180deg);
}

.dv-activity-panel {
  padding: 4px 0 8px;
}
```

Remove `.trade-media-editor` references. Delete `TradeMedia.tsx` and `TradeMedia.css`; confirm no imports remain:

```powershell
rg -n "TradeMedia|trade-media-editor|trade-media-stage|trade-media-thumbs" src
```

Expected: no matches.

- [ ] **Step 6: Run focused verification**

Run:

```powershell
pnpm test
pnpm build
git diff --check
```

Expected: regression suite passes, production build succeeds, and the diff check reports no whitespace errors.

- [ ] **Step 7: Commit the document-flow UI**

```powershell
git add -- src/views/DetailView.tsx src/views/DetailView.css src/components/trades/TradeMedia.tsx src/components/trades/TradeMedia.css
git commit -m "feat: simplify trade detail document flow"
```

---

### Task 3: Verify the real trade-detail experience

**Files:**
- No source files unless verification exposes a defect directly caused by Tasks 1–2.

**Interfaces:**
- Consumes: the running Vite app at `http://127.0.0.1:5181` and an existing trade containing multiple images and comments.
- Produces: browser evidence for the acceptance criteria; no persisted test-data mutation is required.

- [ ] **Step 1: Open an existing multi-image trade**

Use the current Chrome tab and navigate through the visible trade list into a trade that already contains multiple screenshots and at least one comment. Do not seed or overwrite the user's data.

Expected: the detail route loads with the existing right property sidebar unchanged.

- [ ] **Step 2: Verify the initial document flow**

Check the DOM and screenshot for all of the following:

- No element matches `.trade-media`, `.trade-media-stage`, or `.trade-media-thumbs`.
- All note images are descendants of `.dv-document .ProseMirror`.
- Images appear vertically in document order and fit within the main column.
- `.dv-comments` and the comment input are visible.
- The “活动记录 · N” button has `aria-expanded="false"`.

- [ ] **Step 3: Verify system activity disclosure**

Click the unique “活动记录 · N” button, then verify:

- `aria-expanded="true"`.
- Create, status, note, tag, or strategy events appear.
- Comment events remain in the visible comment section and are not duplicated inside system activity.

Click the button again and verify `aria-expanded="false"`.

- [ ] **Step 4: Verify the image lightbox without editing data**

Double-click one existing editor image and verify the lightbox opens. Close it with the visible close control or Escape and confirm the editor returns to the same position.

- [ ] **Step 5: Verify desktop and narrow layouts**

At the normal desktop viewport, confirm the right properties sidebar remains visible. At 900 px width, confirm the existing properties drawer toggle still works and the editor images do not overflow horizontally. Restore the normal viewport afterward.

- [ ] **Step 6: Run the final verification gate**

Run:

```powershell
pnpm test
pnpm build
git diff --check
```

Expected: all tests pass, build succeeds, and no whitespace errors are reported.
