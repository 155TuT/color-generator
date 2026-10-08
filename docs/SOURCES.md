# 研究来源与实现取舍

查阅日期：2026-10-08。以下均为标准发布方、算法作者或维护者提供的一手资料。版本状态按查阅当日记录；链接指向持续更新的页面时，应重新核对版本与许可。

## OKLab、OKLCh 与色差

| 来源 | 本项目采用的内容 | 使用边界 |
| --- | --- | --- |
| [Björn Ottosson：A perceptual color space for image processing](https://bottosson.github.io/posts/oklab/) | OKLab 的坐标、sRGB 转换和感知空间设计；在 OKLab 中比较距离，在 OKLCh 中编辑明度、彩度、色相。 | 感知均匀性是近似。模型距离不能替代实际字号、色块大小和观察环境下的辨认。 |
| [W3C：CSS Color Module Level 4](https://www.w3.org/TR/css-color-4/) | 第 9 节的 OKLab / OKLCh、第 19 节的转换参考、第 20.3 节的欧氏距离 ΔEOK。 | 本次复核版本为 2026-10-07 Candidate Recommendation Draft。本项目显式使用普通 ΔEOK × 100，不混用同一文档中的其他色差公式。 |

`minDeltaE = 1.4` 表示未缩放 ΔEOK 为 `0.014`。放大 100 倍只是让参数易读，不能把这个数值解释成 CIEDE2000 的 `1.4`，也不能据此承诺任何使用场景都能分辨。推荐值用于控制密度，完整色板仍应放进课表查看。

## 相对亮度与文字对比度

| 来源 | 本项目采用的内容 | 使用边界 |
| --- | --- | --- |
| [W3C：WCAG 2.2 相对亮度定义](https://www.w3.org/TR/WCAG22/#dfn-relative-luminance) | sRGB 通道线性化和 `Y = 0.2126R + 0.7152G + 0.0722B`。当前通道分界值为 `0.04045`。 | 输入为不透明 sRGB 色码；透明色应先合成到实际背景。本工具只输出不透明 HEX。 |
| [W3C：WCAG 2.2 对比度定义](https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio) | `(Y亮 + 0.05) / (Y暗 + 0.05)`；分别用于文字与底色、底色与底色的数值检查。 | 底色间的最大比值是本工具的风格约束，并不是 WCAG 的正文文字成功准则。 |
| [W3C：Understanding SC 1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) | AA 常规正文至少 `4.5:1`，大号文字至少 `3:1`；判定使用未舍入值。 | `4.499` 不能显示成 `4.50` 后算通过。色板通过某个对比度阈值也不代表整个页面符合 WCAG。 |

默认 `minTextContrast = 1.65` 服务于浅色课程色板的视觉探索，**不满足 AA 常规正文的 4.5:1 要求**。完整色板生长会严格执行用户设定的数值，但不会把自定义阈值称作无障碍合规。首次取色允许保留暂时不满足该阈值的探索起点，并如实显示冲突；继续生长前须先解决冲突。需要正文 AA 时，应把阈值改为 `4.5`，并结合实际字体、背景与布局验证。

## APCA 的成熟状态与许可

| 来源 | 查阅结论 | 本版决定 |
| --- | --- | --- |
| [Myndex：apca-w3 官方仓库](https://github.com/Myndex/apca-w3) | 包版本 `0.1.9` 标为 beta。APCA 输出有极性的 `Lc`，其解释还涉及文字大小和字重。 | 不把 APCA 的 Lc 与 WCAG 比值混在同一个阈值中。 |
| [APCA 官方说明](https://git.apcacontrast.com/documentation/README.html) | 官方仍以测试、验证中的方法说明其使用，并提供字体相关指引。 | 本版仅使用 WCAG 比值作为可复核的硬约束，没有集成 APCA 算法或依赖。 |
| [apca-w3 LICENSE.md](https://github.com/Myndex/apca-w3/blob/master/LICENSE.md) | 使用的是附带适用范围、实现一致性、更新和声明要求的专用许可。 | 不按普通 MIT / BSD 许可处理。未来集成应按当时官方条款核对用途、实现版本和声明。 |
| [W3C：WCAG 3.0](https://www.w3.org/TR/wcag-3.0/) | 查阅版本为 2026-09-10 Working Draft，仍可能更改。 | 不宣称 APCA 已成为发布的 WCAG 3 标准要求，不提供 WCAG 3 合规声明。 |

这些取舍不否认 APCA 的研究价值，而是避免在只有文字颜色、没有字号与字重参数的色板工具中给出含义不完整的合格标签。

## CIEDE2000 的取舍

| 来源 | 本项目参考的内容 | 本版决定 |
| --- | --- | --- |
| [Gaurav Sharma、Wencheng Wu、Edul N. Dalal：CIEDE2000 作者资料页](https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/) | 2005 年论文、实现注意事项及校验数据；公式输入为 CIELAB，包含额外修正与分支处理。 | 本版无需与 CIELAB 测量流程交换数据，选择直接适配 OKLab 搜索空间的欧氏距离。 |
| [ISO/CIE 11664-6:2022 官方信息](https://www.iso.org/standard/82662.html) | CIEDE2000 的标准名称、版本和适用输入。 | 不把 OKLab 数值直接送入 CIEDE2000；不复制作者资料页中的 MATLAB / Excel 实现。 |

CIEDE2000 与 OKLab 欧氏距离解决的建模细节不同，不存在对全部颜色都有效的固定换算系数。若以后增加 ΔE2000，须增加正确的 CIELAB 转换、独立阈值和标准校验样本，而不是沿用现在的 `minDeltaE`。

## 本项目自行定义的部分

`C = sqrt(a²+b²)` 来自 OKLab / OKLCh 坐标关系；默认硬彩度区间 `0.03–0.11` 是项目对灰度与鲜艳程度的工程取舍，并非上述标准推荐值。地图内外圈围绕中性轴表示该区间，颜色转换与最终 HEX 的量化复核仍沿用既有数学实现。

少量颜色推导搜索域、确定性候选采样、贪心补点、局部替换、色彩地图诊断提示和色相分组排序，是本工具的工程方案。保留的 v2 引擎在原候选池和三轮搜索内改进近邻评分；主色路径、偏好步长、彩度双向代价和权重也是工程选择，不来自上述标准。

当前 v3 工作台以已有颜色的分布逐步决定下一色：颜色分离较远时补足过渡，局部已经紧密时向邻近色系探索，目标是形成少量相邻、可衔接的色系。新增、补全与随机替换共用这套取点流程，颜色的出生顺序、父节点和策略记录用于区分生成关系与显示排序。首色可作为自由探索的起点，但其实际文字对比和范围冲突仍会显示；后续取点继续使用原有量化、色域判断和硬约束检查。以上策略及参数是项目定义的启发式，不是新的色彩空间、对比度标准或通用审美公式。

单主色使用彩度软容忍带，避免把唯一参考 C 错当成固定半径；带内交给近邻距离和相邻色系评分选择，带外才计偏离代价。半宽 `min(0.018, s / 200)` 是针对本项目径向退化实验选择的工程参数，没有新增或替换色彩转换公式。修正前后证据保存在 [单主色径向实验](analysis/radial-growth.json)。

两套原色的分布证据见 [配色分析](PALETTE_STUDY.md)。它们用于理解紧邻色系、彩度变化和连接结构，不作为候选 HEX 表，也不保证任意起点都会产生相同风格或恰好相同的色系数量。其可行性与局限见 [算法说明](ALGORITHM.md)，实际参数和操作见 [使用说明](../README.md)。上述来源提供色彩数学与标准依据，不为本项目的搜索策略或默认美学参数背书。

## sRGB / Display P3 图示

| 来源 | 本项目采用的内容 | 使用边界 |
| --- | --- | --- |
| [W3C CSS Color 4：sRGB 定义](https://www.w3.org/TR/css-color-4/#predefined-sRGB) | sRGB 颜色空间和通道边界，用于判断当前点能否输出为八位 HEX。 | 图示、编辑与导出均以 sRGB 为实际输出空间。 |
| [W3C CSS Color 4：Display P3 定义](https://www.w3.org/TR/css-color-4/#predefined-display-p3) | Display P3 的原色和 D65 白点，作为同一明度截面的参考边界。 | Display P3 与 DCI-P3 不可混用；灰色环带仅表示范围，不声称显示了超出 sRGB 的真实色彩。 |
| [W3C CSS Color 4：色彩转换参考代码](https://www.w3.org/TR/css-color-4/#color-conversion-code) | OKLab、D65 XYZ 和线性 Display P3 之间的矩阵转换。 | 本工具沿色相方向二分求边界；边界图是二维截面，并非所有明度的色域投影。 |

设备色域、用户生成范围与硬约束是三个不同概念。设备边界决定可编码的颜色，生成范围决定候选采样位置，硬约束决定固定颜色与新色是否兼容。边界内可自由探索；悬停使用量化 HEX 精确检查，生成仍完整审计。

## Lucide 图标与许可

界面使用开源 [Lucide 图标库](https://lucide.dev/)。React 组件使用 `lucide-react@1.52.0`，独立 Canvas 地图控件使用 `lucide@1.52.0`；已核对包内 LICENSE 与 [Lucide 官方许可](https://lucide.dev/license)。Lucide 主体采用 ISC；许可文件列出的 Feather 衍生图标另保留 MIT 通知。构建将完整通知复制到 `dist/docs/LUCIDE-LICENSE.txt`。

图标库只提供图标，不负责本项目的布局、选色状态、生成逻辑或无障碍合规。按钮的名称、状态、对齐与交互由本项目实现。

## 界面与文档依赖

工作台由 [React](https://react.dev/) 管理组件和状态，[Vite](https://vite.dev/) 提供开发服务器与构建；依赖统一记录在 `package.json` 和 npm 的 `package-lock.json`。界面依赖负责呈现与交互，工作台的 v3 取点流程仍复用项目原有色彩转换、WCAG 对比和量化审计，并保留 v2 引擎供独立调用与历史对照。

文档目录从项目内的 Markdown 文件读取正文，通过 [Marked](https://marked.js.org/) 解析、[DOMPurify](https://github.com/cure53/DOMPurify) 清理 HTML，再渲染表格、代码和章节导航。文档文件采用固定允许列表，不从查询参数加载任意路径。生产构建包含正文、分析图和脚本，无需外部 CDN。

已核对安装包许可：React / React DOM 和 Marked 为 MIT；DOMPurify 提供 Apache-2.0 或 MPL-2.0 双许可。构建将这些包的许可文件复制到 `dist/docs/licenses/`，随静态站点一同分发。包的用途仅是界面和文档呈现，不作为色彩生成研究依据。
