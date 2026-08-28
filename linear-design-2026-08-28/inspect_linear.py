from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from playwright.sync_api import sync_playwright


OUT = Path(__file__).resolve().parent
PAGES = {
    "home": "https://linear.app/",
    "design_refresh": "https://linear.app/now/behind-the-latest-design-refresh",
    "app_login": "https://linear.app/login",
}


def inspect_page(page, name: str, url: str) -> dict:
    responses: list[dict] = []

    def on_response(response):
        resource_type = response.request.resource_type
        if resource_type in {"stylesheet", "script", "font"}:
            responses.append(
                {
                    "url": response.url,
                    "status": response.status,
                    "resource_type": resource_type,
                }
            )

    page.on("response", on_response)
    page.goto(url, wait_until="networkidle", timeout=120_000)
    page.screenshot(path=str(OUT / f"{name}-desktop.png"), full_page=True)
    data = page.evaluate(
        r"""
        () => {
          const isVisible = (el) => {
            const s = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
          };
          const all = [...document.querySelectorAll('body *')].filter(isVisible);
          const props = ['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','color','backgroundColor','borderRadius'];
          const counts = Object.fromEntries(props.map(p => [p, {}]));
          for (const el of all) {
            const s = getComputedStyle(el);
            for (const p of props) {
              const v = s[p];
              counts[p][v] = (counts[p][v] || 0) + 1;
            }
          }
          const top = Object.fromEntries(Object.entries(counts).map(([p, values]) => [
            p,
            Object.entries(values).sort((a,b) => b[1]-a[1]).slice(0, 30)
          ]));
          const rootStyle = getComputedStyle(document.documentElement);
          const customProperties = {};
          for (const sheet of [...document.styleSheets]) {
            try {
              for (const rule of [...sheet.cssRules]) {
                const text = rule.cssText || '';
                for (const match of text.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;}]+)/g)) {
                  customProperties[match[1]] = rootStyle.getPropertyValue(match[1]).trim() || match[2].trim();
                }
              }
            } catch (_) {}
          }
          const selected = [...document.querySelectorAll('h1,h2,h3,p,button,[role="button"],nav a,header a')]
            .filter(isVisible)
            .slice(0, 120)
            .map(el => {
              const s = getComputedStyle(el);
              return {
                tag: el.tagName.toLowerCase(),
                role: el.getAttribute('role'),
                text: (el.innerText || el.textContent || '').trim().replace(/\s+/g,' ').slice(0,180),
                fontFamily: s.fontFamily,
                fontSize: s.fontSize,
                fontWeight: s.fontWeight,
                lineHeight: s.lineHeight,
                letterSpacing: s.letterSpacing,
                color: s.color,
                backgroundColor: s.backgroundColor,
                borderRadius: s.borderRadius,
                padding: s.padding,
                height: el.getBoundingClientRect().height,
              };
            });
          return {
            title: document.title,
            finalUrl: location.href,
            viewport: {width: innerWidth, height: innerHeight, dpr: devicePixelRatio},
            fonts: [...document.fonts].map(f => ({family:f.family, style:f.style, weight:f.weight, status:f.status})),
            customProperties,
            topComputedValues: top,
            selectedElements: selected,
          };
        }
        """
    )
    data["networkAssets"] = responses
    return data


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
        page = context.new_page()
        for name, url in PAGES.items():
            results[name] = inspect_page(page, name, url)
        browser.close()
    (OUT / "linear-design-evidence.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n"
    )
    print(json.dumps({k: {"title": v["title"], "finalUrl": v["finalUrl"]} for k, v in results.items()}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
