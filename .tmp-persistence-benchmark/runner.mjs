import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import electronRuntime from "electron";
import "archiver";
import initSqlJs from "sql.js";
import "yauzl";
//#endregion
//#region src/config/defaultProfile.ts
var DEFAULT_PROFILE = {
	schema: "yunkoo-atlas-default-profile",
	schemaVersion: 1,
	app: "Trader Atlas",
	profile: {
		"name": "默认配置",
		"version": "1.0.0",
		"description": "Trader Atlas 新资料库的中性起始配置。"
	},
	user: { "displayName": "交易者" },
	settings: { "display": {
		"hideClosed": false,
		"showEmptyGroups": false,
		"groupMode": "date",
		"sortBy": "date"
	} },
	tags: {
		"general": [],
		"mistakes": [
			"缺乏耐心",
			"仓位大小错误",
			"修改止损",
			"情绪化交易"
		]
	},
	strategies: [{
		"id": "uncategorized",
		"name": "未分类",
		"icon": "target",
		"color": "#5e6ad2"
	}],
	shortcuts: {
		"global.commandPalette": { "key": "w" },
		"global.commandPaletteMod": {
			"mod": true,
			"key": "k"
		},
		"global.newTrade": { "key": "n" },
		"global.newCase": {
			"shift": true,
			"key": "n"
		},
		"global.newQuickNote": {
			"alt": true,
			"shift": true,
			"key": "n"
		},
		"global.undo": {
			"mod": true,
			"key": "z"
		},
		"global.redo": {
			"mod": true,
			"shift": true,
			"key": "z"
		},
		"global.closeOverlay": { "key": "escape" },
		"global.toggleFullscreen": { "key": "f11" },
		"nav.today": {
			"alt": true,
			"key": "t"
		},
		"nav.quickNotes": {
			"alt": true,
			"key": "n"
		},
		"nav.active": {
			"alt": true,
			"key": "1"
		},
		"nav.favorites": {
			"alt": true,
			"key": "2"
		},
		"nav.missed": {
			"alt": true,
			"key": "3"
		},
		"nav.sim": { "key": "g" },
		"nav.list": {
			"alt": true,
			"key": "w"
		},
		"nav.reviewCases": {
			"alt": true,
			"key": "c"
		},
		"nav.weeklyReview": {
			"alt": true,
			"key": "4"
		},
		"nav.reviewSession": {
			"alt": true,
			"key": "6"
		},
		"nav.board": {
			"alt": true,
			"key": "5"
		},
		"nav.dashboard": { "key": "i" },
		"nav.strategies": { "key": "o" },
		"view.list": { "key": "l" },
		"view.board": { "key": "b" },
		"trade.prev": { "key": "q" },
		"trade.next": { "key": "e" },
		"trade.backToList": { "key": "escape" },
		"list.focusNext": { "key": "q" },
		"list.focusPrev": { "key": "e" },
		"list.openFocused": { "key": "enter" },
		"list.selectAll": {
			"mod": true,
			"key": "a"
		},
		"list.clearSelection": { "key": "escape" },
		"list.toggleFilters": { "key": "f" },
		"image.prev": { "key": "w" },
		"image.next": { "key": "s" },
		"image.close": { "key": "escape" },
		"image.reset": {
			"alt": true,
			"key": "r"
		}
	}
};
var DEFAULT_PROFILE_DISPLAY = DEFAULT_PROFILE.settings.display;
var DEFAULT_USER_DISPLAY_NAME = DEFAULT_PROFILE.user.displayName;
function createDefaultUserProfile() {
	return {
		avatarId: null,
		displayName: DEFAULT_USER_DISPLAY_NAME,
		customAvatarDataUrl: null
	};
}
function createDefaultStrategies() {
	return DEFAULT_PROFILE.strategies.map((strategy) => ({ ...strategy }));
}
function decodeHtmlEntities(value) {
	const named = {
		amp: "&",
		apos: "'",
		gt: ">",
		lt: "<",
		nbsp: " ",
		quot: "\""
	};
	return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, token) => {
		const lower = token.toLowerCase();
		const codePoint = lower.startsWith("#x") ? Number.parseInt(lower.slice(2), 16) : lower.startsWith("#") ? Number.parseInt(lower.slice(1), 10) : null;
		if (codePoint !== null) return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 1114111 ? String.fromCodePoint(codePoint) : entity;
		return named[lower] ?? entity;
	});
}
function textFromQuickNoteHtml(html) {
	if (!html) return "";
	return decodeHtmlEntities(html.replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function titleFromQuickNoteHtml(html) {
	return textFromQuickNoteHtml(html).slice(0, 42) || "无标题随记";
}
function isQuickNote$1(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const note = value;
	return typeof note.id === "string" && Boolean(note.id.trim()) && typeof note.title === "string" && typeof note.contentHtml === "string" && typeof note.pinned === "boolean" && typeof note.createdAt === "string" && typeof note.updatedAt === "string";
}
function normalizeQuickNotes(value) {
	if (!Array.isArray(value)) return [];
	const byId = /* @__PURE__ */ new Map();
	for (const item of value) {
		if (!isQuickNote$1(item)) continue;
		const title = item.title.trim().slice(0, 80) || titleFromQuickNoteHtml(item.contentHtml);
		byId.set(item.id, {
			...item,
			title
		});
	}
	return [...byId.values()].sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt.localeCompare(left.updatedAt));
}
//#endregion
//#region src/data/reviewTemplates.ts
var DEFAULT_REVIEW_TEMPLATE = {
	id: "review-template-multi-timeframe",
	name: "多周期盘面",
	content: [
		"HTF 背景：",
		"MTF 触发：",
		"LTF 执行：",
		"复盘结论："
	].join("\n")
};
function createDefaultReviewTemplates() {
	return [{ ...DEFAULT_REVIEW_TEMPLATE }];
}
function normalizeReviewTemplates(value) {
	if (value === void 0) return createDefaultReviewTemplates();
	if (!Array.isArray(value)) return createDefaultReviewTemplates();
	const seenIds = /* @__PURE__ */ new Set();
	const normalized = [];
	for (const item of value) {
		if (!item || typeof item !== "object") continue;
		const candidate = item;
		const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
		const rawName = typeof candidate.name === "string" ? candidate.name.slice(0, 40) : "";
		const name = rawName.trim() ? rawName : "";
		const content = typeof candidate.content === "string" ? candidate.content.slice(0, 4e3) : "";
		if (!id || !name || seenIds.has(id)) continue;
		seenIds.add(id);
		normalized.push({
			id,
			name,
			content
		});
		if (normalized.length >= 30) break;
	}
	return normalized;
}
//#endregion
//#region src/lib/periods.ts
var CALENDAR_PERIODS = [
	"today",
	"this-week",
	"last-week",
	"this-month",
	"last-month"
];
function normalizeTradingDayStartHour(value) {
	if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 23) return value;
	return 6;
}
/** 解析 YYYY-MM-DD 为本地日历日（避免 UTC 偏移） */
function parseLocalDate(iso) {
	if (!iso || iso.length < 10) return /* @__PURE__ */ new Date();
	const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
	if (isNaN(y) || isNaN(m) || isNaN(d)) return /* @__PURE__ */ new Date();
	return new Date(y, m - 1, d);
}
function formatYmd(d) {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
//#endregion
//#region src/lib/tradeStatus.ts
/** 已执行并平仓（计入胜率 / 权益曲线） */
function isExecutedClosed(status) {
	return status === "win" || status === "loss" || status === "breakeven";
}
/** 错过机会（终态、假设盈亏） */
function isMissed(status) {
	return status === "missed";
}
/** 终态（含错过），可写 closedAt */
function isTerminal(status) {
	return isExecutedClosed(status) || isMissed(status);
}
//#endregion
//#region src/lib/tradeCalc.ts
/** 根据盈亏与风险金额计算 R 倍数 */
function calcR(pnl, risk) {
	if (!risk) return null;
	return Math.round(pnl / risk * 1e4) / 1e4;
}
/** 根据方向计算价格变化，不混入仓位、合约乘数或货币单位。 */
function calcPriceResult(side, entry, exit) {
	if (!entry || !exit) return null;
	return side === "long" ? exit - entry : entry - exit;
}
/** 使用已冻结的初始止损距离；方向只影响价格结果，风险本身始终取正的价格距离。 */
function calcRFromFrozenPriceRisk(entry, priceResult, initialStopLoss) {
	if (!entry || priceResult == null || !initialStopLoss) return null;
	const initialRisk = Math.abs(entry - initialStopLoss);
	return initialRisk > 0 ? calcR(priceResult, initialRisk) : null;
}
//#endregion
//#region src/lib/tradeTruth.ts
function finiteMetric(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}
var RESULT_SOURCES$1 = /* @__PURE__ */ new Set([
	"pnl",
	"r",
	"price",
	"imported"
]);
function isTradeResultAuthorityConsistent(trade) {
	if (trade.resultSource === void 0) return true;
	if (!RESULT_SOURCES$1.has(trade.resultSource)) return false;
	const hasPnl = finiteMetric(trade.pnl) !== null;
	const hasR = finiteMetric(trade.rMultiple) !== null;
	switch (trade.resultSource) {
		case "pnl": return hasPnl && !hasR;
		case "r": return !hasPnl && hasR;
		case "price": {
			if (hasPnl || !hasR || trade.side !== "long" && trade.side !== "short") return false;
			const entry = finiteMetric(trade.entry);
			const exit = finiteMetric(trade.exit);
			const initialRisk = finiteMetric(trade.initialStopLoss) ?? finiteMetric(trade.stopLoss);
			if (entry === null || exit === null || initialRisk === null) return false;
			const calculated = calcRFromFrozenPriceRisk(entry, calcPriceResult(trade.side, entry, exit), initialRisk);
			const stored = finiteMetric(trade.rMultiple);
			return calculated !== null && stored !== null && Math.abs(calculated - stored) < 1e-6;
		}
		case "imported": return hasPnl && hasR;
		default: return false;
	}
}
function resolveTradeResultSource(trade) {
	if (trade.resultSource !== void 0) return RESULT_SOURCES$1.has(trade.resultSource) ? trade.resultSource : void 0;
	const hasPnl = finiteMetric(trade.pnl) !== null;
	const hasR = finiteMetric(trade.rMultiple) !== null;
	if (hasPnl && hasR) return "imported";
	if (hasPnl) return "pnl";
	if (hasR) return "r";
}
/** 把历史占位 0 迁移为缺失值，同时保留明确的保本结果。 */
function normalizeTradeMetrics(trade) {
	let pnl = finiteMetric(trade.pnl);
	let rMultiple = finiteMetric(trade.rMultiple);
	if (trade.status !== "breakeven") {
		if (pnl === 0) pnl = null;
		if (rMultiple === 0) rMultiple = null;
	}
	const removedPlaceholder = pnl !== trade.pnl || rMultiple !== trade.rMultiple;
	return {
		...trade,
		pnl,
		rMultiple,
		resultSource: resolveTradeResultSource({
			...trade,
			pnl,
			rMultiple,
			resultSource: removedPlaceholder ? void 0 : trade.resultSource
		})
	};
}
//#endregion
//#region src/data/weeklyReviews.ts
function normalizeWeeklyReviews(value) {
	if (!value) return [];
	const byWeek = /* @__PURE__ */ new Map();
	for (const review of value) {
		const normalized = review.metricsSnapshot && (review.metricsSnapshot.missedCount === void 0 || review.metricsSnapshot.missedReasonCounts === void 0) ? {
			...review,
			metricsSnapshot: {
				...review.metricsSnapshot,
				missedCount: review.metricsSnapshot.missedCount ?? 0,
				missedReasonCounts: review.metricsSnapshot.missedReasonCounts ?? {}
			}
		} : review;
		const current = byWeek.get(review.weekStart);
		if (!current || normalized.updatedAt >= current.updatedAt) byWeek.set(normalized.weekStart, normalized);
	}
	return [...byWeek.values()].sort((left, right) => right.weekStart.localeCompare(left.weekStart));
}
//#endregion
//#region src/lib/routeContext.ts
var LEGACY_TABLE_SUFFIX = "/table";
/** 旧版表格视图链接单向迁移到对应列表；不再把 table 视为工作台模式。 */
function listPathFromLegacyTablePath(pathname) {
	const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
	if (clean === LEGACY_TABLE_SUFFIX) return "/list";
	if (!clean.endsWith(LEGACY_TABLE_SUFFIX)) return null;
	return clean.slice(0, -6) || "/list";
}
var ENUM_FACET_VALUES = {
	tradeKind: Object.keys({
		live: "实盘",
		paper: "模拟"
	}),
	side: ["long", "short"],
	status: Object.keys({
		planned: "计划中",
		open: "进行中",
		missed: "错过机会",
		win: "盈利",
		loss: "亏损",
		breakeven: "保本"
	}),
	reviewCategory: Object.keys({
		normal: "普通",
		mistake: "错题集",
		focus: "重点案例",
		ambiguous: "模棱两可",
		recheck: "待复看",
		mastered: "已掌握"
	}),
	caseType: Object.keys({
		exemplar: "优秀范例",
		mistake: "错误案例",
		ambiguous: "模糊决策",
		missed: "错过机会"
	}),
	masteryState: Object.keys({
		new: "新案例",
		recheck: "待复看",
		mastered: "已掌握"
	}),
	session: Object.keys({
		london: "伦敦盘",
		"new-york": "纽约盘",
		asia: "亚盘",
		outside: "盘外时段",
		other: "其他时段"
	}),
	period: CALENDAR_PERIODS
};
function isRecord$3(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** 清理已知单选 facet，保留 symbol/tag/source 等自由文本或未来参数。 */
function canonicalizeTradeViewSearch(search) {
	const params = new URLSearchParams(search instanceof URLSearchParams ? search.toString() : search);
	for (const [key, allowed] of Object.entries(ENUM_FACET_VALUES)) {
		const raw = params.get(key);
		const value = raw?.trim();
		if (!value || !allowed.includes(value)) {
			params.delete(key);
			continue;
		}
		if (raw !== value || params.getAll(key).length > 1) params.set(key, value);
	}
	return params;
}
function normalizeSavedViewPath(pathname) {
	const clean = pathname.trim().split(/[?#]/, 1)[0] || "/list";
	const legacyListPath = listPathFromLegacyTablePath(clean);
	if (legacyListPath) return legacyListPath;
	if (clean === "/board") return "/list";
	const withoutMode = clean.replace(/\/board\/?$/, "");
	const withLeadingSlash = withoutMode.startsWith("/") ? withoutMode : `/${withoutMode}`;
	const normalized = withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, "") : withLeadingSlash;
	if (normalized === "/paper" || normalized === "/practice") return "/sim";
	return normalized;
}
function normalizeSearch(search) {
	if (!isRecord$3(search)) return {};
	const normalized = Object.fromEntries(Object.entries(search).filter((entry) => {
		const [key, value] = entry;
		return Boolean(key.trim()) && typeof value === "string" && Boolean(value.trim());
	}).map(([key, value]) => [key.trim(), value.trim()]).sort(([left], [right]) => left.localeCompare(right)));
	return searchParamsToRecord(new URLSearchParams(normalized));
}
function searchParamsToRecord(searchParams) {
	return Object.fromEntries([...canonicalizeTradeViewSearch(searchParams).entries()].filter(([key, value]) => Boolean(key.trim()) && Boolean(value.trim())).sort(([left], [right]) => left.localeCompare(right)));
}
function normalizeSavedTradeViews(value) {
	if (!Array.isArray(value)) return [];
	const seen = /* @__PURE__ */ new Set();
	return value.filter(isRecord$3).map((item) => {
		const id = typeof item.id === "string" ? item.id.trim() : "";
		const name = typeof item.name === "string" ? item.name.trim() : "";
		if (!id || !name || seen.has(id)) return null;
		seen.add(id);
		const now = (/* @__PURE__ */ new Date()).toISOString();
		return {
			id,
			name: name.slice(0, 24),
			pathname: normalizeSavedViewPath(typeof item.pathname === "string" ? item.pathname : "/list"),
			search: normalizeSearch(item.search),
			pinned: item.pinned === true,
			order: typeof item.order === "number" && Number.isFinite(item.order) ? item.order : 0,
			createdAt: typeof item.createdAt === "string" ? item.createdAt : now,
			updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : now
		};
	}).filter((item) => item !== null).sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt));
}
//#endregion
//#region src/lib/operationalError.ts
var OperationalError = class extends Error {
	code;
	cause;
	constructor(code, message, cause) {
		super(message);
		this.name = "OperationalError";
		this.code = code;
		this.cause = cause;
	}
};
//#endregion
//#region src/data/trades.ts
/** 新建/编辑时可选的波段级别预设 */
var TIMEFRAME_PRESETS = [
	"1M",
	"5M",
	"15M",
	"30M",
	"1H",
	"2H",
	"4H",
	"1D",
	"1W"
];
/** 规范化波段级别：对齐 TIMEFRAME_PRESETS，兼容 Notion/中英文别名 */
function normalizeTimeframe(value) {
	if (!value) return void 0;
	let raw = value.trim().toUpperCase().replace(/\s+/g, "");
	if (!raw) return void 0;
	raw = raw.replace(/小时/g, "H").replace(/分钟/g, "M").replace(/日线/g, "D").replace(/天|日/g, "D").replace(/周线?/g, "W").replace(/MINUTES?/g, "M").replace(/MINS?/g, "M").replace(/HOURS?/g, "H").replace(/HRS?/g, "H").replace(/DAILY/g, "1D").replace(/DAYS?/g, "D").replace(/WEEKLY/g, "1W").replace(/WEEKS?/g, "W");
	const hPrefix = /^H(\d+)$/.exec(raw);
	if (hPrefix) raw = `${hPrefix[1]}H`;
	const mPrefix = /^M(\d+)$/.exec(raw);
	if (mPrefix) raw = `${mPrefix[1]}M`;
	const dPrefix = /^D(\d+)$/.exec(raw);
	if (dPrefix) raw = dPrefix[1] === "1" ? "1D" : `${dPrefix[1]}D`;
	const wPrefix = /^W(\d+)$/.exec(raw);
	if (wPrefix) raw = wPrefix[1] === "1" ? "1W" : `${wPrefix[1]}W`;
	const compact = /^(\d+)(M|H|D|W)$/.exec(raw);
	if (compact) {
		const amount = compact[1];
		const unit = compact[2];
		if (unit === "D" && amount === "1") return "1D";
		if (unit === "W" && amount === "1") return "1W";
		return `${amount}${unit}`;
	}
	if (TIMEFRAME_PRESETS.includes(raw)) return raw;
	return raw;
}
/** 解析波段级别；空值回退默认 4H */
function resolveTimeframe(value) {
	return normalizeTimeframe(value) ?? "4H";
}
//#endregion
//#region src/lib/reviewAnalytics.ts
var DEFAULT_REVIEW_STATUS = "unreviewed";
var DEFAULT_REVIEW_CATEGORY = "normal";
var REVIEW_CATEGORIES$1 = [
	"normal",
	"mistake",
	"focus",
	"ambiguous",
	"recheck",
	"mastered"
];
function normalizeReviewFields(trade) {
	const rawReviewStatus = trade.reviewStatus;
	const reviewStatus = rawReviewStatus === "reviewed" || rawReviewStatus === "focus" ? rawReviewStatus : DEFAULT_REVIEW_STATUS;
	const mistakeTags = Array.isArray(trade.mistakeTags) ? [...new Set(trade.mistakeTags.map((x) => x.trim()).filter(Boolean))] : [];
	const rawCategory = trade.reviewCategory;
	const reviewCategory = rawCategory && REVIEW_CATEGORIES$1.includes(rawCategory) ? rawCategory : inferReviewCategory({
		...trade,
		mistakeTags,
		reviewStatus
	});
	const caseType = trade.tradeKind === "case" ? trade.caseType ?? inferCaseType({
		...trade,
		mistakeTags,
		reviewCategory
	}) : void 0;
	const masteryState = trade.tradeKind === "case" ? trade.masteryState ?? inferMasteryState({
		reviewStatus,
		reviewCategory
	}) : void 0;
	let nextReviewAt = trade.nextReviewAt;
	if (trade.tradeKind === "case" && masteryState !== "mastered" && nextReviewAt === void 0) {
		const rawDate = trade.recordedAt ?? trade.openedAt;
		const base = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? parseLocalDate(rawDate) : new Date(rawDate);
		if (Number.isFinite(base.getTime())) {
			base.setDate(base.getDate() + 3);
			nextReviewAt = formatYmd(base);
		}
	}
	if (masteryState === "mastered") nextReviewAt = null;
	return {
		...trade,
		mistakeTags,
		reviewStatus,
		reviewCategory,
		timeframe: resolveTimeframe(trade.timeframe),
		caseType,
		masteryState,
		nextReviewAt
	};
}
function inferCaseType(trade) {
	if (trade.status === "missed") return "missed";
	if (trade.reviewCategory === "ambiguous") return "ambiguous";
	if (trade.reviewCategory === "mistake" || trade.mistakeTags.length > 0) return "mistake";
	return "exemplar";
}
function inferMasteryState(trade) {
	if (trade.reviewStatus === "reviewed" || trade.reviewCategory === "mastered") return "mastered";
	if (trade.reviewCategory === "recheck") return "recheck";
	return "new";
}
function inferReviewCategory(trade) {
	if (trade.reviewStatus === "focus") return "focus";
	if (trade.reviewStatus === "reviewed") return "mastered";
	if (trade.mistakeTags.length > 0) return "mistake";
	return DEFAULT_REVIEW_CATEGORY;
}
//#endregion
//#region src/lib/tradeView.ts
/** 新建 / 详情可点选的交易时段预设（写入 Trade.session） */
var SESSION_PRESETS = [
	{
		value: "London Open",
		label: "伦敦开盘",
		kind: "london"
	},
	{
		value: "London Close",
		label: "伦敦收盘",
		kind: "london"
	},
	{
		value: "London",
		label: "伦敦盘",
		kind: "london"
	},
	{
		value: "Asia",
		label: "亚盘",
		kind: "asia"
	},
	{
		value: "New York Open",
		label: "纽约开盘",
		kind: "new-york"
	},
	{
		value: "New York Close",
		label: "纽约收盘",
		kind: "new-york"
	},
	{
		value: "New York",
		label: "纽约盘",
		kind: "new-york"
	},
	{
		value: "Out of Session",
		label: "盘外时段",
		kind: "outside"
	}
];
function sessionMetaFromValue(value) {
	const raw = value.trim();
	if (!raw) return null;
	const normalized = raw.toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ");
	if (/out of session|outside session|盘外|非交易时段/.test(normalized)) return {
		raw,
		label: "盘外时段",
		kind: "outside"
	};
	if (/london|伦敦/.test(normalized)) return {
		raw,
		label: /close|收盘/.test(normalized) ? "伦敦收盘" : /open|开盘/.test(normalized) ? "伦敦开盘" : "伦敦盘",
		kind: "london"
	};
	if (/new york|newyork|ny session|ny open|纽约|美盘/.test(normalized)) return {
		raw,
		label: /close|收盘/.test(normalized) ? "纽约收盘" : /open|开盘/.test(normalized) ? "纽约开盘" : "纽约盘",
		kind: "new-york"
	};
	if (/asia|asian|tokyo|亚盘|亚洲|东京/.test(normalized)) return {
		raw,
		label: "亚盘",
		kind: "asia"
	};
	return null;
}
function getTradeSessionMeta(trade) {
	if (trade.session?.trim()) return sessionMetaFromValue(trade.session) ?? {
		raw: trade.session.trim(),
		label: trade.session.trim(),
		kind: "other"
	};
	for (const tag of trade.tags) {
		const meta = sessionMetaFromValue(tag);
		if (meta) return meta;
	}
	return null;
}
/** 规范化时段字符串；空值表示未设置 */
function normalizeSession(value) {
	const raw = value?.trim();
	if (!raw) return void 0;
	const exact = SESSION_PRESETS.find((preset) => preset.value.toLowerCase() === raw.toLowerCase() || preset.label === raw);
	if (exact) return exact.value;
	const meta = sessionMetaFromValue(raw);
	if (!meta) return raw;
	return SESSION_PRESETS.find((preset) => preset.label === meta.label)?.value ?? raw;
}
/** 下拉当前值：优先 session 字段，兼容旧数据里写在标签中的时段 */
function getSessionSelectValue(trade) {
	const meta = getTradeSessionMeta(trade);
	if (!meta) return "";
	return SESSION_PRESETS.find((item) => item.label === meta.label || item.value.toLowerCase() === meta.raw.toLowerCase())?.value ?? meta.raw;
}
/** 把标签里的时段提升为独立 session 字段，避免新案例只能靠标签 */
function promoteTradeSession(trade) {
	const normalized = normalizeSession(trade.session);
	if (normalized) return normalized === trade.session ? trade : {
		...trade,
		session: normalized
	};
	const fromTags = getSessionSelectValue(trade);
	if (!fromTags) return trade;
	return {
		...trade,
		session: fromTags
	};
}
var PSYCHOLOGY_ALIASES = {
	neutral: "Neutral",
	中性: "Neutral",
	confident: "Confident",
	自信: "Confident",
	calm: "Calm",
	冷静: "Calm",
	fearful: "Fearful",
	fear: "Fearful",
	恐惧: "Fearful",
	anxious: "Anxious",
	焦虑: "Anxious",
	fomo: "FOMO",
	revenge: "Revenge",
	报复: "Revenge",
	报复交易: "Revenge"
};
var NARRATIVE_ALIASES = {
	bullish: "Bullish",
	看涨: "Bullish",
	偏多: "Bullish",
	bearish: "Bearish",
	看跌: "Bearish",
	偏空: "Bearish",
	neutral: "Neutral",
	中性: "Neutral",
	range: "Range",
	ranging: "Range",
	震荡: "Range"
};
function normalizePsychology(value) {
	const raw = value?.trim();
	if (!raw) return void 0;
	return PSYCHOLOGY_ALIASES[raw.toLowerCase()] ?? raw;
}
function normalizeNarrative(value) {
	const raw = value?.trim();
	if (!raw) return void 0;
	return NARRATIVE_ALIASES[raw.toLowerCase()] ?? raw;
}
var NOTION_BODY_META_RE = /<p>\s*<strong>\s*(市场叙事|心理状态)\s*<\/strong>\s*:\s*([^<]*)<\/p>/gi;
/** 从旧版 Notion 导入正文中拆出叙事/心理状态，并清除对应段落 */
function extractNotionBodyMeta(note) {
	let narrative;
	let psychology;
	return {
		note: note.replace(NOTION_BODY_META_RE, (_match, label, value) => {
			const trimmed = value.trim();
			if (!trimmed) return "";
			if (label === "市场叙事") narrative = trimmed;
			if (label === "心理状态") psychology = trimmed;
			return "";
		}).replace(/(?:\s*<p>\s*<\/p>\s*)+/gi, "\n").replace(/\n{3,}/g, "\n\n").trim(),
		narrative: normalizeNarrative(narrative),
		psychology: normalizePsychology(psychology)
	};
}
/** 提升正文里的叙事/心理状态为独立属性，避免继续堆在笔记里 */
function promoteTradeNotionMeta(trade) {
	const currentNote = trade.note ?? "";
	const normalizedPsychology = normalizePsychology(trade.psychology);
	const normalizedNarrative = normalizeNarrative(trade.narrative);
	if (!currentNote.includes("市场叙事") && !currentNote.includes("心理状态") && currentNote === currentNote.trim() && normalizedPsychology === trade.psychology && normalizedNarrative === trade.narrative) return trade;
	const extracted = extractNotionBodyMeta(currentNote);
	const psychology = normalizedPsychology ?? extracted.psychology;
	const narrative = normalizedNarrative ?? extracted.narrative;
	const note = extracted.note;
	if (note === currentNote && psychology === trade.psychology && narrative === trade.narrative) return trade;
	return {
		...trade,
		note,
		...psychology ? { psychology } : { psychology: void 0 },
		...narrative ? { narrative } : { narrative: void 0 }
	};
}
//#endregion
//#region src/lib/tradeResult.ts
function validStopLoss(value) {
	return typeof value === "number" && Number.isFinite(value) && value !== 0 ? value : null;
}
/** 首次记录止损时冻结风险；旧记录第一次移动止损时优先保留移动前的值。 */
function freezeInitialStopLossPatch(trade, nextStopLoss) {
	if (validStopLoss(trade.initialStopLoss) != null) return {};
	const initialStopLoss = validStopLoss(trade.stopLoss) ?? validStopLoss(nextStopLoss);
	return initialStopLoss == null ? {} : { initialStopLoss };
}
/**
* 为创建、导入及旧版记录补齐当前能确定的初始风险。
* 旧版记录若曾移动止损但未保存 initialStopLoss，历史原值无法还原，只能以当前止损尽力迁移。
*/
function normalizeInitialStopLoss(trade) {
	const patch = freezeInitialStopLossPatch(trade, trade.stopLoss);
	return "initialStopLoss" in patch ? {
		...trade,
		...patch
	} : trade;
}
//#endregion
//#region src/lib/tradeKind.ts
/** 旧版 practice 与 paper 语义相同，统一为 paper（模拟） */
function normalizeTradeKind(kind) {
	if (kind === "live") return "live";
	if (kind === "case") return "case";
	return "paper";
}
function normalizeTrades(trades) {
	return trades.map((t) => {
		const tradeKind = normalizeTradeKind(t.tradeKind);
		return normalizeInitialStopLoss(normalizeTradeMetrics(promoteTradeNotionMeta(promoteTradeSession(normalizeReviewFields(tradeKind === t.tradeKind ? t : {
			...t,
			tradeKind
		})))));
	});
}
/** 侧栏配置升级：practice 合并进 paper（模拟） */
function normalizeSidebarPins(pins) {
	const out = [];
	for (const id of pins) {
		if (id === "practice") {
			if (!out.includes("paper")) out.push("paper");
			continue;
		}
		if (id === "active" || id === "favorites" || id === "missed" || id === "paper") {
			if (!out.includes(id)) out.push(id);
		}
	}
	return out;
}
//#endregion
//#region src/lib/strategies.ts
/** 将旧版 trade.strategy（名称字符串）迁移为 strategyId，并补全 tradeKind */
function migrateTradeStrategy(trade, strategies) {
	let base;
	if (trade.strategyId && strategies.some((strategy) => strategy.id === trade.strategyId)) base = trade;
	else {
		const legacy = trade.strategy ?? trade.strategyId;
		if (legacy) {
			const byName = strategies.find((s) => s.name === legacy);
			const byId = strategies.find((s) => s.id === legacy);
			const id = byName?.id ?? byId?.id ?? strategies[0]?.id ?? "uncategorized";
			const { strategy: _drop, ...rest } = trade;
			base = {
				...rest,
				strategyId: id
			};
		} else base = {
			...trade,
			strategyId: strategies[0]?.id ?? "uncategorized"
		};
	}
	return {
		...base,
		tradeKind: normalizeTradeKind(base.tradeKind),
		closedAt: isTerminal(base.status) && !base.closedAt ? base.openedAt : base.closedAt
	};
}
function migrateTrades(trades, strategies) {
	return trades.map((t) => migrateTradeStrategy(t, strategies));
}
function ensureStrategies(raw) {
	if (raw === void 0) return createDefaultStrategies();
	return raw.map((strategy) => {
		if (!Object.prototype.hasOwnProperty.call(strategy, "reviewTemplateHtml")) return strategy;
		const { reviewTemplateHtml: _legacyTemplate, ...normalized } = strategy;
		return normalized;
	});
}
/**
* 修复旧快照中的策略引用：显式空策略的真正空库保持为空；一旦存在记录，
* 至少物化中性的未分类策略，并把未知引用收敛到真实策略 ID。
*/
function normalizeTradeStrategyReferences(trades, rawStrategies) {
	let strategies = ensureStrategies(rawStrategies);
	if (trades.length > 0 && strategies.length === 0) strategies = createDefaultStrategies();
	return {
		strategies,
		trades: migrateTrades(trades, strategies)
	};
}
//#endregion
//#region src/lib/symbolIconCodec.ts
var DEFAULT_SYMBOL_CATALOG = [
	"XAUUSD",
	"EURUSD",
	"GBPUSD",
	"BTCUSDT",
	"ETHUSDT",
	"SOLUSDT",
	"BNBUSDT"
];
function isRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeSymbol(symbol) {
	return symbol.trim().toUpperCase().replace(/[\s/_-]+/g, "");
}
function normalizeSymbolIcons(value) {
	if (!isRecord$2(value)) return {};
	const out = {};
	for (const [rawKey, rawEntry] of Object.entries(value)) {
		const key = normalizeSymbol(rawKey);
		if (!key || !isRecord$2(rawEntry)) continue;
		const presetId = typeof rawEntry.presetId === "string" && rawEntry.presetId.trim() ? rawEntry.presetId.trim() : null;
		const customDataUrl = typeof rawEntry.customDataUrl === "string" && rawEntry.customDataUrl.startsWith("data:") ? rawEntry.customDataUrl : null;
		const updatedAt = typeof rawEntry.updatedAt === "string" && rawEntry.updatedAt.trim() ? rawEntry.updatedAt : null;
		if (!presetId && !customDataUrl || !updatedAt) continue;
		out[key] = {
			presetId,
			customDataUrl,
			updatedAt
		};
	}
	return out;
}
function normalizeSymbolCatalog(value) {
	const source = Array.isArray(value) ? value : [...DEFAULT_SYMBOL_CATALOG];
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const item of source) {
		if (typeof item !== "string") continue;
		const key = normalizeSymbol(item);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(key);
	}
	return out;
}
//#endregion
//#region src/lib/tags.ts
/** 规范化并合并标签预设：去空、去重、中文排序 */
function mergeTagPresets(...sources) {
	const set = /* @__PURE__ */ new Set();
	for (const source of sources) {
		if (!source) continue;
		for (const tag of source) {
			if (typeof tag !== "string") continue;
			const trimmed = tag.trim();
			if (trimmed) set.add(trimmed);
		}
	}
	return [...set].sort((a, b) => a.localeCompare(b, "zh-CN"));
}
//#endregion
//#region src/lib/sidebarNavContract.ts
var PRIMARY_NAV_ITEMS = [
	{
		id: "today",
		to: "/today-record",
		label: "今日工作台"
	},
	{
		id: "quickNotes",
		to: "/notes",
		label: "随记"
	},
	{
		id: "trades",
		to: "/list",
		label: "交易日志"
	},
	{
		id: "reviewCases",
		to: "/review-cases",
		label: "案例记录"
	},
	{
		id: "weeklyReview",
		to: "/weekly-review",
		label: "周复盘"
	},
	{
		id: "reviewSession",
		to: "/review-session",
		label: "随机复盘"
	},
	{
		id: "dashboard",
		to: "/dashboard",
		label: "仪表盘"
	}
];
var SECONDARY_NAV_ITEMS = [
	{
		id: "active",
		to: "/active",
		label: "进行中"
	},
	{
		id: "favorites",
		to: "/favorites",
		label: "星标交易"
	},
	{
		id: "missed",
		to: "/missed",
		label: "错过的机会"
	},
	{
		id: "paper",
		to: "/sim",
		label: "模拟回测"
	}
];
var DEFAULT_PRIMARY_SIDEBAR_ORDER = PRIMARY_NAV_ITEMS.map((item) => item.id);
var DEFAULT_SIDEBAR_PINS = SECONDARY_NAV_ITEMS.map((item) => item.id);
function normalizePrimarySidebarOrder(input) {
	const valid = new Set(DEFAULT_PRIMARY_SIDEBAR_ORDER);
	const ordered = Array.isArray(input) ? input.filter((id) => typeof id === "string" && valid.has(id)) : [];
	return [...new Set(ordered), ...DEFAULT_PRIMARY_SIDEBAR_ORDER.filter((id) => !ordered.includes(id))];
}
//#endregion
//#region src/lib/sidebarWorkspace.ts
var SIDEBAR_CAPABILITY_WORKSPACES = {
	missed: [
		"trade",
		"paper",
		"case"
	],
	active: ["trade", "paper"]
};
var CAPABILITY_ROUTES = {
	"trade:missed": {
		pathname: "/missed",
		search: "",
		icon: "missed"
	},
	"trade:active": {
		pathname: "/active",
		search: "",
		icon: "active"
	},
	"paper:missed": {
		pathname: "/sim",
		search: "?status=missed",
		icon: "missed"
	},
	"paper:active": {
		pathname: "/sim",
		search: "?status=open",
		icon: "active"
	},
	"case:missed": {
		pathname: "/review-cases",
		search: "?caseType=missed",
		icon: "missed"
	},
	"case:active": null
};
var SYSTEM_IDS = [
	"active",
	"favorites",
	"missed",
	"paper"
];
var CASE_SCOPES = [
	"focus",
	"mistakes",
	"unreviewed",
	"reviewed"
];
function isSidebarCapabilityId(id) {
	return id === "missed" || id === "active";
}
function sidebarTargetKey(target) {
	switch (target.kind) {
		case "system": return `system:${target.id}`;
		case "saved-view": return `saved-view:${target.viewId}`;
		case "strategy": return `strategy:${target.strategyId}`;
		case "case-view": return `case-view:${target.scope}`;
	}
}
function normalizeWorkspaceList(value, allowed, fallback) {
	const allowedSet = new Set(allowed);
	const parsed = Array.isArray(value) ? value.filter((item) => typeof item === "string" && allowedSet.has(item)) : [];
	const unique = [...new Set(parsed)];
	return unique.length > 0 ? unique : [...fallback];
}
/** 能力项的可见工作区；旧数据无字段时默认全开（可被用户收窄） */
function systemCapabilityWorkspaces(target) {
	if (!isSidebarCapabilityId(target.id)) return [];
	const allowed = SIDEBAR_CAPABILITY_WORKSPACES[target.id];
	return normalizeWorkspaceList(target.workspaces, allowed, allowed);
}
function normalizeTarget(value) {
	if (!value || typeof value !== "object") return null;
	const target = value;
	if (target.kind === "system" && SYSTEM_IDS.includes(target.id)) {
		const id = target.id;
		if (isSidebarCapabilityId(id)) return {
			kind: "system",
			id,
			workspaces: systemCapabilityWorkspaces({
				kind: "system",
				id,
				workspaces: target.workspaces
			})
		};
		return {
			kind: "system",
			id
		};
	}
	if (target.kind === "quick-view" && (target.workspace === "trade" || target.workspace === "paper" || target.workspace === "case") && isSidebarCapabilityId(String(target.view)) && CAPABILITY_ROUTES[`${target.workspace}:${target.view}`]) return {
		kind: "system",
		id: target.view,
		workspaces: [target.workspace]
	};
	if (target.kind === "saved-view" && typeof target.viewId === "string" && target.viewId.trim()) return {
		kind: "saved-view",
		viewId: target.viewId
	};
	if (target.kind === "strategy" && typeof target.strategyId === "string" && target.strategyId.trim()) return {
		kind: "strategy",
		strategyId: target.strategyId
	};
	if (target.kind === "case-view" && CASE_SCOPES.includes(target.scope)) return {
		kind: "case-view",
		scope: target.scope
	};
	return null;
}
function mergeCapabilityWorkspaces(left, right, allowed) {
	return normalizeWorkspaceList([...left ?? [], ...right ?? []], allowed, ["trade"]);
}
function normalizeSidebarWorkspaceItems(value) {
	if (!Array.isArray(value)) return [];
	const normalized = value.flatMap((candidate, inputIndex) => {
		if (!candidate || typeof candidate !== "object") return [];
		const item = candidate;
		const target = normalizeTarget(item.target);
		if (!target || typeof item.id !== "string" || !item.id.trim() || item.placement !== "pinned" && item.placement !== "overflow" || typeof item.order !== "number" || !Number.isFinite(item.order)) return [];
		return [{
			item: {
				id: item.id,
				target,
				placement: item.placement,
				order: item.order
			},
			inputIndex
		}];
	});
	normalized.sort((a, b) => a.item.order - b.item.order || a.inputIndex - b.inputIndex);
	const mergedByKey = /* @__PURE__ */ new Map();
	for (const entry of normalized) {
		const key = sidebarTargetKey(entry.item.target);
		const existing = mergedByKey.get(key);
		if (!existing) {
			mergedByKey.set(key, entry);
			continue;
		}
		const left = existing.item.target;
		const right = entry.item.target;
		if (left.kind === "system" && right.kind === "system" && isSidebarCapabilityId(left.id)) existing.item = {
			...existing.item,
			placement: existing.item.placement === "pinned" || entry.item.placement === "pinned" ? "pinned" : "overflow",
			target: {
				kind: "system",
				id: left.id,
				workspaces: mergeCapabilityWorkspaces(left.workspaces, right.workspaces, SIDEBAR_CAPABILITY_WORKSPACES[left.id])
			}
		};
	}
	const merged = [...mergedByKey.values()].sort((a, b) => a.item.order - b.item.order || a.inputIndex - b.inputIndex);
	let pinnedCount = 0;
	return merged.map(({ item }, order) => {
		const key = sidebarTargetKey(item.target);
		let placement = item.placement;
		if (placement === "pinned") if (pinnedCount >= 8) placement = "overflow";
		else pinnedCount += 1;
		return {
			...item,
			id: key,
			placement,
			order
		};
	});
}
function migrateSidebarPins(pins) {
	return normalizeSidebarWorkspaceItems(pins.map((id, order) => ({
		id: `system:${id}`,
		target: isSidebarCapabilityId(id) ? {
			kind: "system",
			id,
			workspaces: [...SIDEBAR_CAPABILITY_WORKSPACES[id]]
		} : {
			kind: "system",
			id
		},
		placement: "pinned",
		order
	})));
}
//#endregion
//#region src/lib/tradeFilters.ts
var DEFAULT_DISPLAY = {
	hideClosed: DEFAULT_PROFILE_DISPLAY.hideClosed,
	showEmptyGroups: DEFAULT_PROFILE_DISPLAY.showEmptyGroups,
	groupByStrategy: DEFAULT_PROFILE_DISPLAY.groupMode === "strategy",
	groupByDate: DEFAULT_PROFILE_DISPLAY.groupMode === "date",
	sortBy: DEFAULT_PROFILE_DISPLAY.sortBy,
	privacyMode: false,
	tradingDayStartHour: 6,
	reviewContextPinned: true,
	sidebarPrimaryOrder: [...DEFAULT_PRIMARY_SIDEBAR_ORDER],
	sidebarPins: [...DEFAULT_SIDEBAR_PINS],
	sidebarWorkspaceItems: migrateSidebarPins(DEFAULT_SIDEBAR_PINS)
};
var SORT_BY = [
	"date",
	"pnl",
	"conviction"
];
function normalizeWorkspaceRoute(input) {
	if (!input || typeof input !== "object") return void 0;
	const route = input;
	if (typeof route.pathname !== "string" || !route.pathname.startsWith("/")) return void 0;
	return {
		pathname: listPathFromLegacyTablePath(route.pathname) ?? route.pathname,
		search: typeof route.search === "string" ? route.search : ""
	};
}
function normalizeWorkspaceMemory(input) {
	if (!input || typeof input !== "object") return void 0;
	const memory = input;
	const today = normalizeWorkspaceRoute(memory.today);
	const trade = normalizeWorkspaceRoute(memory.trade);
	const caseRoute = normalizeWorkspaceRoute(memory.case);
	if (!today && !trade && !caseRoute) return void 0;
	return {
		...today ? { today } : {},
		...trade ? { trade } : {},
		...caseRoute ? { case: caseRoute } : {}
	};
}
/** 合并旧版/残缺 display，避免缺字段导致渲染崩溃 */
function normalizeDisplay(input) {
	const d = input ?? {};
	const sidebarPins = Array.isArray(d.sidebarPins) ? normalizeSidebarPins(d.sidebarPins) : [...DEFAULT_DISPLAY.sidebarPins];
	const sidebarWorkspaceItems = Object.prototype.hasOwnProperty.call(d, "sidebarWorkspaceItems") ? normalizeSidebarWorkspaceItems(d.sidebarWorkspaceItems) : migrateSidebarPins(sidebarPins);
	const workspaceMemory = normalizeWorkspaceMemory(d.workspaceMemory);
	return {
		hideClosed: typeof d.hideClosed === "boolean" ? d.hideClosed : DEFAULT_DISPLAY.hideClosed,
		showEmptyGroups: typeof d.showEmptyGroups === "boolean" ? d.showEmptyGroups : DEFAULT_DISPLAY.showEmptyGroups,
		groupByStrategy: typeof d.groupByStrategy === "boolean" ? d.groupByStrategy : DEFAULT_DISPLAY.groupByStrategy,
		groupByDate: typeof d.groupByDate === "boolean" ? d.groupByDate : DEFAULT_DISPLAY.groupByDate,
		sortBy: SORT_BY.includes(d.sortBy) ? d.sortBy : DEFAULT_DISPLAY.sortBy,
		privacyMode: typeof d.privacyMode === "boolean" ? d.privacyMode : DEFAULT_DISPLAY.privacyMode,
		tradingDayStartHour: normalizeTradingDayStartHour(d.tradingDayStartHour),
		reviewContextPinned: typeof d.reviewContextPinned === "boolean" ? d.reviewContextPinned : DEFAULT_DISPLAY.reviewContextPinned,
		sidebarPrimaryOrder: normalizePrimarySidebarOrder(d.sidebarPrimaryOrder),
		sidebarPins,
		sidebarWorkspaceItems,
		...workspaceMemory ? { workspaceMemory } : {}
	};
}
//#endregion
//#region src/shortcuts/migrate.ts
function migrateShortcutBindings(bindings) {
	if (!bindings) return {};
	const next = { ...bindings };
	if ("global.switchModule" in next && !("nav.list" in next)) next["nav.list"] = next["global.switchModule"] ?? null;
	delete next["global.switchModule"];
	delete next["view.table"];
	return next;
}
//#endregion
//#region src/storage/snapshotValidation.ts
var TRADE_SIDES = /* @__PURE__ */ new Set(["long", "short"]);
var TRADE_STATUSES = /* @__PURE__ */ new Set([
	"planned",
	"open",
	"missed",
	"win",
	"loss",
	"breakeven"
]);
var TRADE_KINDS = /* @__PURE__ */ new Set([
	"live",
	"paper",
	"case"
]);
var CONVICTIONS = /* @__PURE__ */ new Set([
	"low",
	"medium",
	"high",
	"urgent"
]);
var RESULT_SOURCES = /* @__PURE__ */ new Set([
	"pnl",
	"r",
	"price",
	"imported"
]);
var REVIEW_STATUSES = /* @__PURE__ */ new Set([
	"unreviewed",
	"reviewed",
	"focus"
]);
var REVIEW_CATEGORIES = /* @__PURE__ */ new Set([
	"normal",
	"mistake",
	"focus",
	"ambiguous",
	"recheck",
	"mastered"
]);
var ACTIVITY_KINDS = /* @__PURE__ */ new Set([
	"create",
	"status",
	"strategy",
	"tag",
	"comment",
	"note",
	"tradeKind"
]);
var CASE_TYPES = /* @__PURE__ */ new Set([
	"exemplar",
	"mistake",
	"ambiguous",
	"missed"
]);
var MASTERY_STATES = /* @__PURE__ */ new Set([
	"new",
	"recheck",
	"mastered"
]);
var MISS_REASONS = /* @__PURE__ */ new Set([
	"hesitation",
	"missed_setup",
	"no_alert",
	"rule_break",
	"other"
]);
var DISPLAY_SORTS = /* @__PURE__ */ new Set([
	"date",
	"pnl",
	"conviction"
]);
var SIDEBAR_SYSTEM_IDS = /* @__PURE__ */ new Set([
	"active",
	"favorites",
	"missed",
	"paper"
]);
var CASE_VIEW_SCOPES = /* @__PURE__ */ new Set([
	"focus",
	"mistakes",
	"unreviewed",
	"reviewed"
]);
var WEEKLY_REVIEW_STATUSES = /* @__PURE__ */ new Set(["draft", "completed"]);
var WEEKLY_COMMITMENT_RESULTS = /* @__PURE__ */ new Set([
	"done",
	"partial",
	"missed",
	"not-applicable"
]);
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isStringArray(value) {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function isNullableFiniteNumber(value) {
	return value === null || typeof value === "number" && Number.isFinite(value);
}
function isTradeComment(value) {
	return isRecord$1(value) && typeof value.id === "string" && typeof value.text === "string" && typeof value.createdAt === "string";
}
function isActivityEvent(value) {
	if (!isRecord$1(value) || typeof value.id !== "string" || !value.id.trim() || typeof value.timestamp !== "string" || !ACTIVITY_KINDS.has(String(value.kind))) return false;
	if (value.status !== void 0 && !TRADE_STATUSES.has(String(value.status))) return false;
	if (value.tagAction !== void 0 && value.tagAction !== "add" && value.tagAction !== "remove") return false;
	if (value.fromTradeKind !== void 0 && !TRADE_KINDS.has(String(value.fromTradeKind))) return false;
	if (value.toTradeKind !== void 0 && !TRADE_KINDS.has(String(value.toTradeKind))) return false;
	for (const field of [
		"strategyId",
		"fromStrategyId",
		"tag",
		"commentId",
		"text"
	]) if (value[field] !== void 0 && typeof value[field] !== "string") return false;
	return true;
}
function isSidebarTarget(value) {
	if (!isRecord$1(value)) return false;
	if (value.kind === "system") {
		if (!SIDEBAR_SYSTEM_IDS.has(String(value.id))) return false;
		if (value.workspaces === void 0) return true;
		if (!Array.isArray(value.workspaces)) return false;
		const id = String(value.id);
		const allowed = id === "missed" ? /* @__PURE__ */ new Set([
			"trade",
			"paper",
			"case"
		]) : id === "active" ? /* @__PURE__ */ new Set(["trade", "paper"]) : null;
		if (!allowed) return value.workspaces.length === 0;
		return value.workspaces.every((workspace) => typeof workspace === "string" && allowed.has(workspace));
	}
	if (value.kind === "saved-view") return typeof value.viewId === "string" && Boolean(value.viewId.trim());
	if (value.kind === "strategy") return typeof value.strategyId === "string" && Boolean(value.strategyId.trim());
	if (value.kind === "case-view") return CASE_VIEW_SCOPES.has(String(value.scope));
	if (value.kind === "quick-view") {
		const workspace = String(value.workspace);
		const view = String(value.view);
		if (!(workspace === "trade" || workspace === "paper" || workspace === "case")) return false;
		if (!(view === "missed" || view === "active")) return false;
		if (workspace === "case" && view === "active") return false;
		return true;
	}
	return false;
}
function isSidebarWorkspaceItem(value) {
	return isRecord$1(value) && typeof value.id === "string" && Boolean(value.id.trim()) && isSidebarTarget(value.target) && (value.placement === "pinned" || value.placement === "overflow") && typeof value.order === "number" && Number.isFinite(value.order);
}
function isWorkspaceMemoryEntry(value) {
	return isRecord$1(value) && typeof value.pathname === "string" && (value.search === void 0 || typeof value.search === "string");
}
function isDisplayPrefs(value) {
	if (value === void 0) return true;
	if (!isRecord$1(value)) return false;
	for (const field of [
		"hideClosed",
		"showEmptyGroups",
		"groupByStrategy",
		"groupByDate",
		"privacyMode",
		"reviewContextPinned"
	]) if (value[field] !== void 0 && typeof value[field] !== "boolean") return false;
	if (value.sortBy !== void 0 && !DISPLAY_SORTS.has(String(value.sortBy))) return false;
	if (value.tradingDayStartHour !== void 0 && !(typeof value.tradingDayStartHour === "number" && Number.isInteger(value.tradingDayStartHour) && value.tradingDayStartHour >= 0 && value.tradingDayStartHour <= 23)) return false;
	if (value.sidebarPins !== void 0 && !isStringArray(value.sidebarPins)) return false;
	if (value.sidebarPrimaryOrder !== void 0 && !isStringArray(value.sidebarPrimaryOrder)) return false;
	if (value.sidebarWorkspaceItems !== void 0 && (!Array.isArray(value.sidebarWorkspaceItems) || !value.sidebarWorkspaceItems.every(isSidebarWorkspaceItem))) return false;
	if (value.workspaceMemory !== void 0) {
		if (!isRecord$1(value.workspaceMemory)) return false;
		for (const field of [
			"today",
			"trade",
			"case"
		]) {
			const entry = value.workspaceMemory[field];
			if (entry !== void 0 && !isWorkspaceMemoryEntry(entry)) return false;
		}
	}
	return true;
}
function isReviewTemplates(value) {
	return value === void 0 || Array.isArray(value) && value.length <= 30 && value.every((template) => isRecord$1(template) && typeof template.id === "string" && Boolean(template.id.trim()) && typeof template.name === "string" && Boolean(template.name.trim()) && template.name.length <= 40 && typeof template.content === "string" && template.content.length <= 4e3) && !hasDuplicateStringId(value);
}
function isValidPersistedTrade(value) {
	if (!isRecord$1(value)) return false;
	if (typeof value.id !== "string" || !value.id.trim() || typeof value.ref !== "string" || typeof value.symbol !== "string" || typeof value.strategyId !== "string" || !value.strategyId.trim() || typeof value.openedAt !== "string" || !isStringArray(value.tags) || typeof value.note !== "string" || !TRADE_SIDES.has(String(value.side)) || !TRADE_STATUSES.has(String(value.status)) || !CONVICTIONS.has(String(value.conviction)) || typeof value.entry !== "number" || !Number.isFinite(value.entry) || typeof value.size !== "number" || !Number.isFinite(value.size)) return false;
	if (value.tradeKind !== void 0 && !TRADE_KINDS.has(String(value.tradeKind))) return false;
	if (value.mistakeTags !== void 0 && !isStringArray(value.mistakeTags)) return false;
	if (value.reviewStatus !== void 0 && !REVIEW_STATUSES.has(String(value.reviewStatus))) return false;
	if (value.reviewCategory !== void 0 && !REVIEW_CATEGORIES.has(String(value.reviewCategory))) return false;
	if (value.caseType !== void 0 && !CASE_TYPES.has(String(value.caseType))) return false;
	if (value.masteryState !== void 0 && !MASTERY_STATES.has(String(value.masteryState))) return false;
	if (value.missReason !== void 0 && !MISS_REASONS.has(String(value.missReason))) return false;
	for (const field of [
		"session",
		"timeframe",
		"narrative",
		"psychology",
		"recordedAt",
		"sourceTradeId",
		"deletedAt",
		"deletedBy"
	]) if (value[field] !== void 0 && typeof value[field] !== "string") return false;
	if (value.nextReviewAt !== void 0 && value.nextReviewAt !== null && typeof value.nextReviewAt !== "string") return false;
	if (!isNullableFiniteNumber(value.exit)) return false;
	if (!isNullableFiniteNumber(value.pnl)) return false;
	if (!isNullableFiniteNumber(value.rMultiple)) return false;
	if (value.stopLoss !== void 0 && !isNullableFiniteNumber(value.stopLoss)) return false;
	if (value.initialStopLoss !== void 0 && !isNullableFiniteNumber(value.initialStopLoss)) return false;
	if (value.resultSource !== void 0 && !RESULT_SOURCES.has(String(value.resultSource))) return false;
	if (!isTradeResultAuthorityConsistent(value)) return false;
	if (value.closedAt !== null && typeof value.closedAt !== "string") return false;
	if (value.reviewedAt !== void 0 && value.reviewedAt !== null && typeof value.reviewedAt !== "string") return false;
	if (value.comments !== void 0 && (!Array.isArray(value.comments) || !value.comments.every(isTradeComment))) return false;
	if (value.activities !== void 0 && (!Array.isArray(value.activities) || !value.activities.every(isActivityEvent))) return false;
	return true;
}
function isKeyChord(value) {
	if (!isRecord$1(value) || typeof value.key !== "string" || !value.key.trim()) return false;
	for (const field of [
		"mod",
		"shift",
		"alt"
	]) if (value[field] !== void 0 && typeof value[field] !== "boolean") return false;
	return true;
}
function isShortcutBinding(value) {
	return isKeyChord(value) || Array.isArray(value) && value.length > 0 && value.every(isKeyChord);
}
function isShortcutOverrides(value) {
	if (value === void 0) return true;
	if (!isRecord$1(value)) return false;
	return Object.entries(value).every(([id, binding]) => Boolean(id.trim()) && (binding === null || isShortcutBinding(binding)));
}
function isUserProfile(value) {
	return value === void 0 || isRecord$1(value) && (value.avatarId === null || typeof value.avatarId === "string") && typeof value.displayName === "string" && (value.customAvatarDataUrl === void 0 || value.customAvatarDataUrl === null || typeof value.customAvatarDataUrl === "string");
}
function isSavedTradeView(value) {
	if (!isRecord$1(value)) return false;
	if (typeof value.id !== "string" || !value.id.trim() || typeof value.name !== "string" || !value.name.trim() || typeof value.pathname !== "string" || typeof value.pinned !== "boolean" || typeof value.order !== "number" || !Number.isFinite(value.order) || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string" || !isRecord$1(value.search)) return false;
	return Object.entries(value.search).every(([key, item]) => Boolean(key.trim()) && typeof item === "string");
}
function isSavedTradeViews(value) {
	return value === void 0 || Array.isArray(value) && value.every(isSavedTradeView);
}
function isSymbolIconOverride(value) {
	if (!isRecord$1(value) || typeof value.updatedAt !== "string" || !value.updatedAt.trim()) return false;
	for (const field of ["presetId", "customDataUrl"]) if (value[field] !== void 0 && value[field] !== null && typeof value[field] !== "string") return false;
	return true;
}
function isSymbolIcons(value) {
	return value === void 0 || isRecord$1(value) && Object.entries(value).every(([symbol, override]) => Boolean(symbol.trim()) && isSymbolIconOverride(override));
}
function hasDuplicateStringId(values) {
	const ids = /* @__PURE__ */ new Set();
	for (const value of values) {
		if (!isRecord$1(value) || typeof value.id !== "string") continue;
		if (ids.has(value.id)) return true;
		ids.add(value.id);
	}
	return false;
}
function isWeeklyReviewMetrics(value) {
	if (!isRecord$1(value)) return false;
	for (const field of [
		"tradeCount",
		"reviewedCount",
		"evaluatedCount",
		"winCount",
		"lossCount",
		"breakevenCount",
		"conflictCount",
		"pnlCount",
		"totalPnl",
		"rCount"
	]) if (typeof value[field] !== "number" || !Number.isFinite(value[field])) return false;
	if (!isNullableFiniteNumber(value.winRate) || !isNullableFiniteNumber(value.averageR)) return false;
	if (!isRecord$1(value.mistakeTagCounts) || !Object.values(value.mistakeTagCounts).every((count) => typeof count === "number" && Number.isFinite(count))) return false;
	if (value.missedCount !== void 0 && (typeof value.missedCount !== "number" || !Number.isFinite(value.missedCount))) return false;
	return value.missedReasonCounts === void 0 || isRecord$1(value.missedReasonCounts) && Object.values(value.missedReasonCounts).every((count) => typeof count === "number" && Number.isFinite(count));
}
function isWeeklyReview(value) {
	if (!isRecord$1(value)) return false;
	if (typeof value.id !== "string" || !value.id.trim() || typeof value.weekStart !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.weekStart) || typeof value.weekEnd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.weekEnd) || !WEEKLY_REVIEW_STATUSES.has(String(value.status)) || typeof value.contentHtml !== "string" || typeof value.commitmentText !== "string" || typeof value.commitmentCriteria !== "string" || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") return false;
	for (const field of [
		"executionScore",
		"riskScore",
		"emotionScore"
	]) {
		const score = value[field];
		if (score !== null && (typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 5)) return false;
	}
	for (const field of [
		"strengthTags",
		"mistakeTags",
		"highlightTradeIds",
		"mistakeTradeIds",
		"followUpTradeIds"
	]) if (!isStringArray(value[field])) return false;
	if (value.previousCommitmentResult !== null && !WEEKLY_COMMITMENT_RESULTS.has(String(value.previousCommitmentResult))) return false;
	if (value.completedAt !== null && typeof value.completedAt !== "string") return false;
	return value.metricsSnapshot === null || isWeeklyReviewMetrics(value.metricsSnapshot);
}
function isQuickNote(value) {
	return isRecord$1(value) && typeof value.id === "string" && Boolean(value.id.trim()) && typeof value.title === "string" && typeof value.contentHtml === "string" && typeof value.pinned === "boolean" && typeof value.createdAt === "string" && typeof value.updatedAt === "string";
}
function isStrategy(value) {
	return isRecord$1(value) && typeof value.id === "string" && Boolean(value.id.trim()) && typeof value.name === "string" && typeof value.icon === "string" && typeof value.color === "string";
}
function assertValidPersistedSnapshot(value, label = "snapshot") {
	if (!isRecord$1(value) || !Array.isArray(value.trades) || !Array.isArray(value.strategies)) throw new Error(`${label} is missing trades or strategies`);
	if (!value.trades.every(isValidPersistedTrade)) throw new Error(`${label} contains an invalid trade`);
	if (!value.strategies.every(isStrategy)) throw new Error(`${label} contains an invalid strategy`);
	if (hasDuplicateStringId(value.trades)) throw new Error(`${label} contains duplicate trade ids`);
	if (value.weeklyReviews !== void 0) {
		if (!Array.isArray(value.weeklyReviews) || !value.weeklyReviews.every(isWeeklyReview)) throw new Error(`${label} contains an invalid weekly review`);
		if (hasDuplicateStringId(value.weeklyReviews)) throw new Error(`${label} contains duplicate weekly review ids`);
		const weeks = /* @__PURE__ */ new Set();
		for (const review of value.weeklyReviews) {
			if (weeks.has(review.weekStart)) throw new Error(`${label} contains duplicate weekly review weeks`);
			weeks.add(review.weekStart);
		}
	}
	if (value.quickNotes !== void 0) {
		if (!Array.isArray(value.quickNotes) || !value.quickNotes.every(isQuickNote)) throw new Error(`${label} contains an invalid quick note`);
		if (hasDuplicateStringId(value.quickNotes)) throw new Error(`${label} contains duplicate quick note ids`);
	}
	if (hasDuplicateStringId(value.strategies)) throw new Error(`${label} contains duplicate strategy ids`);
	if (!isDisplayPrefs(value.display)) throw new Error(`${label} contains invalid display settings`);
	if (!isReviewTemplates(value.reviewTemplates)) throw new Error(`${label} contains invalid review templates`);
	if (!isShortcutOverrides(value.shortcuts)) throw new Error(`${label} contains invalid shortcuts`);
	if (!isUserProfile(value.profile)) throw new Error(`${label} contains an invalid profile`);
	if (!isSavedTradeViews(value.savedTradeViews)) throw new Error(`${label} contains invalid saved trade views`);
	if (!isSymbolIcons(value.symbolIcons)) throw new Error(`${label} contains invalid symbol icons`);
	if (value.symbolCatalog !== void 0 && !isStringArray(value.symbolCatalog)) throw new Error(`${label}.symbolCatalog must be a string array`);
	for (const field of [
		"starredIds",
		"subscribedIds",
		"pinnedStrategyIds"
	]) if (!isStringArray(value[field])) throw new Error(`${label}.${field} must be a string array`);
	for (const field of ["tagPresets", "mistakeTagPresets"]) if (value[field] !== void 0 && !isStringArray(value[field])) throw new Error(`${label}.${field} must be a string array`);
}
//#endregion
//#region src/storage/snapshotCodec.ts
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function assertSupportedVersion(version) {
	if (!Number.isInteger(version) || version < 1 || version > 8) throw new OperationalError("unsupported-future-version", `Unsupported snapshot version: ${version}`);
}
function assertSnapshotContract(snapshot, label) {
	try {
		assertValidPersistedSnapshot(snapshot, label);
	} catch (error) {
		throw new OperationalError("snapshot-contract-invalid", error instanceof Error ? error.message : `${label} contract is invalid`, error);
	}
}
function migrateHistoricalTrade(value, version) {
	if (!isRecord(value)) return value;
	const migrated = { ...value };
	if (version === 1) {
		for (const [field, fallback] of Object.entries({
			tags: [],
			note: "",
			exit: null,
			pnl: null,
			rMultiple: null,
			closedAt: null,
			entry: 0,
			size: 0
		})) if (migrated[field] === void 0 || (field === "entry" || field === "size") && migrated[field] === null) migrated[field] = fallback;
	}
	if (version <= 6) {
		if (migrated.strategyId === void 0 && typeof migrated.strategy === "string") migrated.strategyId = migrated.strategy;
		if (migrated.tradeKind === "practice") migrated.tradeKind = "paper";
	}
	return migrated;
}
function migrateVersionedSnapshot(raw, version) {
	return {
		...raw,
		trades: Array.isArray(raw.trades) ? raw.trades.map((trade) => migrateHistoricalTrade(trade, version)) : raw.trades
	};
}
/**
* 纯快照 codec：只处理 v1–v8 原始字段到完整 CanonicalSnapshot 的迁移、校验与规范化。
* format envelope、merge/replace 策略以及任何持久化提交均由调用方负责。
*/
function decodeCanonicalSnapshot(value, options) {
	assertSupportedVersion(options.version);
	if (!isRecord(value)) throw new OperationalError("snapshot-contract-invalid", `${options.label ?? "snapshot"} must be an object`);
	const raw = migrateVersionedSnapshot(value, options.version);
	const strategiesWereMissing = raw.strategies === void 0;
	const candidate = {
		trades: raw.trades === void 0 ? [] : raw.trades,
		weeklyReviews: raw.weeklyReviews === void 0 ? [] : raw.weeklyReviews,
		quickNotes: raw.quickNotes === void 0 ? [] : raw.quickNotes,
		strategies: raw.strategies === void 0 ? [] : raw.strategies,
		starredIds: raw.starredIds === void 0 ? [] : raw.starredIds,
		subscribedIds: raw.subscribedIds === void 0 ? [] : raw.subscribedIds,
		pinnedStrategyIds: raw.pinnedStrategyIds === void 0 ? [] : raw.pinnedStrategyIds,
		display: raw.display,
		shortcuts: raw.shortcuts,
		tagPresets: raw.tagPresets,
		mistakeTagPresets: raw.mistakeTagPresets,
		profile: raw.profile,
		savedTradeViews: raw.savedTradeViews,
		symbolIcons: raw.symbolIcons,
		symbolCatalog: raw.symbolCatalog,
		reviewTemplates: raw.reviewTemplates
	};
	assertSnapshotContract(candidate, options.label ?? "snapshot");
	const normalizedRelations = normalizeTradeStrategyReferences(candidate.trades, strategiesWereMissing ? void 0 : candidate.strategies);
	const trades = normalizeTrades(normalizedRelations.trades);
	const symbolIcons = normalizeSymbolIcons(candidate.symbolIcons);
	const symbolCatalogSource = candidate.symbolCatalog === void 0 ? [...Object.keys(symbolIcons), ...trades.map((trade) => trade.symbol)] : candidate.symbolCatalog;
	const normalized = {
		trades,
		weeklyReviews: normalizeWeeklyReviews(candidate.weeklyReviews),
		quickNotes: normalizeQuickNotes(candidate.quickNotes),
		strategies: normalizedRelations.strategies,
		starredIds: [...candidate.starredIds],
		subscribedIds: [...candidate.subscribedIds],
		pinnedStrategyIds: [...candidate.pinnedStrategyIds],
		display: normalizeDisplay(candidate.display),
		shortcuts: migrateShortcutBindings(candidate.shortcuts),
		tagPresets: mergeTagPresets(candidate.tagPresets),
		mistakeTagPresets: mergeTagPresets(candidate.mistakeTagPresets),
		profile: candidate.profile ? { ...candidate.profile } : createDefaultUserProfile(),
		savedTradeViews: normalizeSavedTradeViews(candidate.savedTradeViews),
		symbolIcons,
		symbolCatalog: normalizeSymbolCatalog(symbolCatalogSource),
		reviewTemplates: normalizeReviewTemplates(candidate.reviewTemplates)
	};
	assertSnapshotContract(normalized, options.label ?? "snapshot");
	return normalized;
}
//#endregion
//#region electron/quitCoordinator.ts
async function releaseThenFinalizeWithRollback(release, finalize, rollback) {
	release();
	try {
		finalize();
	} catch (error) {
		await rollback();
		throw error;
	}
}
function assertExitWithinDeadline(signal, deadlineAt, now = Date.now) {
	if (signal.aborted || now() >= deadlineAt) throw new Error("退出协调等待超时，已取消退出");
}
var INTENT_PRIORITY = {
	close: 0,
	quit: 1,
	"quit-and-install": 2
};
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
var QuitCoordinator = class {
	dependencies;
	active = null;
	requestedIntent = "close";
	constructor(dependencies) {
		this.dependencies = dependencies;
	}
	request(intent) {
		if (INTENT_PRIORITY[intent] > INTENT_PRIORITY[this.requestedIntent]) this.requestedIntent = intent;
		if (this.active) return this.active;
		const requestId = this.dependencies.createRequestId();
		const controller = new AbortController();
		const now = this.dependencies.now ?? Date.now;
		const deadlineAt = now() + this.dependencies.timeoutMs;
		const startedAt = now();
		let stage = "renderer-flush";
		this.dependencies.reportStart?.({
			operationId: requestId,
			stage,
			durationMs: 0
		});
		const assertWithinDeadline = () => {
			try {
				assertExitWithinDeadline(controller.signal, deadlineAt, now);
			} catch (error) {
				controller.abort();
				throw error;
			}
		};
		const timeout = new Promise((_resolve, reject) => {
			const timer = setTimeout(() => {
				controller.abort();
				reject(/* @__PURE__ */ new Error("退出协调等待超时，已取消退出"));
			}, this.dependencies.timeoutMs);
			controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
		});
		const run = async () => {
			await this.dependencies.requestRendererFlush(requestId, controller.signal);
			assertWithinDeadline();
			stage = "verified-backup";
			await this.dependencies.createVerifiedBackup(controller.signal);
			assertWithinDeadline();
			stage = "commit-exit";
			let committedIntent = null;
			const resolveIntent = () => {
				committedIntent = this.requestedIntent;
				return committedIntent;
			};
			await this.dependencies.commitExit(resolveIntent, controller.signal, deadlineAt);
			this.dependencies.reportSuccess?.({
				operationId: requestId,
				stage,
				durationMs: Math.max(0, now() - startedAt)
			});
			controller.abort();
			return {
				ok: true,
				intent: committedIntent ?? this.requestedIntent
			};
		};
		const active = Promise.race([run(), timeout]).catch((error) => {
			controller.abort();
			const message = messageOf(error);
			return Promise.resolve(this.dependencies.cancelPreparation()).then(() => {
				const code = stage === "renderer-flush" ? "quit-flush-failed" : stage === "verified-backup" ? "quit-backup-failed" : "quit-commit-failed";
				this.dependencies.reportError({
					operationId: requestId,
					stage,
					code,
					durationMs: Math.max(0, now() - startedAt),
					message
				});
				return {
					ok: false,
					error: message
				};
			});
		}).then((result) => {
			this.active = null;
			this.requestedIntent = "close";
			return result;
		});
		this.active = active;
		return active;
	}
};
//#endregion
//#region electron/library/atomicFile.ts
/**
* 返回平台是否提供了真实的目录 durability barrier。
* Node 在 Windows 上无法用 fsync 刷新目录句柄；调用方必须采用不依赖
* rename 排序的数据安全协议，不能把普通文件 fsync 冒充目录屏障。
*/
function fsyncDirectorySync(directory) {
	if (process.platform !== "win32") {
		const descriptor = fs.openSync(directory, "r");
		try {
			fs.fsyncSync(descriptor);
		} finally {
			fs.closeSync(descriptor);
		}
		return true;
	}
	return false;
}
function writeFileAtomicallySync(filePath, data, encoding, beforeReplace) {
	const directory = path.dirname(filePath);
	fs.mkdirSync(directory, { recursive: true });
	const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
	let descriptor = null;
	try {
		descriptor = fs.openSync(temporaryPath, "wx");
		if (typeof data === "string") fs.writeFileSync(descriptor, data, encoding ?? "utf8");
		else fs.writeFileSync(descriptor, data);
		fs.fsyncSync(descriptor);
		fs.closeSync(descriptor);
		descriptor = null;
		beforeReplace?.(temporaryPath);
		fs.renameSync(temporaryPath, filePath);
		return fsyncDirectorySync(directory);
	} finally {
		if (descriptor !== null) fs.closeSync(descriptor);
		fs.rmSync(temporaryPath, { force: true });
	}
}
//#endregion
//#region electron/library/paths.ts
var CONFIG_FILE = "library-config.json";
var electronApp$1 = typeof electronRuntime === "object" && electronRuntime !== null && "app" in electronRuntime ? electronRuntime.app : void 0;
function requireAppPath(name) {
	if (!electronApp$1) throw new Error("Electron app paths are unavailable");
	return electronApp$1.getPath(name);
}
function getConfigPath() {
	return path.join(requireAppPath("userData"), CONFIG_FILE);
}
function readLibraryConfig() {
	const configPath = getConfigPath();
	if (!fs.existsSync(configPath)) return null;
	const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
	if (typeof cfg !== "object" || cfg === null || typeof cfg.libraryPath !== "string") throw new Error("资料库配置格式无效");
	return cfg;
}
function getDefaultLibraryPath() {
	return path.join(requireAppPath("documents"), "Yunkoo Atlas");
}
function getLibraryPath() {
	const custom = process.env.LINEAR_JOURNAL_LIBRARY;
	const saved = readLibraryConfig();
	if (saved) return saved.libraryPath;
	return custom ? path.resolve(custom) : getDefaultLibraryPath();
}
function getLibraryPaths(libraryPath) {
	const root = path.resolve(libraryPath);
	return {
		root,
		attachments: path.join(root, "attachments"),
		backups: path.join(root, "backups"),
		dbFile: path.join(root, "journal.db"),
		manifestFile: path.join(root, "manifest.json")
	};
}
function ensureLibraryDirs(libraryPath) {
	const paths = getLibraryPaths(libraryPath);
	const { attachments, backups } = paths;
	fs.mkdirSync(attachments, { recursive: true });
	fs.mkdirSync(backups, { recursive: true });
	return paths;
}
function findAttachmentFile(attachmentsDir, id) {
	if (!fs.existsSync(attachmentsDir)) return null;
	for (const name of fs.readdirSync(attachmentsDir)) if (name.startsWith(`${id}.`)) return path.join(attachmentsDir, name);
	return null;
}
//#endregion
//#region src/storage/assetId.ts
var SAFE_ASSET_ID = /^[A-Za-z0-9_-]{1,128}$/;
function isSafeAssetId(value) {
	return typeof value === "string" && SAFE_ASSET_ID.test(value);
}
function assertSafeAssetId(value) {
	if (!isSafeAssetId(value)) throw new Error("附件 ID 格式无效");
}
//#endregion
//#region electron/library/journalZip.ts
function locateSqlWasm(file) {
	const resourcesPath = typeof process.resourcesPath === "string" ? process.resourcesPath : "";
	const candidates = [
		...resourcesPath ? [
			path.join(resourcesPath, file),
			path.join(resourcesPath, "app.asar", "dist-electron", file),
			path.join(resourcesPath, "app", "dist-electron", file)
		] : [],
		path.join(process.cwd(), "dist-electron", file),
		path.join(process.cwd(), "node_modules/sql.js/dist", file)
	];
	for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
	return path.join(process.cwd(), "node_modules/sql.js/dist", file);
}
function validateManifest(manifestFile) {
	let manifest;
	try {
		manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
	} catch {
		throw new Error("Invalid .journal.zip: manifest.json is not valid JSON");
	}
	if (typeof manifest !== "object" || manifest === null) throw new Error("Invalid .journal.zip: manifest.json is missing required library fields");
	const fields = manifest;
	if (!Number.isInteger(fields.schemaVersion) || Number(fields.schemaVersion) < 1 || typeof fields.libraryId !== "string" || fields.libraryId.length === 0) throw new Error("Invalid .journal.zip: manifest.json is missing required library fields");
	if (Number(fields.schemaVersion) > 8) throw new Error(`该桌面归档来自更新版本（v${fields.schemaVersion}），当前仅支持至 v8`);
	return fields;
}
async function validateLibraryDatabaseFile(dbFile, options = {}) {
	const SQL = await initSqlJs({ locateFile: locateSqlWasm });
	let db = null;
	try {
		db = new SQL.Database(fs.readFileSync(dbFile));
		const tables = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('meta', 'assets')");
		const names = new Set((tables[0]?.values ?? []).map((row) => String(row[0])));
		if (!names.has("meta") || !names.has("assets")) throw new Error("database is missing required tables");
		const snapshotText = db.exec("SELECT value FROM meta WHERE key = 'snapshot'")[0]?.values[0]?.[0];
		let snapshot = null;
		if (snapshotText == null) {
			if (!options.allowEmptySnapshot) throw new Error("database snapshot is missing");
		} else snapshot = decodeCanonicalSnapshot(JSON.parse(String(snapshotText)), {
			version: options.schemaVersion ?? 8,
			label: "database snapshot"
		});
		const referencedAssetIds = /* @__PURE__ */ new Set();
		for (const trade of snapshot?.trades ?? []) {
			const note = typeof trade.note === "string" ? trade.note : "";
			const pattern = /journal-asset:\/\/([^"'\s>]+)/g;
			let match;
			while ((match = pattern.exec(note)) !== null) if (match[1]) referencedAssetIds.add(match[1]);
		}
		for (const review of snapshot?.weeklyReviews ?? []) {
			const pattern = /journal-asset:\/\/([^"'\s>]+)/g;
			let match;
			while ((match = pattern.exec(review.contentHtml)) !== null) if (match[1]) referencedAssetIds.add(match[1]);
		}
		for (const note of snapshot?.quickNotes ?? []) {
			const pattern = /journal-asset:\/\/([^"'\s>]+)/g;
			let match;
			while ((match = pattern.exec(note.contentHtml)) !== null) if (match[1]) referencedAssetIds.add(match[1]);
		}
		const assets = (db.exec("SELECT id, mime, file_name, byte_size FROM assets")[0]?.values ?? []).map((row) => ({
			id: String(row[0] ?? ""),
			mime: String(row[1] ?? ""),
			fileName: String(row[2] ?? ""),
			byteSize: Number(row[3])
		}));
		const assetIds = /* @__PURE__ */ new Set();
		const assetFileNames = /* @__PURE__ */ new Set();
		if (!snapshot && assets.length > 0) throw new Error("empty database contains orphaned assets");
		for (const asset of assets) {
			const { fileName } = asset;
			if (!fileName || path.basename(fileName) !== fileName) throw new Error("asset metadata contains an unsafe file path");
			if (!isSafeAssetId(asset.id) || !asset.mime || !Number.isFinite(asset.byteSize) || asset.byteSize < 0) throw new Error("asset metadata is invalid");
			if (assetIds.has(asset.id) || assetFileNames.has(asset.fileName)) throw new Error("asset metadata contains duplicate identifiers or files");
			assetIds.add(asset.id);
			assetFileNames.add(asset.fileName);
		}
		for (const referencedId of referencedAssetIds) if (!assetIds.has(referencedId)) throw new Error(`snapshot references a missing asset (${referencedId})`);
		return {
			tradeCount: snapshot?.trades.length ?? 0,
			strategyCount: snapshot?.strategies.length ?? 0,
			assets,
			referencedAssetIds: [...referencedAssetIds]
		};
	} catch (err) {
		throw new Error(`Invalid .journal.zip: journal.db could not be validated (${err instanceof Error ? err.message : String(err)})`);
	} finally {
		db?.close();
	}
}
async function validateDesktopLibrary(paths, options = {}) {
	const manifest = validateManifest(paths.manifestFile);
	const inspection = await validateLibraryDatabaseFile(paths.dbFile, {
		...options,
		schemaVersion: manifest.schemaVersion
	});
	const expectedAssets = new Map(inspection.assets.map((asset) => [asset.fileName, asset]));
	const actualFileNames = [];
	if (fs.existsSync(paths.attachments)) {
		const attachmentsStat = fs.lstatSync(paths.attachments);
		if (attachmentsStat.isSymbolicLink() || !attachmentsStat.isDirectory()) throw new Error("Invalid .journal.zip: attachments must be a regular directory");
		actualFileNames.push(...fs.readdirSync(paths.attachments));
	}
	for (const fileName of actualFileNames) {
		const filePath = path.join(paths.attachments, fileName);
		const fileStat = fs.lstatSync(filePath);
		if (fileStat.isSymbolicLink()) throw new Error(`Invalid .journal.zip: attachment must not be a symbolic link (${fileName})`);
		if (!fileStat.isFile()) throw new Error(`Invalid .journal.zip: attachment must be a regular file (${fileName})`);
		const asset = expectedAssets.get(fileName);
		if (!asset) throw new Error(`Invalid .journal.zip: unexpected attachment (${fileName})`);
		if (fileStat.size !== asset.byteSize) throw new Error(`Invalid .journal.zip: attachment is missing or incomplete (${fileName})`);
		expectedAssets.delete(fileName);
	}
	const missingFileName = expectedAssets.keys().next().value;
	if (missingFileName) throw new Error(`Invalid .journal.zip: attachment is missing or incomplete (${missingFileName})`);
	return inspection;
}
//#endregion
//#region electron/library/backup.ts
function backupFileName(timestamp) {
	return `journal-${new Date(timestamp).toISOString().replace(/[:T.]/g, "-")}.db`;
}
function readBackupMeta(dbPath) {
	try {
		const metaPath = dbPath + ".meta.json";
		if (!fs.existsSync(metaPath)) return null;
		return JSON.parse(fs.readFileSync(metaPath, "utf8"));
	} catch {
		return null;
	}
}
function backupAssetVault(backupsDir) {
	return path.join(backupsDir, "assets");
}
function backupManifestPath(dbBackupPath) {
	return dbBackupPath + ".manifest.json";
}
function listDeclaredAttachmentFiles(attachmentsDir, declaredFileNames) {
	const files = [];
	for (const fileName of [...declaredFileNames].sort()) {
		if (!fileName || path.basename(fileName) !== fileName) throw new Error(`备份附件路径不安全：${fileName}`);
		const fullPath = path.join(attachmentsDir, fileName);
		if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) throw new Error(`备份缺少数据库声明的附件：${fileName}`);
		files.push(fileName);
	}
	return files;
}
function storeBackupAttachment(source, vault) {
	const vaultName = sha256File(source);
	const destination = path.join(vault, vaultName);
	if (!fs.existsSync(destination)) fs.copyFileSync(source, destination);
	return vaultName;
}
function sha256File(filePath) {
	return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
function backupDbFiles(backupsDir) {
	if (!fs.existsSync(backupsDir)) return [];
	return fs.readdirSync(backupsDir).filter((name) => name.startsWith("journal-") && name.endsWith(".db"));
}
function pruneBackupAssetVault(backupsDir) {
	const referenced = /* @__PURE__ */ new Set();
	for (const name of backupDbFiles(backupsDir)) {
		const meta = readBackupMeta(path.join(backupsDir, name));
		for (const attachment of meta?.attachmentFiles ?? []) referenced.add(attachment);
		for (const attachment of meta?.attachmentEntries ?? []) referenced.add(attachment.vaultName);
	}
	const vault = backupAssetVault(backupsDir);
	if (!fs.existsSync(vault)) return;
	for (const name of fs.readdirSync(vault)) if (!referenced.has(name)) fs.rmSync(path.join(vault, name), { force: true });
}
function fileSize(pathname) {
	try {
		return fs.statSync(pathname).isFile() ? fs.statSync(pathname).size : 0;
	} catch {
		return 0;
	}
}
function deleteBackupFiles(dbPath) {
	fs.rmSync(dbPath, { force: true });
	fs.rmSync(dbPath + ".meta.json", { force: true });
	fs.rmSync(backupManifestPath(dbPath), { force: true });
}
function createBackupAtPath(storage, libraryPath, now = Date.now(), options = {}) {
	const { backups, dbFile, manifestFile, attachments } = ensureLibraryDirs(libraryPath);
	if (!fs.existsSync(dbFile)) return null;
	let timestamp = now;
	let dest = path.join(backups, backupFileName(timestamp));
	while (fs.existsSync(dest)) {
		timestamp += 1;
		dest = path.join(backups, backupFileName(timestamp));
	}
	try {
		fs.copyFileSync(dbFile, dest);
		if (fs.existsSync(manifestFile)) fs.copyFileSync(manifestFile, backupManifestPath(dest));
		const attachmentFiles = listDeclaredAttachmentFiles(attachments, storage.listCommittedAttachmentFileNames());
		const vault = backupAssetVault(backups);
		fs.mkdirSync(vault, { recursive: true });
		const attachmentEntries = attachmentFiles.map((fileName) => ({
			fileName,
			vaultName: storeBackupAttachment(path.join(attachments, fileName), vault)
		}));
		const counts = storage.getCounts();
		if (options.emptyLibrary && (counts.tradeCount !== 0 || counts.strategyCount !== 0 || counts.assetCount !== 0 || attachmentEntries.length !== 0)) throw new Error("只有零交易、零策略、零附件的资料库才能标记为空库恢复点");
		if (counts.assetCount !== attachmentEntries.length) throw new Error("备份附件清单与数据库附件计数不一致");
		const meta = {
			tradeCount: counts.tradeCount,
			strategyCount: counts.strategyCount,
			attachmentCount: counts.assetCount,
			librarySizeBytes: fs.statSync(dbFile).size,
			databaseSha256: sha256File(dest),
			...fs.existsSync(backupManifestPath(dest)) ? { manifestSha256: sha256File(backupManifestPath(dest)) } : {},
			attachmentEntries,
			...options.emptyLibrary ? { emptyLibrary: true } : {}
		};
		writeFileAtomicallySync(dest + ".meta.json", JSON.stringify(meta), "utf8");
		return dest;
	} catch (error) {
		deleteBackupFiles(dest);
		pruneBackupAssetVault(backups);
		throw error;
	}
}
function deleteBackupAtPath(libraryPath, fileName) {
	const { backups } = getLibraryPaths(libraryPath);
	const fp = path.join(backups, path.basename(fileName));
	if (!fs.existsSync(fp)) return false;
	deleteBackupFiles(fp);
	pruneBackupAssetVault(backups);
	return true;
}
function persistBackupVerification(dbPath, result, inspection) {
	const meta = readBackupMeta(dbPath) ?? {
		tradeCount: inspection?.tradeCount ?? -1,
		strategyCount: inspection?.strategyCount ?? -1,
		attachmentCount: inspection?.assets.length ?? -1,
		librarySizeBytes: fileSize(dbPath)
	};
	meta.verification = result;
	writeFileAtomicallySync(dbPath + ".meta.json", JSON.stringify(meta), "utf8");
}
async function verifyBackupAtPath(libraryPath, fileName) {
	const { backups } = getLibraryPaths(libraryPath);
	const dbPath = path.join(backups, path.basename(fileName));
	const checkedAt = Date.now();
	if (!fs.existsSync(dbPath)) return {
		status: "invalid",
		checkedAt,
		error: "恢复点文件不存在"
	};
	let inspection;
	const verificationRoot = fs.mkdtempSync(path.join(libraryPath, ".backup-verify-"));
	try {
		try {
			const declaredMeta = readBackupMeta(dbPath);
			inspection = await validateLibraryDatabaseFile(dbPath, { allowEmptySnapshot: declaredMeta?.emptyLibrary === true && declaredMeta.tradeCount === 0 && declaredMeta.strategyCount === 0 && declaredMeta.attachmentCount === 0 && (declaredMeta.attachmentEntries?.length ?? 0) === 0 && (declaredMeta.attachmentFiles?.length ?? 0) === 0 });
		} catch {
			throw new Error("数据库或快照结构无法读取");
		}
		const meta = readBackupMeta(dbPath);
		const attachmentEntries = meta?.attachmentEntries ?? meta?.attachmentFiles?.map((name) => ({
			fileName: name,
			vaultName: name
		}));
		if (inspection.assets.length > 0 && !attachmentEntries) throw new Error("恢复点缺少附件清单");
		if (meta) {
			if (meta.tradeCount !== inspection.tradeCount || meta.strategyCount !== inspection.strategyCount) throw new Error("恢复点统计与数据库内容不一致");
			if (meta.attachmentCount !== inspection.assets.length) throw new Error("恢复点附件统计与数据库内容不一致");
			if (meta.librarySizeBytes !== fileSize(dbPath)) throw new Error("恢复点数据库大小与元数据不一致");
			if (meta.databaseSha256 && sha256File(dbPath) !== meta.databaseSha256) throw new Error("恢复点数据库校验失败");
			const savedManifest = backupManifestPath(dbPath);
			if (meta.manifestSha256 && (!fs.existsSync(savedManifest) || sha256File(savedManifest) !== meta.manifestSha256)) throw new Error("恢复点清单校验失败");
		}
		const staged = ensureLibraryDirs(verificationRoot);
		fs.copyFileSync(dbPath, staged.dbFile);
		const savedManifest = backupManifestPath(dbPath);
		if (fs.existsSync(savedManifest)) fs.copyFileSync(savedManifest, staged.manifestFile);
		const entriesByName = /* @__PURE__ */ new Map();
		for (const entry of attachmentEntries ?? []) {
			if (!entry.fileName || !entry.vaultName || path.basename(entry.fileName) !== entry.fileName || path.basename(entry.vaultName) !== entry.vaultName || entriesByName.has(entry.fileName)) throw new Error("恢复点附件清单损坏");
			const source = path.join(backupAssetVault(backups), entry.vaultName);
			if (!fs.existsSync(source)) throw new Error(`缺少附件：${entry.fileName}`);
			if (/^[a-f0-9]{64}$/i.test(entry.vaultName)) {
				if (sha256File(source) !== entry.vaultName.toLowerCase()) throw new Error(`附件校验失败：${entry.fileName}`);
			}
			entriesByName.set(entry.fileName, source);
			fs.copyFileSync(source, path.join(staged.attachments, entry.fileName));
		}
		for (const asset of inspection.assets) {
			const source = entriesByName.get(asset.fileName);
			if (!source) throw new Error(`缺少数据库引用的附件：${asset.fileName}`);
			if (fileSize(source) !== asset.byteSize) throw new Error(`附件大小不一致：${asset.fileName}`);
		}
		const declaredEmptyLibrary = meta?.emptyLibrary === true && meta.tradeCount === 0 && meta.strategyCount === 0 && meta.attachmentCount === 0 && (meta.attachmentEntries?.length ?? 0) === 0 && (meta.attachmentFiles?.length ?? 0) === 0;
		const stagedInspection = await validateDesktopLibrary(staged, { allowEmptySnapshot: declaredEmptyLibrary });
		if (stagedInspection.tradeCount !== inspection.tradeCount || stagedInspection.strategyCount !== inspection.strategyCount || stagedInspection.assets.length !== inspection.assets.length) throw new Error("临时恢复后的数据统计不一致");
		const result = {
			status: "verified",
			checkedAt,
			tradeCount: stagedInspection.tradeCount,
			strategyCount: stagedInspection.strategyCount,
			attachmentCount: stagedInspection.assets.length,
			...declaredEmptyLibrary ? { emptyLibrary: true } : {}
		};
		persistBackupVerification(dbPath, result, inspection);
		return result;
	} catch (error) {
		const result = {
			status: "invalid",
			checkedAt,
			tradeCount: inspection?.tradeCount,
			strategyCount: inspection?.strategyCount,
			attachmentCount: inspection?.assets.length,
			error: error instanceof Error ? error.message : "恢复点验证失败"
		};
		try {
			persistBackupVerification(dbPath, result, inspection);
		} catch {}
		return result;
	} finally {
		fs.rmSync(verificationRoot, {
			recursive: true,
			force: true
		});
	}
}
//#endregion
//#region electron/library/images.ts
/** 图片保持原文件，避免截图文字与细线因重编码损失清晰度。 */
async function processImageBuffer(input, mime) {
	const normalized = mime.toLowerCase();
	if (!normalized.startsWith("image/")) return {
		buffer: input,
		mime: normalized || "application/octet-stream",
		ext: "bin"
	};
	return {
		buffer: input,
		mime: normalized,
		ext: normalized.split("/")[1]?.replace("jpeg", "jpg") || "bin"
	};
}
function isImageMime(mime) {
	return mime.toLowerCase().startsWith("image/");
}
function collectAssetIdsFromHtml(htmlEntries) {
	const ids = /* @__PURE__ */ new Set();
	for (const html of htmlEntries) {
		if (!html.includes("journal-asset://")) continue;
		let match;
		const re = /journal-asset:\/\/([^"'\s>]+)/g;
		while ((match = re.exec(html)) !== null) ids.add(match[1]);
	}
	return [...ids];
}
//#endregion
//#region src/storage/assetInventory.ts
/** 新增富文本域时只需在此注册其 HTML 选择器，盘点算法无需再复制扫描逻辑。 */
var RICH_TEXT_ASSET_DOMAINS = [
	{
		domain: "trade",
		selectHtml: (snapshot) => snapshot.trades.map((trade) => trade.note)
	},
	{
		domain: "weeklyReview",
		selectHtml: (snapshot) => (snapshot.weeklyReviews ?? []).map((review) => review.contentHtml)
	},
	{
		domain: "quickNote",
		selectHtml: (snapshot) => (snapshot.quickNotes ?? []).map((note) => note.contentHtml)
	}
];
function buildAssetInventory(snapshot, physicalRecords) {
	const domainsById = /* @__PURE__ */ new Map();
	const addDomain = (domain, htmlEntries) => {
		for (const id of collectAssetIdsFromHtml(htmlEntries)) {
			const domains = domainsById.get(id) ?? /* @__PURE__ */ new Set();
			domains.add(domain);
			domainsById.set(id, domains);
		}
	};
	for (const registration of RICH_TEXT_ASSET_DOMAINS) addDomain(registration.domain, registration.selectHtml(snapshot));
	const committedById = /* @__PURE__ */ new Map();
	const foreign = [];
	const temp = [];
	for (const record of physicalRecords) {
		if (record.state === "temp" || record.source === "prepared") {
			temp.push(record);
			continue;
		}
		if (!isSafeAssetId(record.id) || record.state === "foreign") {
			foreign.push(record);
			continue;
		}
		if (!committedById.has(record.id)) committedById.set(record.id, record);
	}
	const referenced = [...domainsById.entries()].map(([id, domains]) => ({
		id,
		domains: [...domains],
		record: committedById.get(id)
	}));
	const healthy = referenced.filter((item) => item.record?.state === "healthy");
	const missing = referenced.filter((item) => item.record?.state !== "healthy");
	for (const record of committedById.values()) if (!domainsById.has(record.id) && (record.state === "missing" || record.state === "size-mismatch")) missing.push({
		id: record.id,
		domains: [],
		record
	});
	const orphan = [...committedById.values()].filter((record) => record.state === "healthy" && !domainsById.has(record.id));
	return {
		physical: [...physicalRecords],
		referenced,
		healthy,
		missing,
		orphan,
		foreign,
		temp
	};
}
//#endregion
//#region electron/library/storage.ts
var SNAPSHOT_KEY = "snapshot";
var ASSET_TRASH_MANIFEST = "manifest.json";
var ASSET_TRASH_CLEANUP = "cleanup.json";
var sqlPromise = null;
var electronApp = typeof electronRuntime === "object" && electronRuntime !== null && "app" in electronRuntime ? electronRuntime.app : void 0;
function resolveAttachmentWritePath(attachmentsRoot, fileName) {
	const resolvedRoot = path.resolve(attachmentsRoot);
	const resolvedTarget = path.resolve(resolvedRoot, fileName);
	const relative = path.relative(resolvedRoot, resolvedTarget);
	if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("附件写入路径越界");
	return resolvedTarget;
}
function fileSizeIfPresent(filePath) {
	try {
		const stat = fs.statSync(filePath);
		return stat.isFile() ? stat.size : -1;
	} catch {
		return -1;
	}
}
function readAssetFileName(db, id) {
	const stmt = db.prepare("SELECT file_name FROM assets WHERE id = ?");
	try {
		stmt.bind([id]);
		return stmt.step() ? String(stmt.getAsObject().file_name) : null;
	} finally {
		stmt.free();
	}
}
function assertRegularFile(filePath, label) {
	const stat = fs.lstatSync(filePath);
	if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} 必须是普通文件`);
	return stat;
}
function readAssetTrashJournal(filePath, operationId) {
	assertRegularFile(filePath, "附件恢复清单");
	const manifest = JSON.parse(fs.readFileSync(filePath, "utf8"));
	if (manifest.version !== 1 || manifest.operationId !== operationId || !Array.isArray(manifest.files)) throw new Error("附件恢复清单无效，已停止打开资料库");
	const seenIds = /* @__PURE__ */ new Set();
	const seenNames = /* @__PURE__ */ new Set([ASSET_TRASH_MANIFEST, ASSET_TRASH_CLEANUP]);
	for (const file of manifest.files) {
		if (!file || !isSafeAssetId(file.id) || typeof file.fileName !== "string" || path.basename(file.fileName) !== file.fileName || !file.fileName.startsWith(`${file.id}.`) || seenIds.has(file.id) || seenNames.has(file.fileName)) throw new Error("附件恢复清单包含非法或重复路径");
		seenIds.add(file.id);
		seenNames.add(file.fileName);
	}
	return manifest;
}
async function getSql() {
	if (!sqlPromise) sqlPromise = initSqlJs({ locateFile: (file) => {
		const candidates = [
			typeof process.resourcesPath === "string" ? path.join(process.resourcesPath, file) : null,
			typeof electronApp?.getAppPath === "function" ? path.join(electronApp.getAppPath(), "dist-electron", file) : null,
			typeof electronApp?.getAppPath === "function" ? path.join(electronApp.getAppPath(), file) : null,
			path.join(process.cwd(), "dist-electron", file),
			path.join(process.cwd(), "node_modules/sql.js/dist", file)
		].filter((candidate) => candidate !== null);
		for (const p of candidates) if (fs.existsSync(p)) return p;
		return path.join(process.cwd(), "node_modules/sql.js/dist", file);
	} });
	return sqlPromise;
}
var LibraryStorage = class {
	db = null;
	paths;
	allowCreate;
	writeImportDatabase;
	beforeAtomicReplace;
	assetPurgePreviews = /* @__PURE__ */ new Map();
	constructor(libraryPath = getLibraryPath(), options = {}) {
		const resolved = path.resolve(libraryPath);
		this.allowCreate = options.allowCreate !== false;
		this.writeImportDatabase = options.writeImportDatabase ?? writeFileAtomicallySync;
		this.beforeAtomicReplace = options.beforeAtomicReplace;
		this.paths = options.ensureDirectories === false ? getLibraryPaths(resolved) : ensureLibraryDirs(resolved);
	}
	getLibraryPath() {
		return this.paths.root;
	}
	getPaths() {
		return this.paths;
	}
	async open() {
		if (this.db) return;
		if (!this.allowCreate && !fs.existsSync(this.paths.manifestFile)) throw new Error("manifest.json 不存在，已阻止生成新的资料库身份");
		const SQL = await getSql();
		const created = !fs.existsSync(this.paths.dbFile);
		if (created && !this.allowCreate) throw new Error("journal.db 不存在，已阻止创建空交易库");
		if (created && fs.existsSync(this.paths.manifestFile)) throw new Error("journal.db 缺失，但本目录已有资料库清单（manifest.json）。请从设置 → 数据 → 备份中恢复，或重新选择正确的资料库目录。已阻止写入空库，以免覆盖现有记录。");
		if (created) this.db = new SQL.Database();
		else {
			const file = fs.readFileSync(this.paths.dbFile);
			this.db = new SQL.Database(file);
		}
		if (!this.allowCreate) {
			const tables = this.db.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('meta', 'assets')");
			const names = new Set((tables[0]?.values ?? []).map((row) => String(row[0])));
			if (!names.has("meta") || !names.has("assets")) throw new Error("journal.db 缺少必需的数据表，已阻止按空交易库打开");
			for (const [table, required] of Object.entries({
				meta: ["key", "value"],
				assets: [
					"id",
					"mime",
					"file_name",
					"byte_size",
					"created_at"
				]
			})) {
				const columns = new Set((this.db.exec(`PRAGMA table_info(${table})`)[0]?.values ?? []).map((row) => String(row[1])));
				if (required.some((column) => !columns.has(column))) throw new Error(`journal.db 的 ${table} 表结构不完整，已阻止按空交易库打开`);
			}
		}
		this.db.run(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        mime TEXT NOT NULL,
        file_name TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
		if (this.allowCreate && (created || !fs.existsSync(this.paths.manifestFile))) this.writeManifest({
			schemaVersion: 8,
			libraryId: randomUUID(),
			createdAt: (/* @__PURE__ */ new Date()).toISOString(),
			platform: "electron"
		});
		if (created) this.persistDb();
		this.recoverAssetTrash();
	}
	close() {
		if (this.db) {
			this.db.close();
			this.db = null;
		}
		this.assetPurgePreviews.clear();
	}
	/** Close db without a final export; mutations already persist at write time. */
	release() {
		if (this.db) {
			this.db.close();
			this.db = null;
		}
		this.assetPurgePreviews.clear();
	}
	requireDb() {
		if (!this.db) throw new Error("Library database not opened");
		return this.db;
	}
	persistDb() {
		if (!this.db) return;
		const data = this.db.export();
		writeFileAtomicallySync(this.paths.dbFile, Buffer.from(data), void 0, this.beforeAtomicReplace);
	}
	readManifest() {
		if (!fs.existsSync(this.paths.manifestFile)) {
			if (!this.allowCreate) throw new Error("manifest.json 不存在，已阻止生成新的资料库身份");
			const manifest = {
				schemaVersion: 8,
				libraryId: randomUUID(),
				createdAt: (/* @__PURE__ */ new Date()).toISOString(),
				platform: "electron"
			};
			this.writeManifest(manifest);
			return manifest;
		}
		return JSON.parse(fs.readFileSync(this.paths.manifestFile, "utf8"));
	}
	writeManifest(manifest) {
		writeFileAtomicallySync(this.paths.manifestFile, JSON.stringify(manifest, null, 2), "utf8");
	}
	readSnapshotJson() {
		const stmt = this.requireDb().prepare("SELECT value FROM meta WHERE key = ?");
		stmt.bind([SNAPSHOT_KEY]);
		if (!stmt.step()) {
			stmt.free();
			return null;
		}
		const value = String(stmt.getAsObject().value);
		stmt.free();
		return value;
	}
	loadSnapshot() {
		const value = this.readSnapshotJson();
		if (value === null) return null;
		return decodeCanonicalSnapshot(JSON.parse(value), {
			version: this.readManifest().schemaVersion,
			label: "Stored library snapshot"
		});
	}
	saveSnapshot(snapshot) {
		assertValidPersistedSnapshot(snapshot, "Library snapshot");
		this.requireDb().run(`INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [SNAPSHOT_KEY, JSON.stringify(snapshot)]);
		this.persistDb();
	}
	async saveAssetAsync(buffer, mime) {
		const db = this.requireDb();
		const id = randomUUID();
		const createdAt = (/* @__PURE__ */ new Date()).toISOString();
		let outBuffer = buffer;
		let outMime = mime;
		let ext = "bin";
		if (isImageMime(mime)) {
			const processed = await processImageBuffer(buffer, mime);
			outBuffer = processed.buffer;
			outMime = processed.mime;
			ext = processed.ext;
		} else ext = mime.split("/")[1]?.replace("jpeg", "jpg") || "bin";
		const fileName = `${id}.${ext}`;
		assertSafeAssetId(id);
		const filePath = resolveAttachmentWritePath(this.paths.attachments, fileName);
		fs.writeFileSync(filePath, outBuffer);
		db.run(`INSERT INTO assets (id, mime, file_name, byte_size, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         mime = excluded.mime,
         file_name = excluded.file_name,
         byte_size = excluded.byte_size`, [
			id,
			outMime,
			fileName,
			outBuffer.byteLength,
			createdAt
		]);
		this.persistDb();
		return id;
	}
	getAssetBytes(id) {
		const stmt = this.requireDb().prepare("SELECT mime, file_name FROM assets WHERE id = ?");
		stmt.bind([id]);
		if (!stmt.step()) {
			stmt.free();
			return null;
		}
		const row = stmt.getAsObject();
		stmt.free();
		const filePath = findAttachmentFile(this.paths.attachments, id) ?? path.join(this.paths.attachments, row.file_name);
		if (!fs.existsSync(filePath)) return null;
		const bytes = fs.readFileSync(filePath);
		return {
			id,
			mime: row.mime,
			bytes: new Uint8Array(bytes)
		};
	}
	/** 返回交易数 / 策略数 / 附件数，供备份元数据使用 */
	/** 备份与校验只认数据库已声明附件，忽略磁盘上尚未收尾的孤儿文件。 */
	listCommittedAttachmentFileNames() {
		return (this.requireDb().exec("SELECT file_name FROM assets ORDER BY file_name")[0]?.values ?? []).map((row) => String(row[0]));
	}
	getCounts() {
		const snapshot = this.loadSnapshot();
		const db = this.requireDb();
		let assetCount = 0;
		try {
			const stmt = db.prepare("SELECT COUNT(*) as cnt FROM assets");
			if (stmt.step()) assetCount = stmt.getAsObject().cnt;
			stmt.free();
		} catch {}
		return {
			tradeCount: snapshot?.trades.length ?? 0,
			strategyCount: snapshot?.strategies.length ?? 0,
			assetCount
		};
	}
	getAssetStats(ids) {
		const uniqueIds = [...new Set(ids)];
		if (uniqueIds.length === 0) return {
			count: 0,
			totalBytes: 0,
			missingCount: 0
		};
		const stmt = this.requireDb().prepare("SELECT file_name, byte_size FROM assets WHERE id = ?");
		let count = 0;
		let totalBytes = 0;
		let missingCount = 0;
		try {
			for (const id of uniqueIds) {
				stmt.bind([id]);
				if (stmt.step()) {
					const row = stmt.getAsObject();
					const byteSize = Number(row.byte_size);
					let actualSize = -1;
					try {
						actualSize = fileSizeIfPresent(resolveAttachmentWritePath(this.paths.attachments, row.file_name));
					} catch {}
					if (Number.isFinite(byteSize) && byteSize >= 0 && actualSize === byteSize) {
						count += 1;
						totalBytes += actualSize;
					} else missingCount += 1;
				} else missingCount += 1;
				stmt.reset();
			}
		} finally {
			stmt.free();
		}
		return {
			count,
			totalBytes,
			missingCount
		};
	}
	listAssetRecords() {
		const db = this.requireDb();
		const records = [];
		const representedFiles = /* @__PURE__ */ new Set();
		const result = db.exec("SELECT id, mime, file_name, byte_size FROM assets");
		for (const row of result[0]?.values ?? []) {
			const id = String(row[0]);
			const mime = String(row[1]);
			const fileName = String(row[2]);
			const declaredBytes = Number(row[3]);
			representedFiles.add(fileName);
			let state = "missing";
			let actualBytes;
			const legalName = path.basename(fileName) === fileName && fileName.startsWith(`${id}.`);
			if (!isSafeAssetId(id) || !legalName) state = "foreign";
			else try {
				const filePath = resolveAttachmentWritePath(this.paths.attachments, fileName);
				const stat = fs.lstatSync(filePath);
				if (stat.isSymbolicLink() || !stat.isFile()) state = "foreign";
				else {
					actualBytes = stat.size;
					state = Number.isSafeInteger(declaredBytes) && declaredBytes >= 0 && stat.size === declaredBytes ? "healthy" : "size-mismatch";
				}
			} catch {
				state = "missing";
			}
			records.push({
				id,
				mime,
				declaredBytes,
				actualBytes,
				state,
				source: "committed"
			});
		}
		for (const entry of fs.readdirSync(this.paths.attachments, { withFileTypes: true })) {
			if (representedFiles.has(entry.name)) continue;
			const filePath = path.join(this.paths.attachments, entry.name);
			let actualBytes;
			if (entry.isFile()) actualBytes = fs.lstatSync(filePath).size;
			const isTemp = /(?:^\.|\.)(?:tmp|temp|stage|staged)(?:\.|$)/i.test(entry.name);
			records.push({
				id: entry.name,
				actualBytes,
				state: isTemp ? "temp" : "foreign",
				source: "filesystem"
			});
		}
		return records;
	}
	recoverAssetTrash() {
		const trashRoot = path.join(this.paths.root, ".trash");
		if (!fs.existsSync(trashRoot)) return;
		const trashStat = fs.lstatSync(trashRoot);
		if (trashStat.isSymbolicLink() || !trashStat.isDirectory()) throw new Error("附件恢复目录 .trash 必须是当前库内的普通目录");
		const attachmentsStat = fs.lstatSync(this.paths.attachments);
		if (attachmentsStat.isSymbolicLink() || !attachmentsStat.isDirectory()) throw new Error("附件恢复前发现 attachments 不是普通目录");
		const db = this.requireDb();
		for (const operation of fs.readdirSync(trashRoot, { withFileTypes: true })) {
			if (operation.isSymbolicLink() || !operation.isDirectory() || !isSafeAssetId(operation.name)) throw new Error("附件恢复目录包含非法操作项，已停止打开资料库");
			const operationDir = path.join(trashRoot, operation.name);
			const manifestPath = path.join(operationDir, ASSET_TRASH_MANIFEST);
			const cleanupPath = path.join(operationDir, ASSET_TRASH_CLEANUP);
			if (fs.readdirSync(operationDir).length === 0) {
				fs.rmdirSync(operationDir);
				fsyncDirectorySync(trashRoot);
				continue;
			}
			const hasManifest = fs.existsSync(manifestPath);
			const hasCleanup = fs.existsSync(cleanupPath);
			if (!hasManifest && !hasCleanup) throw new Error("附件恢复操作缺少可验证清单");
			const primary = hasManifest ? readAssetTrashJournal(manifestPath, operation.name) : readAssetTrashJournal(cleanupPath, operation.name);
			if (hasManifest && hasCleanup) {
				const cleanup = readAssetTrashJournal(cleanupPath, operation.name);
				if (JSON.stringify(primary) !== JSON.stringify(cleanup)) throw new Error("附件恢复双清单内容不一致，已停止打开资料库");
			}
			const manifest = primary;
			const expectedNames = /* @__PURE__ */ new Set([ASSET_TRASH_MANIFEST, ASSET_TRASH_CLEANUP]);
			for (const file of manifest.files) expectedNames.add(file.fileName);
			const actualNames = fs.readdirSync(operationDir);
			if (!actualNames.includes(ASSET_TRASH_MANIFEST) && !actualNames.includes(ASSET_TRASH_CLEANUP) || actualNames.some((name) => !expectedNames.has(name))) throw new Error("附件恢复目录内容与清单不一致");
			for (const file of manifest.files) {
				const stagedPath = path.join(operationDir, file.fileName);
				const targetPath = resolveAttachmentWritePath(this.paths.attachments, file.fileName);
				const rowFileName = readAssetFileName(db, file.id);
				if (rowFileName !== null) {
					if (rowFileName !== file.fileName) throw new Error("附件恢复清单与数据库路径不一致");
					if (fs.existsSync(targetPath)) {
						assertRegularFile(targetPath, "活动附件");
						if (fs.existsSync(stagedPath)) {
							assertRegularFile(stagedPath, "待恢复附件副本");
							fs.rmSync(stagedPath);
							fsyncDirectorySync(operationDir);
						}
					} else if (fs.existsSync(stagedPath)) {
						assertRegularFile(stagedPath, "待恢复附件");
						fs.renameSync(stagedPath, targetPath);
						fsyncDirectorySync(this.paths.attachments);
						fsyncDirectorySync(operationDir);
					} else throw new Error("附件恢复所需的活动文件与 trash 副本均不存在");
				} else {
					if (fs.existsSync(targetPath)) {
						assertRegularFile(targetPath, "待完成清理的活动附件");
						fs.rmSync(targetPath);
						fsyncDirectorySync(this.paths.attachments);
					}
					if (fs.existsSync(stagedPath)) {
						assertRegularFile(stagedPath, "待完成清理附件");
						fs.rmSync(stagedPath);
						fsyncDirectorySync(operationDir);
					}
				}
			}
			if (!fs.existsSync(cleanupPath)) writeFileAtomicallySync(cleanupPath, JSON.stringify(manifest, null, 2), "utf8");
			if (fs.existsSync(manifestPath)) fs.rmSync(manifestPath);
			fsyncDirectorySync(operationDir);
			fs.rmSync(cleanupPath);
			fsyncDirectorySync(operationDir);
			fs.rmdirSync(operationDir);
			fsyncDirectorySync(trashRoot);
		}
		if (fs.readdirSync(trashRoot).length === 0) {
			fs.rmdirSync(trashRoot);
			fsyncDirectorySync(this.paths.root);
		}
	}
	previewAssetPurge() {
		const snapshotJson = this.readSnapshotJson();
		if (snapshotJson === null) throw new Error("当前资料库尚无可校验的持久化快照");
		const inventory = buildAssetInventory(this.loadSnapshot(), this.listAssetRecords());
		const candidateIds = inventory.orphan.map((record) => record.id).sort();
		const totalBytes = inventory.orphan.reduce((sum, record) => sum + (record.actualBytes ?? 0), 0);
		const operationId = randomUUID();
		this.assetPurgePreviews.set(operationId, {
			snapshotJson,
			candidateIds,
			totalBytes
		});
		return {
			operationId,
			revision: 0,
			candidateIds: [...candidateIds],
			totalBytes
		};
	}
	async commitAssetPurge(preview) {
		const prepared = this.assetPurgePreviews.get(preview.operationId);
		this.assetPurgePreviews.delete(preview.operationId);
		if (!prepared || preview.revision !== 0 || prepared.candidateIds.join("\0") !== preview.candidateIds.join("\0") || prepared.totalBytes !== preview.totalBytes) throw new OperationalError("asset-gc-stale-revision", "附件清理预览无效或已使用，请重新扫描");
		if (this.readSnapshotJson() !== prepared.snapshotJson) throw new OperationalError("asset-gc-stale-revision", "资料库在预览后已变化，请重新扫描附件");
		const currentSnapshot = this.loadSnapshot();
		const liveIds = new Set(buildAssetInventory(currentSnapshot, []).referenced.map((item) => item.id));
		if (prepared.candidateIds.some((id) => liveIds.has(id))) throw new OperationalError("asset-reference-missing", "清理候选已重新被笔记引用，请重新扫描");
		const attachmentsStat = fs.lstatSync(this.paths.attachments);
		if (attachmentsStat.isSymbolicLink() || !attachmentsStat.isDirectory()) throw new Error("attachments 路径不是当前库内的普通目录");
		const currentDb = this.requireDb();
		const files = prepared.candidateIds.map((id) => {
			const fileName = readAssetFileName(currentDb, id);
			if (!fileName || path.basename(fileName) !== fileName || !fileName.startsWith(`${id}.`)) throw new Error(`清理候选缺少安全数据库路径：${id}`);
			const source = resolveAttachmentWritePath(this.paths.attachments, fileName);
			return {
				id,
				fileName,
				bytes: assertRegularFile(source, `清理候选 ${id}`).size,
				source
			};
		});
		if (files.reduce((sum, file) => sum + file.bytes, 0) !== prepared.totalBytes) throw new Error("清理候选尺寸在预览后发生变化，请重新扫描");
		const trashRoot = path.join(this.paths.root, ".trash");
		if (fs.existsSync(trashRoot)) {
			const stat = fs.lstatSync(trashRoot);
			if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(".trash 路径不安全");
		} else {
			fs.mkdirSync(trashRoot);
			fsyncDirectorySync(this.paths.root);
		}
		const operationDir = path.join(trashRoot, preview.operationId);
		fs.mkdirSync(operationDir);
		fsyncDirectorySync(trashRoot);
		const manifest = {
			version: 1,
			operationId: preview.operationId,
			files: files.map(({ id, fileName }) => ({
				id,
				fileName
			}))
		};
		writeFileAtomicallySync(path.join(operationDir, ASSET_TRASH_MANIFEST), JSON.stringify(manifest, null, 2), "utf8");
		const staged = [];
		let cleanupDeferred = false;
		let nextDb = null;
		try {
			for (const file of files) {
				const target = path.join(operationDir, file.fileName);
				fs.copyFileSync(file.source, target, fs.constants.COPYFILE_EXCL);
				const descriptor = fs.openSync(target, "r+");
				try {
					fs.fsyncSync(descriptor);
				} finally {
					fs.closeSync(descriptor);
				}
				staged.push(file);
			}
			fsyncDirectorySync(operationDir);
			nextDb = new (await (getSql())).Database(currentDb.export());
			nextDb.run("BEGIN TRANSACTION");
			for (const id of prepared.candidateIds) {
				nextDb.run("DELETE FROM assets WHERE id = ?", [id]);
				if (nextDb.getRowsModified() !== 1) throw new Error(`清理候选数据库行已变化：${id}`);
			}
			nextDb.run("COMMIT");
			const nextDbBytes = Buffer.from(nextDb.export());
			try {
				writeFileAtomicallySync(this.paths.dbFile, nextDbBytes);
			} catch (error) {
				let replaced = false;
				try {
					replaced = fs.readFileSync(this.paths.dbFile).equals(nextDbBytes);
				} catch {}
				if (!replaced) throw error;
				cleanupDeferred = true;
			}
			this.db = nextDb;
			nextDb = null;
			try {
				currentDb.close();
			} catch {}
		} catch (error) {
			try {
				nextDb?.run("ROLLBACK");
			} catch {}
			try {
				nextDb?.close();
			} catch {}
			throw error;
		}
		if (!cleanupDeferred) try {
			writeFileAtomicallySync(path.join(operationDir, ASSET_TRASH_CLEANUP), JSON.stringify(manifest, null, 2), "utf8");
			for (const file of staged) fs.rmSync(file.source);
			fsyncDirectorySync(this.paths.attachments);
			for (const file of staged) {
				const stagedPath = path.join(operationDir, file.fileName);
				if (fs.existsSync(stagedPath)) fs.rmSync(stagedPath);
			}
			fsyncDirectorySync(operationDir);
			const manifestPath = path.join(operationDir, ASSET_TRASH_MANIFEST);
			if (fs.existsSync(manifestPath)) fs.rmSync(manifestPath);
			fsyncDirectorySync(operationDir);
			fs.rmSync(path.join(operationDir, ASSET_TRASH_CLEANUP));
			fsyncDirectorySync(operationDir);
			fs.rmdirSync(operationDir);
			fsyncDirectorySync(trashRoot);
		} catch {
			cleanupDeferred = true;
		}
		if (cleanupDeferred) try {
			this.recoverAssetTrash();
		} catch {}
		try {
			if (fs.existsSync(trashRoot) && fs.readdirSync(trashRoot).length === 0) {
				fs.rmdirSync(trashRoot);
				fsyncDirectorySync(this.paths.root);
			}
		} catch {}
		return {
			revision: 0,
			deletedIds: [...prepared.candidateIds]
		};
	}
	cancelAssetPurge(operationId) {
		this.assetPurgePreviews.delete(operationId);
	}
	importAsset(id, mime, buffer) {
		const db = this.requireDb();
		assertSafeAssetId(id);
		const createdAt = (/* @__PURE__ */ new Date()).toISOString();
		const fileName = `${id}.${mime.includes("webp") ? "webp" : mime.includes("png") ? "png" : mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "bin"}`;
		const filePath = resolveAttachmentWritePath(this.paths.attachments, fileName);
		fs.writeFileSync(filePath, buffer);
		db.run(`INSERT INTO assets (id, mime, file_name, byte_size, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         mime = excluded.mime,
         file_name = excluded.file_name,
         byte_size = excluded.byte_size`, [
			id,
			mime,
			fileName,
			buffer.byteLength,
			createdAt
		]);
		this.persistDb();
	}
	/** 将导入附件与最终快照作为一次提交写入，失败时保持当前数据库不变。 */
	async commitImport(snapshot, assets, options) {
		assertValidPersistedSnapshot(snapshot, "Imported library snapshot");
		const currentDb = this.requireDb();
		const nextDb = new (await (getSql())).Database(currentDb.export());
		const stagedFiles = [];
		const committedFiles = [];
		const referencedAssetIds = /* @__PURE__ */ new Set();
		for (const trade of snapshot.trades) {
			const re = /journal-asset:\/\/([^"'\s>]+)/g;
			let match;
			while ((match = re.exec(trade.note)) !== null) referencedAssetIds.add(match[1]);
		}
		for (const review of snapshot.weeklyReviews ?? []) {
			const re = /journal-asset:\/\/([^"'\s>]+)/g;
			let match;
			while ((match = re.exec(review.contentHtml)) !== null) referencedAssetIds.add(match[1]);
		}
		for (const note of snapshot.quickNotes ?? []) {
			const re = /journal-asset:\/\/([^"'\s>]+)/g;
			let match;
			while ((match = re.exec(note.contentHtml)) !== null) referencedAssetIds.add(match[1]);
		}
		const obsoleteImportedFiles = [];
		let adopted = false;
		try {
			nextDb.run("BEGIN TRANSACTION");
			for (const asset of assets) {
				assertSafeAssetId(asset.id);
				if (options?.pruneUnreferenced && !referencedAssetIds.has(asset.id)) {
					const existing = findAttachmentFile(this.paths.attachments, asset.id);
					if (existing) obsoleteImportedFiles.push(existing);
					nextDb.run("DELETE FROM assets WHERE id = ?", [asset.id]);
					continue;
				}
				const ext = asset.mime.includes("webp") ? "webp" : asset.mime.includes("png") ? "png" : asset.mime.includes("jpeg") || asset.mime.includes("jpg") ? "jpg" : "bin";
				const fileName = `${asset.id}.${ext}`;
				const target = resolveAttachmentWritePath(this.paths.attachments, fileName);
				if (fs.existsSync(target)) {
					if (!fs.readFileSync(target).equals(asset.buffer)) throw new Error(`导入附件 ID 冲突：${asset.id}`);
				} else {
					const temp = resolveAttachmentWritePath(this.paths.attachments, `.${fileName}.${randomUUID()}.tmp`);
					fs.writeFileSync(temp, asset.buffer);
					stagedFiles.push({
						temp,
						target
					});
				}
				nextDb.run(`INSERT INTO assets (id, mime, file_name, byte_size, created_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             mime = excluded.mime,
             file_name = excluded.file_name,
             byte_size = excluded.byte_size`, [
					asset.id,
					asset.mime,
					fileName,
					asset.buffer.byteLength,
					(/* @__PURE__ */ new Date()).toISOString()
				]);
			}
			nextDb.run(`INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [SNAPSHOT_KEY, JSON.stringify(snapshot)]);
			nextDb.run("COMMIT");
			for (const staged of stagedFiles) {
				fs.renameSync(staged.temp, staged.target);
				committedFiles.push(staged.target);
			}
			const nextDbBytes = Buffer.from(nextDb.export());
			try {
				this.writeImportDatabase(this.paths.dbFile, nextDbBytes);
			} catch (error) {
				if (!(fs.existsSync(this.paths.dbFile) && fs.readFileSync(this.paths.dbFile).equals(nextDbBytes))) throw error;
			}
			currentDb.close();
			this.db = nextDb;
			adopted = true;
			for (const filePath of obsoleteImportedFiles) try {
				if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
			} catch {}
		} catch (error) {
			try {
				nextDb.run("ROLLBACK");
			} catch {}
			for (const staged of stagedFiles) try {
				if (fs.existsSync(staged.temp)) fs.unlinkSync(staged.temp);
			} catch {}
			for (const filePath of committedFiles) try {
				if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
			} catch {}
			throw error;
		} finally {
			if (!adopted) nextDb.close();
		}
	}
};
//#endregion
//#region electron/library/persistenceBenchmark.ts
function checksum(value) {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
async function runElectronPersistenceBenchmark(input) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), `atlas-persistence-${input.label}-`));
	let storage = new LibraryStorage(root);
	const durableHash = checksum(decodeCanonicalSnapshot(input.snapshot, {
		version: 8,
		label: `${input.label} Electron persistence benchmark fixture`
	}));
	const assertReloadedState = () => {
		if (checksum(storage.loadSnapshot()) !== durableHash) throw new Error("退出 release 后 snapshot checksum 不一致");
		for (const expected of input.assets) {
			const actual = storage.getAssetBytes(expected.id);
			if (!actual || !Buffer.from(actual.bytes).equals(Buffer.from(expected.data, "base64"))) throw new Error(`退出 release 后附件不一致：${expected.id}`);
		}
	};
	try {
		await storage.open();
		await storage.commitImport(input.snapshot, input.assets.map((asset) => ({
			id: asset.id,
			mime: asset.mime,
			buffer: Buffer.from(asset.data, "base64")
		})));
		const saveSamplesMs = [];
		const iterations = input.warmups + input.samples;
		for (let index = 0; index < iterations; index += 1) {
			const startedAt = performance.now();
			storage.saveSnapshot(input.snapshot);
			const elapsed = performance.now() - startedAt;
			storage.close();
			storage = new LibraryStorage(root, {
				ensureDirectories: false,
				allowCreate: false
			});
			await storage.open();
			if (checksum(storage.loadSnapshot()) !== durableHash) throw new Error(`${input.label} Electron durable reload checksum 不一致`);
			for (const expected of input.assets) {
				const actual = storage.getAssetBytes(expected.id);
				if (!actual || actual.mime !== expected.mime || !Buffer.from(actual.bytes).equals(Buffer.from(expected.data, "base64"))) throw new Error(`${input.label} Electron durable reload 附件不一致：${expected.id}`);
			}
			const manifest = storage.readManifest();
			if (!manifest.libraryId || !Number.isSafeInteger(manifest.schemaVersion)) throw new Error(`${input.label} Electron durable reload manifest 无效`);
			if (index >= input.warmups) saveSamplesMs.push(elapsed);
		}
		const quitSamplesMs = [];
		if (input.measureQuit) for (let index = 0; index < input.warmups + input.samples; index += 1) {
			let backupName = null;
			const coordinator = new QuitCoordinator({
				timeoutMs: 15e3,
				createRequestId: () => `benchmark-quit-${index}`,
				requestRendererFlush: async () => {
					storage.saveSnapshot(input.snapshot);
				},
				createVerifiedBackup: async () => {
					const backupPath = createBackupAtPath(storage, root, Date.now() + index);
					if (!backupPath) throw new Error("退出性能基准未生成恢复点");
					backupName = path.basename(backupPath);
					const verification = await verifyBackupAtPath(root, backupName);
					if (verification.status !== "verified") throw new Error(verification.error ?? "退出性能基准恢复点验证失败");
				},
				commitExit: async () => {
					await releaseThenFinalizeWithRollback(() => storage.release(), () => {}, () => storage.open());
					let released = false;
					try {
						storage.loadSnapshot();
					} catch {
						released = true;
					}
					if (!released) throw new Error("QuitCoordinator 未释放 LibraryStorage");
					await storage.open();
					assertReloadedState();
				},
				cancelPreparation: () => {},
				reportError: () => {}
			});
			const startedAt = performance.now();
			const result = await coordinator.request("quit");
			const elapsed = performance.now() - startedAt;
			if (!result.ok) throw new Error(result.error);
			if (backupName) deleteBackupAtPath(root, backupName);
			if (index >= input.warmups) quitSamplesMs.push(elapsed);
		}
		return {
			label: input.label,
			saveSamplesMs,
			quitSamplesMs,
			checksum: input.expectedHash,
			databaseBytes: fs.statSync(storage.getPaths().dbFile).size
		};
	} finally {
		storage.close();
		fs.rmSync(root, {
			recursive: true,
			force: true
		});
	}
}
//#endregion
export { runElectronPersistenceBenchmark };
