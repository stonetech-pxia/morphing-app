import type { Check } from './checks';

/** 一个防倒退用例：pages/<suite>/NN-<id>.* 这一页转 Word 后要满足的断言。 */
export interface Case {
  /** 和来源文件名里的用例名一致（pages/<suite>/NN-<id>.html 等）。 */
  id: string;
  /** 放在哪一份 PDF 里（pdfs/<suite>.pdf）。 */
  suite: string;
  /** 守的是哪一次修复：提交号、D 编号。 */
  fix: string;
  /** 一句话：这一页考什么，以前错成什么样。 */
  what: string;
  /** 识别语言（ocr.toWord 的 lang 参数），默认 eng。 */
  lang?: string;
  /** App 语言，默认 en。 */
  locale?: string;
  checks: Check[];
  /** 通用的「字都在、不重复」检查的阈值（默认 0.97 / 0.02）。 */
  recall?: number;
  extra?: number;
  /** 现在已知会失败（等修）：写原因。修好后去掉，运行结果会提示。 */
  knownFailure?: string;
}
