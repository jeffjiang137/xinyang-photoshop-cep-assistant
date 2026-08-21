# 贡献指南

感谢你愿意改进鑫洋助理。这个项目运行在 Photoshop CEP 环境中，很多问题只有在真实 Photoshop 文档里才能确认，因此高质量的复现信息比大段截图更重要。

## 提交问题

请尽量提供：

- Photoshop 版本、系统版本和插件版本；
- 使用的面板和具体按钮；
- 可重复的最小步骤；
- 预期结果与实际结果；
- 脱敏后的“设置 → 导出调试报告”。

不要上传 PSD、商品原图、API 密钥、访问令牌或包含个人路径的原始日志。

## 修改代码

- 浏览器 UI 和状态逻辑放在 `js/`，Photoshop 宿主操作放在 `jsx/`。
- 新的浏览器模块放在 `js/modules/`，宿主模块放在 `jsx/modules/`，遵循现有按需加载和依赖注入方式。
- ExtendScript 保持 ES5 兼容，使用 `var`、函数声明和四空格缩进。
- 公开宿主操作必须通过现有 `LongStitchCEP` 方法表注册，保持旧调用方兼容。
- 用户可见文字保持简洁中文。

## 验证与提交

提交前至少运行：

```powershell
node --check js/runtime.js
node --check js/panel.js
```

涉及宿主脚本时，请在可丢弃 PSD 上验证新建文档、已有组、智能对象、锁定图层和剪切蒙版，并确认 Ctrl+Z。提交信息使用简短的英文祈使句，例如 `fix: preserve clipping masks during export`。
