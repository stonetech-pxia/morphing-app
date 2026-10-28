# 可变类别的文字分类复测

`cases.jsonl` 是 60 条人工编写的虚构中英法 OCR 文字：19 种文件形式各 3 条，另外 3 条无法识别；主题跨餐饮、购物、居住、工作、旅行、娱乐、教育、医疗、财务、政府和个人生活。形式与主题是两个可同时存在的维度，例如“餐饮订单”和“餐饮小票”。所有文字也被渲染为 `images/*.png`，保存为 `files/*.txt`，供原生 OCR 和文件读取路径复测。图片由 `render_cases.py` 生成；**以提交的图片为复测基准**，跨平台字体不保证像素一致。

这是小规模合成筛查，不是真实世界准确率。每种形式每种语言仅一例，部分主题本来可有不止一个合理答案；评分只按预置单一标准答案。`evaluate.py --noise` 以固定种子随机漏掉部分词/字符，是诊断扰动，不能代替 ML Kit/Vision 实际错误分布。图片文件名包含类别，喂模型时必须只传 OCR 文字，不得传文件名、路径或标准答案。空白 OCR 需单独检查能否拒判。

两类候选：零样本 NLI 模型对用户给的候选类别逐一判断；向量模型比较 OCR 与用户类别描述的相似度。它们**不能自主生成新类别名**，但可在不重训权重的情况下接受新的用户类别描述。`evaluate_qwen.py --mode free` 对已有 Qwen3.5 生成模型测试自主命名；这种输出需归一化、去重并经用户确认。评测所用候选名/描述在 `evaluate.py` 的 `KINDS`、`TOPICS`，可改成用户自定类别再测。模型原始结果、权重、虚拟环境均在忽略的 `../models/` 和 `../results/`；报告及交接说明不入 Git。

Jev 式决策模型另有 `evaluate_decision.py`（Laya 多语言）和 `evaluate_kev.py`（Kev 0.8B）。两者直接给每个候选类别打分，不能生成新类别；一次测“文件形式”，一次测“主题”。脚本对完全空白的 OCR 用代码拒判，其余不可读文本仍交给模型。`--unknown-option` 为两类候选都加入“无法判断”，用于测试非空乱码能否拒判及可判读文本被误拒判的比例。**不带此参数的原测试没有拒判选项，不能用它评价模型的拒判能力。**`--noise` 使用与上面相同的固定扰动。精确版本和许可证见 `decision_models.json`。Kev 的 `LocalPredictor` 在 Windows 需脚本里的 `fcntl` 导入兼容层；它不使用 Unix 文件锁功能。`label` 只为官方记录格式提供占位，Kev 的 `materialize` 不将其编码进模型输入。手机端兼容性、内存与延迟均未验证。

桌面复现参考（在各自隔离环境中执行）：

```bash
pip install laya==0.4.16
hf download convaiinnovations/laya-multilingual --revision 1720e3e3357cfe1e281542e223f8273b0890ca34 --local-dir tests/local-model-eval/models/cls-laya-multilingual
USE_TF=0 python tests/local-model-eval/classification/evaluate_decision.py --model laya-multilingual --short-criteria --unknown-option

git clone https://github.com/jaredpalmer/kev.git tests/local-model-eval/models/kev-runtime
cd tests/local-model-eval/models/kev-runtime
git checkout 2074cc44256200bb37540103fa4572901faa10f3
pip install -e .
cd -
HF_HOME=tests/local-model-eval/models/kev-hf-cache python tests/local-model-eval/classification/evaluate_kev.py --facet kind --unknown-option
HF_HOME=tests/local-model-eval/models/kev-hf-cache python tests/local-model-eval/classification/evaluate_kev.py --facet topic --unknown-option
```

两个脚本依赖 `evaluate.py` 的候选描述，故隔离环境还需安装本目录 `requirements.txt` 中的基础依赖。Kev 首次运行会下载其适配器和 Qwen3.5-0.8B-Base；应固定 `decision_models.json` 中的版本。原始模型文件、运行输出均被 Git 忽略。

建议在隔离 Python 环境安装本目录 `requirements.txt` 与上级 `requirements.txt`。从 `tests/local-model-eval/` 运行：

