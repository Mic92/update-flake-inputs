// See: https://rollupjs.org/introduction/

import commonjs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'

const config = {
  input: 'src/index.ts',
  output: {
    esModule: true,
    file: 'dist/index.js',
    format: 'es',
    sourcemap: true
  },
  onwarn(warning, defaultHandler) {
    // Suppress "this" rewritten to "undefined" warnings from CJS dependencies.
    // These come from tsc-compiled __awaiter helpers in @actions/* packages that
    // use `(this && this.__awaiter)` — harmless when "this" becomes undefined.
    if (warning.code === 'THIS_IS_UNDEFINED' && warning.id?.includes('node_modules/')) {
      return
    }

    // Suppress circular dependency warnings from node_modules.
    // e.g. @actions/core/lib/core.js <-> oidc-utils.js — upstream issue, works fine.
    if (warning.code === 'CIRCULAR_DEPENDENCY' && warning.ids?.every(id => id.includes('node_modules/'))) {
      return
    }

    defaultHandler(warning)
  },
  plugins: [
    typescript(),
    nodeResolve({ preferBuiltins: true }),
    commonjs()
  ]
}

export default config
