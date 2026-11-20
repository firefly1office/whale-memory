// 注入的最小实现现已并入内核；这里保留薄壳，旧代码不用改。
// 规则见 docs/injection.md，模块见 packages/core/lib/injection.js
export { surface, shouldInject, INJECTION_RULES } from '../../packages/core/lib/injection.js'
