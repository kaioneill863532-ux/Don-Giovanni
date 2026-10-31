# 网页灰盒 v0.1

整部游戏都能在浏览器里从头玩到尾：开场 → 第一幕 → 大黑影 → 第二幕 → 第三幕 → 结局。外观是灰盒，规则、时序、位置都按 `docs/design.md`。

## 怎么打开

双击 `index.html` 用 Chrome 或 Edge 打开即可，需要联网，因为 three.js 从 jsDelivr 加载。面具、图标、暗框都打包在 `assets.js` 里，不用起本地服务器。

| 操作 | 键位 |
|---|---|
| 走 | WASD |
| 看 | 鼠标（先点一下画面锁定鼠标），方向键也能转 |
| 面具栏 | Tab |
| 戴面具 | 1 唐璜 · 2 安娜 · 3 仆从，或者在面具栏里左键点 |
| 摘面具 | 右键 |
| 互动（第二幕指认） | E |
| 菜单 | Esc |
| 调试面板 | `（Esc 下面那个键）：跳到任意一段，导出 `layout.json` |

网址后面可以加参数：`?at=act1`（或 `opening`、`shadow`、`act2`、`act3`、`ending`）直接跳到那一段；`&fast` 让台词播得快一些。

## 文件

| 文件 | 是什么 |
|---|---|
| `index.html` | 灰盒本体（单个文件） |
| `assets.js` | 打包好的面具、图标、暗框（由 `tools/build_assets.py` 生成，不要手改） |
| `assets/` | 打包前的原文件：网页用的面具（已压缩）、图标、眼洞暗框 |
| `assets/ue/` | 给 UE 用的面具：没有压缩，真实尺寸，仆从面具的缩放已经烘进顶点 |
| `assets/silhouettes/` | 剪影贴图（白色人形、透明底）和大理石底色 |
| `data/layout.json` | 导出的布局：每件几何体在每张面具下的变换（three 和 UE 两套坐标）、记忆圈、大黑影碎片、第三幕的墙、颜色、时长 |
| `data/kit/` | 几何体库的单位网格，以及核对坐标轴用的 `DG_AxisMarker.glb` |
| `data/script.csv` | 全部台词，可以直接导成 UE 的 DataTable；`Draft = yes` 的是占位草稿 |
| `reference/` | 固定机位下的灰盒截图，机位数据在 `views.json`，用来和 UE 对照 |
| `tools/build_assets.py` | 重新打包 `assets.js` |
| `tools/make_vignettes.py` | 从面具渲染图生成眼洞暗框（只压画面边缘） |

## 改了灰盒以后

- 换了面具或暗框：放进 `assets/`，然后运行 `python prototype/tools/build_assets.py`。
- 动了几何体的位置：在灰盒里打开调试面板，点 "download layout.json"，覆盖 `data/layout.json`。

## 这一版和设计文档不同的地方

- 音乐是合成的 D 小调 3/4 拍，用来代替歌剧录音；脚步声、石头摩擦声、面具碰撞声也都是合成的。
- 剪影是程序画出来的，只是占位。
- 第三幕地上铺的是 3200 张低面数面具，不是真的面具模型。
