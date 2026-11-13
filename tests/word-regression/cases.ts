// 防倒退用例清单：每个套件（pdfs/<suite>.pdf）一个文件，在 cases/ 里。
// 每修一次转 Word 的问题，就在 pages/<suite>/ 加一页、在对应的文件里加一条（见 README.md）。
import type { Case } from './lib/case';
import { TEXT_FLOW } from './cases/text-flow';

export const CASES: Case[] = [...TEXT_FLOW];
