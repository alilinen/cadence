;; Source for callback-vi.wasm. Rebuild with: wat2wasm callback-vi.wat
;; Turn a JavaScript void(i32) callback into a WASM-table-compatible function
;; without compiling code inside the Worker.
(module
  (import "e" "f" (func $callback (param i32)))
  (export "f" (func $callback)))
