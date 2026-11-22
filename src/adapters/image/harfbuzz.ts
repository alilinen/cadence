/**
 * Satori expects HarfBuzz's Promise API. Its Node entry loads hb.wasm from
 * disk; Workers needs a statically imported WebAssembly.Module instead.
 * The exact-module alias in Wrangler and Vitest leaves hb.js/hbjs.js intact.
 */
// @ts-expect-error HarfBuzz's Emscripten factory has no declaration file.
import createHarfBuzz from 'harfbuzzjs/hb.js'
// @ts-expect-error HarfBuzz's JavaScript API wrapper has no declaration file.
import createApi from 'harfbuzzjs/hbjs.js'
// @ts-expect-error Wrangler bundles .wasm as a WebAssembly.Module.
import wasm from '../../../node_modules/harfbuzzjs/hb.wasm'
// @ts-expect-error Wrangler bundles .wasm as a WebAssembly.Module.
import callbackWasm from './callback-vi.wasm'

interface HarfBuzzModule {
  addFunction(callback: unknown, signature: string): number
}

export default createHarfBuzz({
  instantiateWasm(
    imports: WebAssembly.Imports,
    receiveInstance: (instance: WebAssembly.Instance) => void,
  ) {
    const instance = new WebAssembly.Instance(wasm, imports)
    receiveInstance(instance)
    return instance.exports
  },
}).then((module: HarfBuzzModule) => {
  const addFunction = module.addFunction
  module.addFunction = (callback, signature) => {
    // hbjs registers a memory-release callback. Emscripten normally generates
    // a tiny WASM wrapper for it, which Workers forbids. Use the precompiled
    // equivalent, preserving the callback and Emscripten's table management.
    if (signature !== 'vi') throw new Error(`Unsupported HarfBuzz callback: ${signature}`)
    const wrapper = new WebAssembly.Instance(callbackWasm, { e: { f: callback as CallableFunction } })
    return addFunction(wrapper.exports.f, signature)
  }
  return createApi(module)
})
