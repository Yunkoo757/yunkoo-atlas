import path from 'node:path'

export function websiteCopyPlan(root) {
  const guide = path.resolve(root, '../atlas-docs-site')
  const copies = []
  function include(base, file, directory = false, requiredChildren = []) {
    const relative = base === guide ? 'guide/' + file : file
    copies.push({ source: path.join(base, file), relative, directory, requiredChildren })
  }
  for (const file of ['index.html', 'style.css', 'app.js', 'fluid-loader.js', 'assets/favicon.svg', 'assets/inter-variable.woff2']) include(root, file)
  include(root, 'vendor', true, ['liquid-ether.js', 'three.module.js', 'three.core.js', 'LIQUID-ETHER-LICENSE.txt', 'THREE-LICENSE.txt'])
  for (const file of ['index.html', 'app.js', 'content.js', 'data.js', 'icons.js', 'product-shot.js', 'site-shell.js', 'assets/favicon.svg', 'assets/inter-variable.woff2']) include(guide, file)
  include(guide, 'styles', true)
  include(guide, 'assets/product', true)
  return copies
}
