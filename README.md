# 鑫洋助理 · Xinyang Assistant

[![最新版本](https://img.shields.io/badge/version-2.2.69-2563eb.svg)](CSXS/manifest.xml)
[![Photoshop CEP](https://img.shields.io/badge/Adobe%20Photoshop-CEP%20%2F%20ExtendScript-31a8ff.svg)](https://developer.adobe.com/photoshop/)
[![GitHub stars](https://img.shields.io/github/stars/jeffjiang137/xinyang-photoshop-cep-assistant?style=flat)](https://github.com/jeffjiang137/xinyang-photoshop-cep-assistant/stargazers)

面向电商设计与高频修图工作的 Photoshop CEP 面板。它把批量拼图、版式生成、文字处理、图层整理和导出等重复操作集中到一个中文工具面板中，适合商品详情页、营销图和长图制作流程。

> This is a Photoshop CEP extension for ecommerce design workflows. The interface is currently Chinese-first, while the source and architecture notes are open for community contribution.

## 能做什么

- **拼图与长图**：批量导入图片、按画布宽度拼接、调整间距、智能切片和切片导出。
- **规则版式**：用行列表达式快速生成自定义框架，并设置标题位置与对齐方式。
- **图片转文字**：OCR 识别图片文字，生成可编辑文字图层；可选 LaMa / IOPaint 擦除原文字。
- **文字排版**：字体与字重、字符/段落属性、颜色、对齐分布、复制粘贴样式和一键自动排版。
- **常用工具**：导入图片、智能吸附、图层对齐/分布/变换、自动填充、嵌入图片、文件瘦身和批量导出。
- **文档与参考线**：常用电商尺寸预设、自定义文档、安全参考线及 GuideGuide 风格的参考线工具。
- **按需加载**：浏览器侧和 Photoshop ExtendScript 宿主侧均按功能懒加载，减少首屏脚本解析和不必要的本地服务探测。

## 安装

1. 下载仓库 ZIP，解压后确保目录名为 `com.jeffjiang.ecommerce-design-assistant-cep`。
2. 将整个目录复制到 Windows 的 CEP 扩展目录：

   `%APPDATA%\Adobe\CEP\extensions\com.jeffjiang.ecommerce-design-assistant-cep`

3. 如果 Photoshop 尚未允许未签名 CEP 扩展，请按 Adobe CEP 的调试扩展文档设置 `PlayerDebugMode`。
4. 完全退出并重新打开 Photoshop，在“窗口 → 扩展（旧版）”中打开“鑫洋助理”。

更新时建议先关闭 Photoshop，再覆盖扩展目录；插件保存的用户配置和服务密钥位于扩展目录之外，不会随仓库同步。

## 可选服务

基础拼图、框架、文字排版和图层工具不依赖外部服务。以下功能可按需配置：

- **百度翻译**：在“设置”中填写自己的 APPID 和密钥，用于文字面板在线翻译。
- **OCR**：可使用本机 OCR 服务，或在设置中填写兼容的 HTTP OCR 接口。
- **LaMa / IOPaint**：仅在擦除图片文字时按需启动或连接本地服务。

仓库不包含任何 API 密钥、模型文件或本地运行数据库；请不要把个人凭据提交到 GitHub。

## 兼容性与开发

- 运行环境：Adobe Photoshop CEP 面板 + ExtendScript 宿主脚本。
- 宿主入口：`index.html`、`js/runtime.js`、`jsx/host.jsx`。
- 浏览器侧模块：`js/modules/`。
- Photoshop 宿主模块：`jsx/modules/`，由 `jsx/module-loader.jsx` 按需加载。
- 对外宿主协议保持为 `LongStitchCEP.invoke(method, payloadJson)`。

本项目没有 Node 打包流程；修改后可直接重新加载 CEP 面板。浏览器侧可以运行：

```powershell
node --check js/runtime.js
node --check js/panel.js
```

修改 `jsx/host.jsx` 或其他宿主脚本后，需要重启 Photoshop，并使用一个可丢弃的 PSD 手工验证撤销行为、已有组、智能对象、锁定图层和剪切蒙版。

架构约束和模块加载顺序见 [ARCHITECTURE.md](ARCHITECTURE.md)，版本测试记录见 [V2.2.69_TEST_REPORT.txt](V2.2.69_TEST_REPORT.txt)。

## 参与贡献

欢迎提交 Bug、功能建议和 Photoshop 版本兼容性反馈。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，提交问题时附上 Photoshop 版本、复现步骤、预期/实际结果和脱敏后的诊断报告。

## 许可证

项目自有代码按 [MIT License](LICENSE) 发布。仓库内的 Adobe CSInterface、GuideGuide 及其他第三方资源仍受其原始版权和许可条款约束，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

如果这个面板帮你减少了重复的电商修图工作，欢迎点一个 Star，或分享你的 Photoshop 工作流反馈。
