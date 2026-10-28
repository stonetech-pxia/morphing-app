# 可变类别的文字分类复测

`cases.jsonl` 是 60 条人工编写的虚构中英法 OCR 文字：19 种文件形式各 3 条，另外 3 条无法识别；主题跨餐饮、购物、居住、工作、旅行、娱乐、教育、医疗、财务、政府和个人生活。形式与主题是两个可同时存在的维度，例如“餐饮订单”和“餐饮小票”。所有文字也被渲染为 `images/*.png`，保存为 `files/*.txt`，供原生 OCR 和文件读取路径复测。图片由 `render_cases.py` 生成；**以提交的图片为复测基准**，跨平台字体不保证像素一致。

这是小规模合成筛查，不是真实世界准确率。每种形式每种语言仅一例，部分主题本来可有不止一个合理答案；评分只按预置单一标准答案。`evaluate.py --noise` 以固定种子随机漏掉部分词/字符，是诊断扰动，不能代替 ML Kit/Vision 实际错误分布。图片文件名包含类别，喂模型时必须只传 OCR 文字，不得传文件名、路径或标准答案。空白 OCR 需单独检查能否拒判。

两类候选：零样本 NLI 模型对用户给的候选类别逐一判断；向量模型比较 OCR 与用户类别描述的相似度。它们**不能自主生成新类别名**，但可在不重训权重的情况下接受新的用户类别描述。`evaluate_qwen.py --mode free` 对已有 Qwen3.5 生成模型测试自主命名；这种输出需归一化、去重并经用户确认。评测所用候选名/描述在 `evaluate.py` 的 `KINDS`、`TOPICS`，可改成用户自定类别再测。模型原始结果、权重、虚拟环境均在忽略的 `../models/` 和 `../results/`；报告及交接说明不入 Git。

建议在隔离 Python 环境安装本目录 `requirements.txt` 与上级 `requirements.txt`。从 `tests/local-model-eval/` 运行：

```bash
python classification/download.py qwen3-embedding
python classification/evaluate.py --model qwen3-embedding --facet kind
python classification/evaluate.py --model qwen3-embedding --facet topic --noise
MORPH_LLAMA_SERVER_BIN=/absolute/path/to/llama-server \
MORPH_CLASSIFIER_GGUF=/absolute/path/to/Qwen3.5-2B-Q4_K_M.gguf \
python classification/evaluate_qwen.py --model qwen35-2b --mode fixed --backend cpu
```

向量/NLI 模型来源、revision、权重 SHA-256 在 `classification/models.json`；GGUF 来源与哈希在上级 `models.json`。`classification/download.py` 会下载指定 revision 并核对哈希，放入忽略的 `models/`。NLI / E5 / MiniLM 都只处理文字；Qwen3 Embedding 的原始 safetensors 约 1.19 GB，是否能量化并在手机预算内运行需要原生实测。桌面 GPU 的 GGUF 成绩不能代替手机 RAM、耗时或真实 OCR 成绩。
