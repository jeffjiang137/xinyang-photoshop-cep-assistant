# 鑫洋助理 CEP 架构说明（v2.2.58）

## 1. 架构目标

保持 Photoshop CEP / ExtendScript 原生运行方式，不引入打包器，不改变 `LongStitchCEP.invoke(method, payloadJson)` 对外协议。v2.2.58 在 v2.2.57 模块化基础上进一步实现“浏览器侧 + Photoshop 宿主侧”双层真正按需加载：启动只加载基础运行时和宿主共享层，业务模块在第一次进入对应面板或第一次调用对应宿主方法时才加载，并在本次面板生命周期内缓存复用。

## 2. 浏览器侧按需加载

### 2.1 首屏固定脚本

`index.html` 只同步加载以下基础脚本：

1. `js/CSInterface.js`
2. `js/runtime.js`
3. `js/diagnostics.js`
4. `js/modules/settings/storage.js`
5. `js/panel.js`
6. `js/ui-polish.js`

OCR、LaMa、IOPaint、智能切片、文字工具、导入导出、变换和 CommonTools 不再在首屏同步解析。

### 2.2 面板依赖

`js/runtime.js` 通过 `PANEL_MODULES` 串行解析依赖：

- 默认 `stitch-panel`：无可选浏览器模块，保持最轻启动。
- `framework-panel`：加载 `framework`。
- `document-panel`：加载 `toolsImportExport → toolsTransform → tools`。
- `typography-panel`：加载 `baiduTranslator → toolsTypography → tools`。
- `tools-panel`：加载 `commonTools`。
- `text-panel`：加载 `ocrClient → lamaClient → iopaintManager → ocrService → ocrAnalyzer`。
- `settings-panel`：加载百度翻译和 OCR/LaMa/IOPaint 服务层，但不加载 OCR 版式分析算法。

导航悬停/聚焦不再预加载模块；只有真正进入面板后才加载。

### 2.3 功能级依赖

`FEATURE_MODULES` 用于不等同于整个面板的功能：

- `smartSlice`：`fileIO → smartSliceAnalyzer`。
- `ocrService`：OCR/LaMa/IOPaint 服务层。
- `ocrText`：服务层 + OCR Analyzer。
- `documentTools`：导入导出 + 变换 + tools 入口。
- `typographyTools`：翻译 + typography + tools 入口。

智能切片不再借用 `ocr/service.js` 读取临时图片；新增 `js/modules/common/file-io.js`，避免为了切片加载整套 OCR/LaMa/IOPaint。对于已有拼图源信息、无需像素分析的切片流程，连 `smartSliceAnalyzer` 都不会加载。

### 2.4 初始化时机

`panel.js` 不再在启动阶段调用 OCR/LaMa/IOPaint 状态渲染和探测。进入“改字”或“设置”面板并确认依赖加载完成后，才初始化对应服务状态。

文字工具同样按面板激活：`tools.js` 可先服务文档工具，不要求 `typography.js` 已存在；进入文字面板后再初始化字体、实时属性监听和文字事件。

### 2.5 例外：后台自动化

如果用户已经启用必须在 Photoshop 后台运行的自动填充/自动嵌入等监听，`runtime.js` 可以在启动后加载 `commonTools`。这是功能运行前置条件，不属于无条件预加载。

## 3. Photoshop 宿主侧按需加载

### 3.1 启动固定宿主模块

`jsx/host.jsx` 启动时只加载：

1. `jsx/modules/core/shared.jsx`
2. `jsx/modules/core/layers.jsx`
3. `jsx/modules/core/colors.jsx`
4. `jsx/modules/tools/layer-tools.jsx`

它们构成 `LongStitchCEP` 的共享基础和高频轻量图层能力。

### 3.2 业务模块首次调用加载

以下 JSX 不再启动时 `$.evalFile()`：

- `tools/embed-import.jsx`
- `tools/file-export.jsx`
- `text/text-tools.jsx`
- `core/diagnostics.jsx`
- `stitch/stitch-slice.jsx`
- `ocr/ocr-host.jsx`
- `framework/frame.jsx`
- `framework/guides.jsx`

`host.jsx` 为每个业务域注册 lazy wrapper。第一次调用该域任一 `LongStitchCEP` 方法时：

1. `ensureHostBusinessFactory()` 调用 `module-loader.loadOne()`；
2. 模块注册 factory；
3. 注入现有共享依赖并创建模块实例；
4. 执行原始方法；
5. 后续调用直接复用缓存实例，不再重复 `$.evalFile()`。

### 3.3 模块加载器缓存

`jsx/module-loader.jsx` 保存 `loadedMap` 和失败记录。相同路径只执行一次，`diagnostics()` 可查看实际已加载宿主模块。

## 4. 兼容规则

- 保持 `LongStitchCEP.invoke(method, payloadJson)` 不变。
- v2.2.57 → v2.2.58 的 124 个公开宿主方法名称、映射和顺序保持一致。
- `_runActiveJob`、`_runSliceJob`、`_runSpacingJob`、`_runTextJob`、`_runEraseJob`、`_runToolsJob` 名称保持不变。
- JSX 继续 ES5/ExtendScript 兼容，不使用 ES Module、CommonJS 或 Node `require()`。
- `common-tools-v210/v212/v214/v217` 与独立兼容 JSX 保留。
- 动态脚本使用串行 Promise 链，避免 CEP 老 Chromium 下依赖脚本竞态。

## 5. v2.2.58 按需加载结果

- 浏览器首屏不再同步加载 OCR、LaMa、IOPaint、Typography、Smart Slice 和 Tools 子模块。
- 当前首屏固定 JS 约 171 KB；按 v2.2.57 同等脚本集合估算约 551 KB，首屏解析量下降约 68.9%。
- 默认拼图面板启动后，可选浏览器模块加载集合为空。
- Photoshop 宿主启动只加载 4 个基础 JSX；诊断、文字、OCR、拼图切片、嵌入、导出、框架、参考线在首次调用时才加载。
- 智能切片图片 IO 与 OCR Service 解耦。
- OCR/LaMa 状态探测从“插件启动”移动到“进入相关面板”。
- 导航 hover/focus 预加载已取消。

## 6. 新功能开发边界

- 新面板模块优先注册到 `PANEL_MODULES`，不要重新写回 `index.html` 作为同步脚本。
- 只有真正跨面板且启动即必需的基础能力才允许进入首屏脚本。
- 新宿主业务域通过 `ensureHostBusinessFactory + lazyHostMethod` 注册，不允许重新加入启动全量 `evalFile()` 列表。
- 功能之间共享文件 IO、存储、图层等能力时抽到 common/core，不通过加载另一个大业务模块“顺便复用”。
- 继续保留强耦合算法聚合文件；按需加载和模块化不等于机械拆小文件。
