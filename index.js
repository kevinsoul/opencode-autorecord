// OpenCode V2 目录式插件入口：仅识别插件根目录的 index.js / index.ts，
// 此处转交给 tsup 构建产物（真正的插件定义在 src/index.ts → dist/index.js）。
export { default } from './dist/index.js';