```bash
python classification/download.py qwen3-embedding
python classification/evaluate.py --model qwen3-embedding --facet kind
python classification/evaluate.py --model qwen3-embedding --facet topic --noise
python classification/download.py qwen3-embedding-q8
MORPH_LLAMA_SERVER_BIN=/absolute/path/to/llama-server \
python classification/evaluate_embedding_gguf.py --model q8
MORPH_LLAMA_SERVER_BIN=/absolute/path/to/llama-server \
python classification/evaluate_embedding_gguf.py --model q8 --noise
MORPH_LLAMA_SERVER_BIN=/absolute/path/to/llama-server \
MORPH_CLASSIFIER_GGUF=/absolute/path/to/Qwen3.5-2B-Q4_K_M.gguf \
python classification/evaluate_qwen.py --model qwen35-2b --mode fixed --backend cpu
```

向量/NLI 模型来源、revision、权重 SHA-256 在 `classification/models.json`；GGUF 来源与哈希在上级 `models.json`。`classification/download.py` 会下载指定 revision 并核对哈希，放入忽略的 `models/`。这些分类候选都只处理文字；Qwen3 Embedding 的原始 safetensors 约 1.19 GB，BGE-M3 原始权重约 2.27 GB，是否能量化并在手机预算内运行需要原生实测。桌面 GPU 的 GGUF 成绩不能代替手机 RAM、耗时或真实 OCR 成绩。

`evaluate_embedding_gguf.py` 使用 llama.cpp 的 `--embedding --pooling last`，对查询加与浮点版同一英文任务指令，并预计算候选类别向量。`--model q4` 使用第三方 Q4 包，`--model q8` 使用 Qwen 官方 Q8 包；两个版本都必须重新跑同一测试，不能把浮点版成绩直接套用。脚本启动和清理自己的本地服务，默认端口 8096；确保端口空闲。进程工作集采样和分类结果写入忽略的 `results/classification/`。这仍是桌面 CPU 结果，不代表手机原生表现。

## 任务 124：独立样本校准「无法判断」、对上用户的表和快捷操作

报告在 `CLASSIFY_124_REPORT.md`（本目录的上一级）。

- `holdout/cases.jsonl`：114 条新写的虚构 OCR 文字（中英法各 38），由没看过上面 60 条的人单独写成，不是改写。含没有标题的单据、同一商家的不同单据、范围外的文件（kind 为 `none`）、识别残缺的文字、空白和乱码。`split` 分校准集和测试集，同一 `group`（同一商家 / 版式）只在一边。
- `evaluate_holdout.py`：空白和乱码先由 App 的 `textReadability`（`packages/core/src/text-classify.ts`，经 `ts_features.ts` 调用同一份 TS 代码）拒判；其余用 Qwen3-Embedding GGUF 按维度打分，在校准集上定 `min_score` / `min_margin`，只在测试集上报正确、误分、拒判、误拒判，按语言和样本类型分开。
- `match/`：`profiles.json`（6 个虚构用户：表是 `CollectionSchema` 格式，快捷操作只有名字）、`presets.json`（`export_presets.ts` 从 `workflows/presets.ts` 导出的 4 个按内容的内设快捷操作）、`docs.jsonl`（90 份文件文字和每个用户可接受的推荐，空 = 不该推荐）。`evaluate_match.py --backend baseline` 不用模型（关键词 + `text-rules` 命中 + 文件类型），`--backend embedding` 用同一个 Embedding；阈值都在校准集上定。
- `calibrate.py`、`llama_embed.py`：两边共用的校准和 llama-server 管理。`test_calibrate.py` 是它们的单元测试，假向量只用来走通代码，不是成绩。

```bash
# 仓库根目录先 npm ci（ts_features.ts 要用 tsx）；再从 tests/local-model-eval/ 运行
python -m unittest discover -s classification -p "test_*.py"
python classification/evaluate_match.py --backend baseline
python classification/download.py qwen3-embedding-q8
MORPH_LLAMA_SERVER_BIN=/abs/llama-server python classification/evaluate_embedding_gguf.py --model q8   # 先复现 49/57、45/57
MORPH_LLAMA_SERVER_BIN=/abs/llama-server python classification/evaluate_holdout.py --model q8
MORPH_LLAMA_SERVER_BIN=/abs/llama-server python classification/evaluate_match.py --backend embedding --model q8
```

`evaluate.py` 的 `import torch` 挪进了只有 NLI 才用的函数里，GGUF 的脚本不再需要装 PyTorch；分类逻辑没变。
