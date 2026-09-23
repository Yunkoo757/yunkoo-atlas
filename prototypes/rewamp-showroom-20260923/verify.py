from pathlib import Path
from playwright.sync_api import sync_playwright
import json

OUT=Path(__file__).resolve().parent
catalog=json.loads((OUT/'catalog.json').read_text('utf-8'))
results=[];errors=[];network=[]
with sync_playwright() as p:
    browser=p.chromium.launch(channel='msedge',headless=True,args=['--enable-unsafe-swiftshader'])
    page=browser.new_page(viewport={'width':1440,'height':1050},device_scale_factor=1)
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('requestfailed',lambda r:network.append({'url':r.url[:180],'reason':r.failure}))
    page.goto((OUT/'showroom.html').as_uri(),wait_until='load')
    def ready():
        page.wait_for_function("document.querySelector('#status').textContent.includes('可操作') || document.querySelector('#status').textContent.includes('运行失败')",timeout=20000)
        frame=page.locator('iframe').first.content_frame
        frame.locator('[data-demo-stage]').wait_for()
        return frame
    frame=ready()
    page.screenshot(path=str(OUT/'showroom-folder.png'),full_page=True)
    # Full registry smoke: checks mounting, error boundary and viewport containment.
    for i,e in enumerate(catalog):
        page.evaluate('(slug)=>window.__SHOWROOM__.select(slug)',e['slug'])
        page.locator('[data-mode=original]').click()
        frame=ready()
        frame.locator('[data-demo-stage] > *').first.wait_for()
        page.wait_for_timeout(120)
        result={'slug':e['slug'],'mode':'original','status':page.locator('#status').inner_text(),'outerOverflow':page.evaluate('document.documentElement.scrollWidth>innerWidth')}
        results.append(result)
        if e['context']:
            page.locator('[data-mode=atlas]').click()
            frame=ready()
            page.wait_for_timeout(120)
            results.append({'slug':e['slug'],'mode':'atlas','status':page.locator('#status').inner_text()})
        if i%10==0: print(f'checked {i+1}/{len(catalog)}',flush=True)
    # Representative true interactions.
    page.evaluate("window.__SHOWROOM__.select('folder-tab-card')")
    page.locator('[data-mode=atlas]').click();frame=ready()
    print('folder buttons:',frame.locator('button').all_text_contents(),flush=True)
    frame.locator('button').first.click()
    frame.get_by_text('等待回踩后的执行',exact=True).wait_for()
    assert frame.locator('img').count()==6
    frame.get_by_role('button',name='返回集合').click()
    page.evaluate("window.__SHOWROOM__.select('morphing-tab-navbar')")
    page.locator('[data-mode=atlas]').click();frame=ready()
    frame.get_by_role('button',name='周复盘',exact=True).click()
    page.wait_for_timeout(350)
    page.screenshot(path=str(OUT/'showroom-navigation.png'),full_page=True)
    page.evaluate("window.__SHOWROOM__.select('neumorphic-download-button')")
    page.locator('[data-mode=atlas]').click();frame=ready()
    frame.get_by_role('button',name='导出备份').click()
    frame.get_by_text('正在导出…',exact=True).wait_for()
    page.screenshot(path=str(OUT/'showroom-download.png'),full_page=True)
    frame.get_by_text('备份完成',exact=True).wait_for()
    page.evaluate("window.__SHOWROOM__.select('perspective-flip-deck')")
    page.locator('[data-mode=compare]').click();ready()
    page.wait_for_timeout(500)
    page.screenshot(path=str(OUT/'showroom-compare.png'),full_page=True)
    # User selection, filtering and downloadable selection list.
    page.locator('#save').click()
    page.locator('[data-filter=saved]').click()
    assert page.locator('#catalog .item').count()==1
    with page.expect_download() as dl: page.locator('#exportSelection').click()
    assert dl.value.suggested_filename=='atlas-rewamp-selection.json'
    page.locator('[data-filter=all]').click()
    page.locator('#search').fill('翻牌')
    assert page.locator('#catalog .item').count()==1
    page.locator('#search').fill('')
    # Smaller desktop viewport, main modes and long labels.
    page.set_viewport_size({'width':1024,'height':900})
    page.evaluate("window.__SHOWROOM__.select('morphing-tab-navbar')")
    page.locator('[data-mode=atlas]').click();ready()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(OUT/'showroom-1024.png'),full_page=True)
    page.locator('#theme').click();ready()
    page.screenshot(path=str(OUT/'showroom-light-1024.png'),full_page=True)
    page.locator('#expand').click()
    assert page.locator('body').evaluate("e=>e.classList.contains('fullscreen')")
    page.locator('#expand').click()
    (OUT/'verification.json').write_text(json.dumps({'mounts':results,'errors':errors,'networkFailures':network,'interactions':['Folder open and return','Chinese navigation tab selection','Download animation idle -> busy -> done','Original vs Atlas split view','Save/filter/export selection','1024 desktop / light theme / expand preview'],'limits':['Windows Edge, scale 1 only','70 original mounts and 16 contextual mounts are smoke coverage, not exhaustive interaction or accessibility testing','Remote upstream stock images may still need network','macOS and production Electron are not tested']},ensure_ascii=False,indent=2),encoding='utf-8')
    browser.close()
print(f'Complete: {len(results)} mounts, {len(errors)} page errors, {len(network)} failed requests',flush=True)
