<h1 align="center">
  <picture>
    <img src="./public/favicon.svg" alt="色序" width="36" height="36">
  </picture>
  色序 · Course Color Studio
</h1>

<p align="center">
  为 <a href="https://github.com/west2-online/fzuhelper-app">福大助手 fzuhelper-app</a> 的课表自动配色制作的 Demo。
</p>
<p align="center">
  <a href="https://155tut.github.io/color-generator/">在线工作台</a>
  ·
  <a href="https://155tut.github.io/color-generator/docs/index.html">使用文档</a>
  ·
  <a href="https://github.com/155TuT/color-generator/issues">问题反馈</a>
  ·
  <a href="./LICENSE">MIT License</a>
</p>

## 项目简介

色序用于探索一套适合课表的配色生成方式：不同课程之间有足够的区分，同一张课表又能保持柔和、连贯的风格。

从一个或几个颜色出发，生成器在 OKLab / OKLCh 色彩空间中逐色寻找近邻。已有颜色相距较远时补足过渡，局部过于接近时寻找变化，最后形成最多 25 色的色板。工作台同时展示颜色分布、近邻距离和文字对比，便于观察生成结果并继续调整。

当前项目是独立运行的浏览器 Demo，用于配色算法与交互的探索。计算、导入和导出都在浏览器本地完成，不需要后端，也不会上传导入文件的内容。刷新页面会回到空色板；需要保留或继续编辑时，请保存 JSON。

## 主要功能

- 逐色生成：新增一步或保留现有颜色补齐到 25 色，生成后自动排序。
- 颜色编辑：在色彩图中粗调，再通过 HEX、明度、色相和彩度控件微调。
- 全局规则：设置文字对比、色差下限、底色对比上限、硬彩度和生成范围。
- 分布分析：联动查看色相与彩度、色相与明度两张图，以及最近邻和整套色板的衔接情况。
- 色板管理：任意多选、随机替换、删除、排序，支持撤销与重做。
- 文件保存：导入 JSON 继续编辑，导出 JSON、SVG 或 PNG；支持选择本地文件夹并替换同名文件。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 界面 | React、TypeScript、Lucide |
| 构建 | Vite、npm |
| 配色计算 | OKLab / OKLCh、sRGB、Web Worker |
| 文档 | Markdown、Marked、DOMPurify |
| 文件 | File API、Blob、File System Access API |
| 部署 | GitHub Actions、GitHub Pages |

## 目录结构

```text
color-generator/
├─ src/
│  ├─ components/          # 全局规则、编辑、色板与保存界面
│  ├─ sequential-growth.ts # 逐色生长与候选选择
│  ├─ style-model.ts       # 相邻色系与过渡评分
│  ├─ color.ts             # 色彩转换、色差与对比度
│  ├─ generation.worker.ts # 后台生成任务
│  ├─ project-io.ts        # JSON 项目导入
│  ├─ export.ts            # JSON、SVG、PNG 导出
│  └─ file-save.ts         # 本地目录保存
├─ public/examples/       # 水雾森林、暮山陶土示例 JSON
├─ docs/                  # 文档目录、算法说明与研究来源
├─ scripts/               # 构建时复制文档和许可文件
├─ .github/workflows/     # GitHub Pages 部署流程
└─ LICENSE
```

## 启动与构建

需要 Node.js 20.19+（20.x）或 22.12+，以及 npm。

```bash
git clone https://github.com/155TuT/color-generator.git
cd color-generator
npm ci
npm run dev
```

打开终端显示的本地地址。已有依赖时，直接执行 `npm run dev` 即可。

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动本地开发服务器。 |
| `npm run build` | 编译并生成静态站点，输出到 `dist/`。 |
| `npm run preview` | 在本地预览构建结果。 |

## 从颜色到色板

1. 点击虚线加号卡生成第一个颜色，也可以导入已有 JSON。需要指定起点时，在左侧修改该色的 HEX。
2. 在顶部调整生成规则。各项右侧的圆圈叹号提供说明，高级参数直接展开。
3. 点击“生成”保留现有颜色并补齐到 25 色；点击加号只生成下一色。
4. 选中色块进行批量操作，点击色码或分布图中的点切换左侧编辑对象。
5. 点击“保存色板”命名并选择格式。JSON 保留规则、颜色与生成状态，可再次导入；SVG 和 PNG 用于编辑、查看或分享。

“随机”替换选中的颜色：部分选择时保留未选颜色，全选时从新的首色重新生长。`Ctrl+Z` 撤销，`Ctrl+Y` 或 `Ctrl+Shift+Z` 重做；macOS 使用 Command。

两套示例“水雾森林”和“暮山陶土”以可编辑 JSON 提供，下载入口见[算法文档的示例文件](docs/ALGORITHM.md#示例文件)。它们用于观察相邻色系的分布，不会自动加载。

默认最低文字对比为 `1.8:1`，用于浅色配色探索。需要常规正文的 WCAG AA 对比时，可选择 `4.5` 刻度；最终仍需结合实际课表中的文字、背景与布局判断。具体计算、参数和停止条件见[算法说明](docs/ALGORITHM.md)，数学依据与依赖许可见[研究来源](docs/SOURCES.md)。

## 本地文件与权限

普通 JSON 导入只读取主动选择的文件，普通下载由浏览器保存，不需要额外申请目录读写权限。在线版本与本地版本使用相同流程。

“自选文件夹”需要浏览器支持 File System Access API，例如桌面 Chrome / Edge。点击选择目录后，浏览器会请求所选目录的读写权限；保存时若存在同名文件，按钮会显示“替换保存”。目录句柄仅保留在当前页面会话中，刷新后需要重新选择。不支持该功能时，仍可使用“浏览器下载”。

目录选择需在 HTTPS 或本地开发地址下由用户点击触发，GitHub Pages 提供的 HTTPS 满足这一条件。无需在进入页面时预先申请文件权限。浏览器能力与授权机制见 [Chrome 官方说明](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)。

## 部署

仓库通过 GitHub Actions 将 `dist/` 发布到 GitHub Pages。首次部署时，在仓库 Settings → Pages 中将 Source 设为 GitHub Actions。

推送到 `main` 后，工作流会安装依赖、构建静态站点并发布；也可以在 Actions 页面手动运行部署。GitHub Pages 构建使用 `/color-generator/` 作为资源路径，本地开发仍使用 `/`。站点无需配置后端、数据库或密钥。

## 反馈与贡献

- 遇到颜色生成、编辑或文件读写问题，可以提交 [Issue](https://github.com/155TuT/color-generator/issues)。
- 反馈配色问题时，附上可复现的项目 JSON、操作步骤和期望结果，便于对照规则与分布。
- 修改代码后请运行 `npm run build`；涉及文件操作时，请同时确认导出文件能够再次导入编辑。

## License

本项目基于 [MIT License](LICENSE) 开源，Copyright (c) 2026 155TuT。

第三方依赖保留各自的许可与版权声明，详见[研究来源](docs/SOURCES.md#界面文档与许可)。
