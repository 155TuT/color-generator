# 研究来源与实现依据

以下来源对应当前实现采用的色彩数学、对比度定义、浏览器能力与第三方依赖。生成策略、默认参数和评分权重由项目定义，不是标准给出的审美规则。

## OKLab、OKLCh 与色差

| 来源 | 本项目采用的内容 |
| --- | --- |
| [Björn Ottosson：A perceptual color space for image processing](https://bottosson.github.io/posts/oklab/) | OKLab 坐标及 sRGB 转换矩阵；在 OKLab 中计算距离，在 OKLCh 中编辑明度、彩度、色相。 |
| [W3C：CSS Color Module Level 4](https://www.w3.org/TR/css-color-4/) | OKLab / OKLCh 定义、转换参考和欧氏距离 ΔEOK。 |

项目使用 `ΔE = 100 × OKLab 欧氏距离`。例如色差下限 1.4 对应未缩放 ΔEOK 0.014。放大系数只为便于阅读，数值不等同于 CIEDE2000。感知均匀性是近似，色块大小、显示设备与环境仍影响实际辨认。

`C = sqrt(a²+b²)` 是 OKLab 的 a/b 平面上离中性轴的距离。默认硬彩度区间 0.03–0.11 用于避开过灰与过艳区域，是项目参数。

## 相对亮度与对比度

| 来源 | 本项目采用的内容 |
| --- | --- |
| [W3C：WCAG 2.2 相对亮度](https://www.w3.org/TR/WCAG22/#dfn-relative-luminance) | sRGB 线性化与 `Y = 0.2126R + 0.7152G + 0.0722B`。 |
| [W3C：WCAG 2.2 对比度](https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio) | `(Y亮 + 0.05) / (Y暗 + 0.05)`。 |
| [W3C：Understanding SC 1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) | AA 常规正文至少 4.5:1，大号文字至少 3:1，使用未舍入值判断。 |

本工具只处理不透明 sRGB HEX，文字比值采用固定文字色与每个底色计算。默认 1.8:1 用于浅色配色探索，低于常规正文 AA 的 4.5:1；选择自定义阈值不等于页面满足无障碍要求。底色之间的最大对比则是项目的风格约束，与 WCAG 的文字成功准则不同。

当前实现使用 OKLab 欧氏距离与 WCAG 比值，没有使用 APCA 或 CIEDE2000；两者的数值与当前阈值不混用。

## sRGB 与 Display P3

| 来源 | 本项目采用的内容 |
| --- | --- |
| [W3C CSS Color 4：sRGB](https://www.w3.org/TR/css-color-4/#predefined-sRGB) | sRGB 颜色空间及通道边界，用于实际六位 HEX 输出。 |
| [W3C CSS Color 4：Display P3](https://www.w3.org/TR/css-color-4/#predefined-display-p3) | Display P3 原色和 D65 白点，用于相同明度下的参考范围。 |
| [W3C CSS Color 4：色彩转换参考代码](https://www.w3.org/TR/css-color-4/#color-conversion-code) | OKLab、D65 XYZ 与线性 Display P3 之间的矩阵转换。 |

地图沿色相方向二分求通道合法范围，展示当前明度的二维截面。Display P3 的灰色环带仅说明范围，不模拟超出 sRGB 的真实颜色。生成候选转换为每通道 8 位的 sRGB HEX 后，再计算全部指标；出 sRGB 的点直接拒绝。

## 生成策略的职责

顺序生长、自动范围、Halton 采样偏移、近邻目标、最小生成树补过渡、参考色相软区间、彩度代价和显示排序是项目实现。它们共同服务于少量相邻色系的连续配色，而非将允许空间尽量铺满。

默认随机明度 L 0.50–0.82、色相软容忍半宽 18°、单起点彩度软带，以及近邻步长与评分权重均为工程参数。两套示例用于表达风格目标，不是隐藏候选池，也不保证任意起点都生成相同风格。具体公式和停止条件见[算法说明](ALGORITHM.md)。

## 浏览器文件能力

自选保存目录通过 File System Access API 由用户点击授权读写。实现使用方法存在性检测，不支持时保留普通浏览器下载。目录内同名文件采用完整替换写入，等待写入流关闭后报告完成。[Chrome File System Access 说明](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)、[MDN：showDirectoryPicker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker)

目录选择要求安全上下文与用户交互；HTTPS、localhost 和回环地址满足相应安全上下文条件。句柄只保存在当前页面内存，不写入 JSON 或浏览器缓存。[MDN：安全上下文](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts)

## 界面、文档与许可

| 依赖 | 用途 | 许可 |
| --- | --- | --- |
| [React / React DOM](https://react.dev/) | 组件、状态与交互。 | MIT |
| [Vite](https://vite.dev/) | 开发服务与生产构建。 | MIT |
| [Lucide](https://lucide.dev/) | React 组件和独立地图控件的图标。 | ISC；Feather 衍生部分保留 MIT 通知。 |
| [Marked](https://marked.js.org/) | Markdown 解析。 | MIT |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 文档 HTML 清理。 | Apache-2.0 或 MPL-2.0 双许可。 |

依赖与锁定版本记录在 `package.json`、`package-lock.json`。构建随站点复制 Lucide 完整许可到 `docs/LUCIDE-LICENSE.txt`，并将 React、React DOM、Marked 和 DOMPurify 许可置于 `docs/licenses/`。[Lucide 官方许可](https://lucide.dev/license)

界面依赖只负责呈现与交互，不提供配色规则。文档路径由固定允许列表控制，Markdown 在渲染前清理；JSON 导入按项目字段重建数据，不运行文件中的内容。
