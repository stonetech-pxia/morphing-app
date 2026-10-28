# 本地模型评测夹具

此目录保存虚构的中、英、法文图片及模拟 OCR、字段 schema、标准答案和评测脚本。`data/` 有 477 例（159 份基础文档 × clean/normal/hard），可供 Claude Code 在模拟器或已获授权的真机上调用 Morph Vision，随后将真实 OCR 输出交给候选模型。图片本身不是模型的文字输入。测量结果、交接报告、模型权重和推理工具不入库。

## 数据与限制

- `data/<样本>/source.png`：手机 OCR 输入；`ocr.txt`：合成的模拟 OCR，仅供桌面基线。
- `meta.json`：语言、类别、难度；`schema.json`：待填字段；`truth.json`：期望值。
- 数据由 `scripts/generate_data.py` 固定种子产生，但跨平台字体会改变像素；**以提交的 PNG 为复测基准**。样本存在重复版式和直白类别提示，不能用其分类分数宣称真实照片准确率。
- 不把真实用户文件、识别文本或用户记录上传给云端 AI；原生测试结果放到仓库外的 side-session-notes。

## 桌面复跑

从本目录执行：

```bash
python -m pip install -r requirements.txt
python scripts/test_metrics.py
python scripts/download_models.py qwen35-08b
MORPH_LLAMA_SERVER_BIN=/absolute/path/to/llama-server python scripts/run_eval.py --model qwen35-08b --backend cpu --mode schema --prompt shared --category receipts --difficulty clean
python scripts/score.py --help
```

脚本只启动并停止自己创建的 `llama-server`；默认端口 8091，可用 `MORPH_EVAL_PORT` 修改。下载脚本按 `models.json` 的固定 revision 和 SHA-256 校验。`capture_env.py` 记录运行环境到忽略的 `results/`。`rules_baseline.mjs` 从仓库的 `packages/core/src/text-rules.ts` 导入规则；Node 需支持 TypeScript 类型剥离。

手机端测试要分别记录 OCR 准确率、分类/字段正确率、空值误填、峰值内存、耗时、取消与低内存恢复。Windows 工作集不能代替手机 RAM；模拟 OCR 分数不能代替真实 ML Kit / Vision 分数。后续细节见另行交付、不入 Git 的 Claude Code 交接文档。
