# 网页灰盒 v0.2

整部游戏都能在浏览器里从头玩到尾：开场 → 第一幕 → 阳台（大黑影）→ 第二幕 → 第三幕 → 结局。
场景设计见 [`docs/level-design.md`](../docs/level-design.md)，故事和台词见 [`docs/design.md`](../docs/design.md)。

## 怎么打开

双击 `index.html`，用 Chrome 或 Edge 打开即可。需要联网，因为 three.js 从 jsDelivr 加载。面具、图标和眼洞暗框都打包在 `assets.js` 里，不用起本地服务器。

| 操作 | 键位 |
|---|---|
| 走 / 跑 | WASD，按住 Shift 跑 |
| 看 | 鼠标（先点一下画面锁定鼠标），方向键也能转 |
| 下一句台词 | 点鼠标、空格或回车 |
| 面具栏 | Tab |
| 戴面具 | 1 唐璜 · 2 安娜 · 3 仆从，或在面具栏里左键点选 |
| 摘面具 | 右键 |
| 互动（第二幕指认） | E |
| 菜单 | Esc |
| 调试面板 | `（Esc 下面那个键）：跳到任意一段；导出 `layout.json`；"check overlaps" 检查所有场景状态有没有几何体重叠 |

网址后面可以加参数：
- `?at=act1`（或 `opening`、`shadow`、`act2`、`act3`、`ending`）：直接跳到那一段；
- `&fast`：台词播得快一些；
- `&low`：关掉阴影、减少雾，适合配置低的电脑。

## 代码结构

灰盒的源码在 `src/` 里，按系统分成几个文件。`index.html` 是用 `tools/build_greybox.py` 把它们拼起来生成的，**不要直接改 `index.html`**。

| 文件 | 内容 |
|---|---|
| `src/shell.html` | 页面外壳：CSS、字幕和面具栏等界面元素 |
| `src/01_base.js` | 设置、全部台词（`SCRIPT`）、小工具、时间调度、程序生成的贴图和剪影 |
| `src/02_reuse.js` | 从 v0.1 沿用的部分：剪影、输入、字幕和独白（含点击跳句）、合成声音、面具加载、UE 坐标换算 |
| `src/03_kit.js` | **几何体库**（Jarman 模型的 10 种形体、比例和档位）、材质、配色、追光池 |
| `src/04_stage.js` | **舞台机械**：几何体的站位、移动、互相避让和让玩家；螺旋路线；会合拢和让开的走廊；雾里散落的几何体；雾；可走范围 |
| `src/05_player.js` | 玩家（走、跑）、第一人称的手和戴面具动画、面具规则、机械运转的低频声 |
| `src/06_giant.js` | 中心的巨像：悬浮的零件、错位透视、组装、转头、俯身 |
| `src/07_acts.js` | 各场景：开场、第一幕、阳台、第二幕、第三幕和结局 |
| `src/08_main.js` | 世界的搭建、流程、重叠检查、`layout.json` 导出、平面图、调试面板 |

改完源码后：

```bash
python prototype/tools/build_greybox.py
```

## 文件

| 文件 | 是什么 |
|---|---|
| `index.html` | 灰盒本体（生成的单个文件） |
| `assets.js` | 打包好的面具、图标、暗框（由 `tools/build_assets.py` 生成） |
| `assets/` | 打包前的原文件：网页用的面具（已压缩）、图标、眼洞暗框、生成暗框用的眼洞剪影 |
| `assets/ue/` | 给 UE 用的面具：没有压缩，真实尺寸，仆从面具的缩放已经烘进顶点 |
| `assets/silhouettes/` | 剪影贴图（白色人形、透明底）和大理石底色 |
| `data/layout.json` | 导出的全部数据：几何体库、路线、每件几何体的所有站位（three.js 和 UE 两套坐标）、走廊的切换距离、各场景的关键点、巨像、配色、运动参数 |
| `data/kit/` | 10 种基础几何体的单位网格（轴心在底面中心）、剪影用的平面，以及核对坐标轴用的 `DG_AxisMarker.glb` |
| `data/script.csv` | 全部台词，可以直接导成 UE 的 DataTable；`Draft = yes` 的是占位草稿 |
| `tools/build_greybox.py` | 用 `src/` 生成 `index.html` |
| `tools/build_assets.py` | 重新打包 `assets.js` |
| `tools/make_vignettes.py` | 从眼洞剪影生成只压画面边缘的暗框 |

## 和最终游戏不同的地方

- 音乐是合成的 D 小调 3/4 拍，代替歌剧录音；脚步声、石头摩擦声、面具碰撞声、机械运转声也都是合成的。
- 剪影、手和第三幕地上的低面数面具都是程序生成的占位。
- 乌鸦是平面剪影；UE 里用飞鸟特效包。
