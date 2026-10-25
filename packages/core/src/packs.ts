// 扩展包清单（D-064，TOOLS_DESIGN §6）：大依赖按需下载，每个文件固定版本地址、大小和 SHA-256。
// 下载后逐个校验哈希，不一致就删除并报错。文件由 scratchpad 里的调研脚本生成并与 jsDelivr 的文件列表核对过。
// 换下载服务器时只改 url；换版本时必须同时改 version、size 和 sha256。

import type { Localized } from './schema';

export interface PackFile {
  /** 相对于 documentDirectory/packs/<id>/<version>/ 的路径。 */
  path: string;
  url: string;
  size: number;
  sha256: string;
}

export interface PackManifest {
  id: string;
  version: string;
  name: Localized;
  description: Localized;
  license: string;
  /** 依赖的其他扩展包（语言包依赖文字识别包）。 */
  requires?: readonly string[];
  files: readonly PackFile[];
}

const f = (path: string, url: string, size: number, sha256: string): PackFile => ({
  path,
  url,
  size,
  sha256,
});

export const PACKS: readonly PackManifest[] = [
  {
    id: 'scan',
    version: '1.4.3',
    name: { en: 'Document scanner', zh: '拉正照片', fr: 'Numérisation de documents' },
    description: {
      en: 'Finds the edges of paper in a photo and straightens it (OpenCV.js + jscanify).',
      zh: '在照片里找到纸张的边，并把它拉正（OpenCV.js + jscanify）。',
      fr: 'Trouve les bords d’une feuille de papier dans une photo et la redresse (OpenCV.js + jscanify).',
    },
    license: 'MIT (jscanify 1.4.3) + Apache-2.0 (OpenCV 4.7.0)',
    files: [
      f(
        'src/jscanify.js',
        'https://cdn.jsdelivr.net/npm/jscanify@1.4.3/src/jscanify.js',
        7585,
        'a09dadd36ad4103e693523677f1aba3740d06f2dcdeb3ed87c66022e6ac0d13d',
      ),
      f(
        'src/opencv.js',
        'https://cdn.jsdelivr.net/npm/jscanify@1.4.3/src/opencv.js',
        8980607,
        'd0e00ad06bb103acb0a3cba20d64c14367ab958bc6a5394b31aeec32610ef850',
      ),
      f(
        'LICENSE',
        'https://cdn.jsdelivr.net/npm/jscanify@1.4.3/LICENSE',
        1089,
        '5a4b4d2c8d93589a1f59d350d0b7fdde81e6d1892ed468eee9b4740d190d1939',
      ),
    ],
  },
  {
    id: 'ocr',
    version: '7.0.0',
    name: { en: 'Text recognition', zh: '文字识别', fr: 'Reconnaissance de texte' },
    description: {
      en: 'Reads printed text in photos (tesseract.js). Each language is a separate download.',
      zh: '识别照片里的印刷文字（tesseract.js）。每种语言单独下载。',
      fr: 'Lit le texte imprimé dans les photos (tesseract.js). Chaque langue se télécharge séparément.',
    },
    license: 'Apache-2.0 (tesseract.js 7.0.0, tesseract.js-core 7.0.0)',
    files: [
      f(
        'tesseract.min.js',
        'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js',
        62961,
        '000c27d9cd0def655f77b36c72a389c0ab13793aa31cb4d7aab56d09c0afbc7e',
      ),
      f(
        'worker.min.js',
        'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
        111307,
        '576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d',
      ),
      f(
        'core/tesseract-core-simd-lstm.wasm.js',
        'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core-simd-lstm.wasm.js',
        3899472,
        'c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38',
      ),
      f(
        'core/tesseract-core-lstm.wasm.js',
        'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core-lstm.wasm.js',
        3896484,
        'eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680',
      ),
      f(
        'LICENSE.md',
        'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/LICENSE.md',
        11357,
        'b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1',
      ),
      f(
        'core/LICENSE',
        'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/LICENSE',
        11358,
        'c6596eb7be8581c18be736c846fb9173b69eccf6ef94c5135893ec56bd92ba08',
      ),
    ],
  },
  {
    id: 'ocr-eng',
    version: '4.0.0',
    name: {
      en: 'Text recognition: English',
      zh: '文字识别：英文',
      fr: 'Reconnaissance de texte : anglais',
    },
    description: {
      en: 'English language model.',
      zh: '英文语言模型。',
      fr: 'Modèle de langue anglaise.',
    },
    license: 'Apache-2.0 (tessdata_best 4.0.0_best_int)',
    requires: ['ocr'],
    files: [
      f(
        'eng.traineddata.gz',
        'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz',
        2952873,
        '45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91',
      ),
    ],
  },
  {
    id: 'ocr-chi-sim',
    version: '4.0.0',
    name: {
      en: 'Text recognition: Chinese (Simplified)',
      zh: '文字识别：简体中文',
      fr: 'Reconnaissance de texte : chinois simplifié',
    },
    description: {
      en: 'Chinese (Simplified) language model.',
      zh: '简体中文语言模型。',
      fr: 'Modèle de langue chinois simplifié.',
    },
    license: 'Apache-2.0 (tessdata_best 4.0.0_best_int)',
    requires: ['ocr'],
    files: [
      f(
        'chi_sim.traineddata.gz',
        'https://cdn.jsdelivr.net/npm/@tesseract.js-data/chi_sim@1.0.0/4.0.0_best_int/chi_sim.traineddata.gz',
        1718768,
        'b8a23f10c7de500891eb458a8adc9cc58ab7f242f08b7d149f5e9aea4ad5db7c',
      ),
    ],
  },
  {
    id: 'ocr-chi-tra',
    version: '4.0.0',
    name: {
      en: 'Text recognition: Chinese (Traditional)',
      zh: '文字识别：繁体中文',
      fr: 'Reconnaissance de texte : chinois traditionnel',
    },
    description: {
      en: 'Chinese (Traditional) language model.',
      zh: '繁体中文语言模型。',
      fr: 'Modèle de langue chinois traditionnel.',
    },
    license: 'Apache-2.0 (tessdata_best 4.0.0_best_int)',
    requires: ['ocr'],
    files: [
      f(
        'chi_tra.traineddata.gz',
        'https://cdn.jsdelivr.net/npm/@tesseract.js-data/chi_tra@1.0.0/4.0.0_best_int/chi_tra.traineddata.gz',
        1656239,
        '11fe2610dab05d8a880d02f193ce70203f4c4bbe061b987d5529a2c038a22743',
      ),
    ],
  },
  {
    id: 'ocr-jpn',
    version: '4.0.0',
    name: {
      en: 'Text recognition: Japanese',
      zh: '文字识别：日文',
      fr: 'Reconnaissance de texte : japonais',
    },
    description: {
      en: 'Japanese language model.',
      zh: '日文语言模型。',
      fr: 'Modèle de langue japonaise.',
    },
    license: 'Apache-2.0 (tessdata_best 4.0.0_best_int)',
    requires: ['ocr'],
    files: [
      f(
        'jpn.traineddata.gz',
        'https://cdn.jsdelivr.net/npm/@tesseract.js-data/jpn@1.0.0/4.0.0_best_int/jpn.traineddata.gz',
        2030256,
        '2b63ebfbf1484de4a08ce53b29ef98a1c17658a93cbd38acb665d7d316d0be88',
      ),
    ],
  },
  {
    id: 'ocr-kor',
    version: '4.0.0',
    name: {
      en: 'Text recognition: Korean',
      zh: '文字识别：韩文',
      fr: 'Reconnaissance de texte : coréen',
    },
    description: {
      en: 'Korean language model.',
      zh: '韩文语言模型。',
      fr: 'Modèle de langue coréenne.',
    },
    license: 'Apache-2.0 (tessdata_best 4.0.0_best_int)',
    requires: ['ocr'],
    files: [
      f(
        'kor.traineddata.gz',
        'https://cdn.jsdelivr.net/npm/@tesseract.js-data/kor@1.0.0/4.0.0_best_int/kor.traineddata.gz',
        1572336,
        '78c21276ab14c9bb734d83be1055d9fe5469a4e7e977c51ad385be5737e61126',
      ),
    ],
  },
  {
    id: 'ocr-fra',
    version: '4.0.0',
    name: {
      en: 'Text recognition: French',
      zh: '文字识别：法文',
      fr: 'Reconnaissance de texte : français',
    },
    description: {
      en: 'French language model.',
      zh: '法文语言模型。',
      fr: 'Modèle de langue française.',
    },
    license: 'Apache-2.0 (tessdata_best 4.0.0_best_int)',
    requires: ['ocr'],
    files: [
      f(
        'fra.traineddata.gz',
        'https://cdn.jsdelivr.net/npm/@tesseract.js-data/fra@1.0.0/4.0.0_best_int/fra.traineddata.gz',
        707406,
        'd611139672b3752c7097e671e4a1d9209dfd37f2aeb081ef6487fba3351e9255',
      ),
    ],
  },
  {
    id: 'ocr-deu',
    version: '4.0.0',
    name: {
      en: 'Text recognition: German',
      zh: '文字识别：德文',
      fr: 'Reconnaissance de texte : allemand',
    },
    description: {
      en: 'German language model.',
      zh: '德文语言模型。',
      fr: 'Modèle de langue allemande.',
    },
    license: 'Apache-2.0 (tessdata_best 4.0.0_best_int)',
    requires: ['ocr'],
    files: [
      f(
        'deu.traineddata.gz',
        'https://cdn.jsdelivr.net/npm/@tesseract.js-data/deu@1.0.0/4.0.0_best_int/deu.traineddata.gz',
        1333102,
        '306c4280d0cbed46fbff727486bd43b92730181bae80f56941a091f363bdf28b',
      ),
    ],
  },
  {
    id: 'ocr-spa',
    version: '4.0.0',
    name: {
      en: 'Text recognition: Spanish',
      zh: '文字识别：西班牙文',
      fr: 'Reconnaissance de texte : espagnol',
    },
    description: {
      en: 'Spanish language model.',
      zh: '西班牙文语言模型。',
      fr: 'Modèle de langue espagnole.',
    },
    license: 'Apache-2.0 (tessdata_best 4.0.0_best_int)',
    requires: ['ocr'],
    files: [
      f(
        'spa.traineddata.gz',
        'https://cdn.jsdelivr.net/npm/@tesseract.js-data/spa@1.0.0/4.0.0_best_int/spa.traineddata.gz',
        2100190,
        '40be52f97b5d4eb7460073dc1f94cd546b27150333c0bf854ed7e7132db6bceb',
      ),
    ],
  },
  {
    id: 'ocr-por',
    version: '4.0.0',
    name: {
      en: 'Text recognition: Portuguese',
      zh: '文字识别：葡萄牙文',
      fr: 'Reconnaissance de texte : portugais',
    },
    description: {
      en: 'Portuguese language model.',
      zh: '葡萄牙文语言模型。',
      fr: 'Modèle de langue portugaise.',
    },
    license: 'Apache-2.0 (tessdata_best 4.0.0_best_int)',
    requires: ['ocr'],
    files: [
      f(
        'por.traineddata.gz',
        'https://cdn.jsdelivr.net/npm/@tesseract.js-data/por@1.0.0/4.0.0_best_int/por.traineddata.gz',
        1392239,
        'dacebc1386ddaaf8389f81094236cca0d690897cde693d48cbdaa881c86e2b4c',
      ),
    ],
  },
  {
    id: 'ocr-ita',
    version: '4.0.0',
    name: {
      en: 'Text recognition: Italian',
      zh: '文字识别：意大利文',
      fr: 'Reconnaissance de texte : italien',
    },
    description: {
      en: 'Italian language model.',
      zh: '意大利文语言模型。',
      fr: 'Modèle de langue italienne.',
    },
    license: 'Apache-2.0 (tessdata_best 4.0.0_best_int)',
    requires: ['ocr'],
    files: [
      f(
        'ita.traineddata.gz',
        'https://cdn.jsdelivr.net/npm/@tesseract.js-data/ita@1.0.0/4.0.0_best_int/ita.traineddata.gz',
        1660998,
        'f702fcfad297ce028ede3626d1467b67939f23ff23595f9badd54681cf25a4d3',
      ),
    ],
  },
  {
    id: 'ocr-rus',
    version: '4.0.0',
    name: {
      en: 'Text recognition: Russian',
      zh: '文字识别：俄文',
      fr: 'Reconnaissance de texte : russe',
    },
    description: {
      en: 'Russian language model.',
      zh: '俄文语言模型。',
      fr: 'Modèle de langue russe.',
    },
    license: 'Apache-2.0 (tessdata_best 4.0.0_best_int)',
    requires: ['ocr'],
    files: [
      f(
        'rus.traineddata.gz',
        'https://cdn.jsdelivr.net/npm/@tesseract.js-data/rus@1.0.0/4.0.0_best_int/rus.traineddata.gz',
        2679598,
        'f51f5edc992249ff9b70a227b22f242dfa47b2b1bbc7ae0ea74908640c101f6a',
      ),
    ],
  },
  {
    id: 'ocr-vie',
    version: '4.0.0',
    name: {
      en: 'Text recognition: Vietnamese',
      zh: '文字识别：越南文',
      fr: 'Reconnaissance de texte : vietnamien',
    },
    description: {
      en: 'Vietnamese language model.',
      zh: '越南文语言模型。',
      fr: 'Modèle de langue vietnamienne.',
    },
    license: 'Apache-2.0 (tessdata_best 4.0.0_best_int)',
    requires: ['ocr'],
    files: [
      f(
        'vie.traineddata.gz',
        'https://cdn.jsdelivr.net/npm/@tesseract.js-data/vie@1.0.0/4.0.0_best_int/vie.traineddata.gz',
        1423003,
        '2284f610f262a1b19ec8df9f196b9ff6ce38ddb4a66329e998941df4b8961c8d',
      ),
    ],
  },
  {
    id: 'pdfview',
    version: '6.4.299',
    name: { en: 'PDF preview', zh: 'PDF 预览', fr: 'Aperçu PDF' },
    description: {
      en: 'Shows PDF pages as pictures (thumbnails, PDF to images, placing a signature) and reads text from PDFs (pdf.js).',
      zh: '把 PDF 页面显示成图片（缩略图、PDF 转图片、放签名）并读出 PDF 里的文字（pdf.js）。',
      fr: 'Affiche les pages PDF sous forme d’images (vignettes, conversion PDF en images, ajout d’une signature) et lit le texte des PDF (pdf.js).',
    },
    license: 'Apache-2.0 (pdf.js 6.4.299); cmaps, fonts and decoders BSD',
    files: [
      f(
        'legacy/build/pdf.min.mjs',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/legacy/build/pdf.min.mjs',
        523774,
        'bccc24ea711db8e44503629519904a5292d73b9daaa214bbe7cdcc282b0f4259',
      ),
      f(
        'legacy/build/pdf.worker.min.mjs',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/legacy/build/pdf.worker.min.mjs',
        1321307,
        '145d2dd3ab0c86151011dba95acfa2d5336e2accd59388ea43dbee0efddaaec6',
      ),
      f(
        'LICENSE',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/LICENSE',
        10174,
        '0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594',
      ),
      f(
        'cmaps/78-EUC-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/78-EUC-H.bcmap',
        2404,
        'd92a261336dc18b8c03a46eb4d462382d33f4338fa195d303256b2031434c874',
      ),
      f(
        'cmaps/78-EUC-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/78-EUC-V.bcmap',
        173,
        '61670bebc4e4827b67230c054fd0d820d6e30c3584d02e386804e62bbedc032a',
      ),
      f(
        'cmaps/78-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/78-H.bcmap',
        2379,
        'ece6415b853d61e1b2560165151407d35cf16e6556932b85a13ea75276b77402',
      ),
      f(
        'cmaps/78-RKSJ-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/78-RKSJ-H.bcmap',
        2398,
        '696b1f973c97623496703809eaaa5f9b40696c77540057413f4b826a08edfa7b',
      ),
      f(
        'cmaps/78-RKSJ-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/78-RKSJ-V.bcmap',
        173,
        '53cb6d560ab377da48cf65d6dcacb0bdb31f13fab7066c580de38c12a73a7ff9',
      ),
      f(
        'cmaps/78-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/78-V.bcmap',
        169,
        '289000f02fd34872b6975503217f33abae6bee676e7d28f640473a67c8db1712',
      ),
      f(
        'cmaps/78ms-RKSJ-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/78ms-RKSJ-H.bcmap',
        2651,
        'a2442595218f5f8bd8e1b42188e368587d876cfe0cc4cd87196f077c878f72e2',
      ),
      f(
        'cmaps/78ms-RKSJ-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/78ms-RKSJ-V.bcmap',
        290,
        'f8ddceba96bfd9d3740bd1789ee30d1f47c78371520a8084f71f7df58f19be0b',
      ),
      f(
        'cmaps/83pv-RKSJ-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/83pv-RKSJ-H.bcmap',
        905,
        '44040051ec818fe09b9703472bea72efd2759d5eeb5ff0d77c718d6bb5e6d1df',
      ),
      f(
        'cmaps/90ms-RKSJ-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/90ms-RKSJ-H.bcmap',
        721,
        'c13e043e85ff715b75bb03801e8fd0fb8f3a75e4a48496faa6baaf92b5b48ba1',
      ),
      f(
        'cmaps/90ms-RKSJ-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/90ms-RKSJ-V.bcmap',
        290,
        '499bb916ce1adbe4289b6e5811f4dc20eb238cdc2ffad20cf26ae56716885bab',
      ),
      f(
        'cmaps/90msp-RKSJ-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/90msp-RKSJ-H.bcmap',
        715,
        '7b8b3b8bbf821702e9a4df9f3596ce292380c8c1b0925dedadbb4e4b2d80498b',
      ),
      f(
        'cmaps/90msp-RKSJ-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/90msp-RKSJ-V.bcmap',
        291,
        '6296c2b5c07dca8128e96d5296d621a3268803d4fa0e5812a21e52fe2802aacb',
      ),
      f(
        'cmaps/90pv-RKSJ-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/90pv-RKSJ-H.bcmap',
        982,
        'fb5103f03d3a34547e18d316e52b6d9b26e485c662999222f84d2ba54c2e4fa8',
      ),
      f(
        'cmaps/90pv-RKSJ-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/90pv-RKSJ-V.bcmap',
        260,
        '7bcb5ad2ba55b9662ce379e16c2d9cc2b82d621a579807353741172e4af615c2',
      ),
      f(
        'cmaps/Add-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Add-H.bcmap',
        2419,
        'a2ffab28b990998181bcca9b0e914bb2207820f100ae31d5c469444892e5ad8e',
      ),
      f(
        'cmaps/Add-RKSJ-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Add-RKSJ-H.bcmap',
        2413,
        'b29f4b52e2465d0485856d5e69f1ba69927deb2848d8fd328c8035583b35bb7e',
      ),
      f(
        'cmaps/Add-RKSJ-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Add-RKSJ-V.bcmap',
        287,
        '2aa2232c283a3f5d0997c2834a36cead0b79ce2657944cfeed08140c293460ff',
      ),
      f(
        'cmaps/Add-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Add-V.bcmap',
        282,
        '25125d3b1be64e86b2df5b3344170b45a42bcaa0b46e43a34314ef73c166e542',
      ),
      f(
        'cmaps/Adobe-CNS1-0.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-CNS1-0.bcmap',
        317,
        '8c65be9d51a9f269a547dc12460707aaf4031ab67ebe8a2900f4b4cc6b3e450e',
      ),
      f(
        'cmaps/Adobe-CNS1-1.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-CNS1-1.bcmap',
        371,
        '73152bc1a59cc594b414ac6068be48e5512b96ae85920c40e32a99269fdb0c04',
      ),
      f(
        'cmaps/Adobe-CNS1-2.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-CNS1-2.bcmap',
        376,
        'a1b8d353bdef9584c820464e8f1c9e2013d64ebf433cba0aa831dddf515818c2',
      ),
      f(
        'cmaps/Adobe-CNS1-3.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-CNS1-3.bcmap',
        401,
        '2ffc0c75c79fafde506163d3c08c390d183251009f3fbf6ae50d1167d14b9570',
      ),
      f(
        'cmaps/Adobe-CNS1-4.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-CNS1-4.bcmap',
        405,
        '98a1f470c878c6b9691a4d7aef776af8ac9b55f5587c9fafa00547f3bf655716',
      ),
      f(
        'cmaps/Adobe-CNS1-5.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-CNS1-5.bcmap',
        406,
        'ddd6e29955eb8cb545f2ebd09c628c3bbda5023256eda1b728f743c75fb77829',
      ),
      f(
        'cmaps/Adobe-CNS1-6.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-CNS1-6.bcmap',
        406,
        '317bb2db71e0e5b7b0c47b75de1da915c2e22f65f0c0861507f9ca7ba238f8a2',
      ),
      f(
        'cmaps/Adobe-CNS1-UCS2.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-CNS1-UCS2.bcmap',
        41193,
        'e665837f2197c6bd08cd8955ad4d6932cee2398e2e328b25b00e6bfb3bd72af9',
      ),
      f(
        'cmaps/Adobe-GB1-0.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-GB1-0.bcmap',
        217,
        '8b81cce8a11d510e505704953cfa4e4ab080c1a0cab991145a3512ee433946b9',
      ),
      f(
        'cmaps/Adobe-GB1-1.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-GB1-1.bcmap',
        250,
        '0426983081788ec7202703e71f1efa4b860f75b936994236010b39d89251a81e',
      ),
      f(
        'cmaps/Adobe-GB1-2.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-GB1-2.bcmap',
        465,
        'e67b37a83b160ab3831306a71a605893b24454ee81ac9b6123bf2d3984d268d5',
      ),
      f(
        'cmaps/Adobe-GB1-3.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-GB1-3.bcmap',
        470,
        'aa299afc3e12a28726147305f191be28c7498078c8b182ece7886ac79cd99078',
      ),
      f(
        'cmaps/Adobe-GB1-4.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-GB1-4.bcmap',
        601,
        '8fbd7d74c2ddb1350c1cecce54a73fde3f5453093d4bed445283ec0033d2097f',
      ),
      f(
        'cmaps/Adobe-GB1-5.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-GB1-5.bcmap',
        625,
        'c22cb2fcff24112fa31dab2111bdc51957006576d31aad5a25e67793ac01428c',
      ),
      f(
        'cmaps/Adobe-GB1-UCS2.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-GB1-UCS2.bcmap',
        33974,
        '20507620260c0c935c35afc1e70e5888aa7125d5ec7ffc03cef1959feb2c1641',
      ),
      f(
        'cmaps/Adobe-Japan1-0.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-Japan1-0.bcmap',
        225,
        '464f08905236f5703b1f5cf8358767c8b18e6bcc808840d081f1de2c7ab38134',
      ),
      f(
        'cmaps/Adobe-Japan1-1.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-Japan1-1.bcmap',
        226,
        '4c823848722187d1ffe75ae3f5f9126ccd2d7895a05fad14c919fb119e037008',
      ),
      f(
        'cmaps/Adobe-Japan1-2.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-Japan1-2.bcmap',
        233,
        '7810fb808e367e70429e90a9478fe6a3fdc3e214f25c7582ce9c2da6a242315c',
      ),
      f(
        'cmaps/Adobe-Japan1-3.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-Japan1-3.bcmap',
        242,
        '84deb1828711ad3d390c9899c38abce1bf619d65ff7bf1a326ec95acc45f08f8',
      ),
      f(
        'cmaps/Adobe-Japan1-4.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-Japan1-4.bcmap',
        337,
        '3f8a4f974919c2b8bae5d10175ffa2673be140481e00840542c85d48ef184067',
      ),
      f(
        'cmaps/Adobe-Japan1-5.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-Japan1-5.bcmap',
        430,
        '1d3ce4ff28d977f8cf37a912ae4ec811f4175c3167b1ec0b2567feec3e79e1db',
      ),
      f(
        'cmaps/Adobe-Japan1-6.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-Japan1-6.bcmap',
        485,
        '5609797b9401b30be72ef9645da62a87829f058c3be4b5c623383119f584b1d9',
      ),
      f(
        'cmaps/Adobe-Japan1-UCS2.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-Japan1-UCS2.bcmap',
        40951,
        '66c5d0dc4964f4093e77b194023f3a0f689324028ec8330e1e1d0570bcba7c2f',
      ),
      f(
        'cmaps/Adobe-Korea1-0.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-Korea1-0.bcmap',
        241,
        'dfb8c3874f0e5a8c3acf597d2c12d2b63e90bc5e4f0fce990ec4c56077d80b32',
      ),
      f(
        'cmaps/Adobe-Korea1-1.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-Korea1-1.bcmap',
        386,
        '62f277b7b1c441c007797ae707d5c37258d029ce4661a2b911e2e1ee35e6adc1',
      ),
      f(
        'cmaps/Adobe-Korea1-2.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-Korea1-2.bcmap',
        391,
        '1d77068af462f96d7ad28ad7e7d43eef6423c685b479d7dc25ff5df38db0380d',
      ),
      f(
        'cmaps/Adobe-Korea1-UCS2.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Adobe-Korea1-UCS2.bcmap',
        23293,
        '857b723088be97255053562bfa41bd1075a7f7910d3bab59a0645c8bbc7060ff',
      ),
      f(
        'cmaps/B5-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/B5-H.bcmap',
        1086,
        '718ad0ffbef4c34f8f3f31292c462e519cd567a5511fc8b346c60010d64f4ef9',
      ),
      f(
        'cmaps/B5-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/B5-V.bcmap',
        142,
        'b5c37383517477620ced927b6b4ffd4f4cc6230d8051b5b46a21d6768e07f7d8',
      ),
      f(
        'cmaps/B5pc-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/B5pc-H.bcmap',
        1099,
        'bab6028aead1d6149400e904ab10cfd319082d826473ed4c582c8eeed920f17e',
      ),
      f(
        'cmaps/B5pc-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/B5pc-V.bcmap',
        144,
        '41543142b9767f3b76133899fc8453282b01ad3c653acaeea42d78c5a7d08c63',
      ),
      f(
        'cmaps/CNS-EUC-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/CNS-EUC-H.bcmap',
        1780,
        'e8f89cd61e6486b948205da46499d659ed0aed949b7095fd3c8e95ffe2b0e7a9',
      ),
      f(
        'cmaps/CNS-EUC-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/CNS-EUC-V.bcmap',
        1920,
        'cae422bec2ac6dbe86bf921cec942bacd2d0b733ffcca5f91b3ba14e917025a0',
      ),
      f(
        'cmaps/CNS1-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/CNS1-H.bcmap',
        706,
        'e8487971ab20cd16f3de3e8ac56ec994b72b658ad113f2818239dfd5108f501a',
      ),
      f(
        'cmaps/CNS1-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/CNS1-V.bcmap',
        143,
        '42df8076aaa7574505e7304af83a3323ec032c4177d64b1309db8c043d594a8a',
      ),
      f(
        'cmaps/CNS2-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/CNS2-H.bcmap',
        504,
        'bc6024d274d440f0625c69e25f37036ef6cb6689432ceaa160d3432a2a716ca7',
      ),
      f(
        'cmaps/CNS2-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/CNS2-V.bcmap',
        93,
        '2e4f70a8afd23a121030fc2e5b5f3816e903b11e7ba8b8c09654b31c80399c38',
      ),
      f(
        'cmaps/ETen-B5-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/ETen-B5-H.bcmap',
        1125,
        '87ee6b3f5bfda5fe26fa35431264c7d73070d10dbbf398a75185d63ae322c18d',
      ),
      f(
        'cmaps/ETen-B5-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/ETen-B5-V.bcmap',
        158,
        '47dc0d2c21e3bde317947aec1675ceabc1d5460a60bf9c24334b8c407a17172c',
      ),
      f(
        'cmaps/ETenms-B5-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/ETenms-B5-H.bcmap',
        101,
        'd5f5a73da4173b7da9a3a20e16f26f9cd5d12deb1553409919e0cec6fd37fdee',
      ),
      f(
        'cmaps/ETenms-B5-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/ETenms-B5-V.bcmap',
        172,
        '18252fca90f472f479af1bddd60d6ab51c8e1b55dcf6845951426504934543e0',
      ),
      f(
        'cmaps/ETHK-B5-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/ETHK-B5-H.bcmap',
        4426,
        'd2f10fa519336bc4efcc7b6deb9604b75429946b40d82e311cb3a97a1994c89a',
      ),
      f(
        'cmaps/ETHK-B5-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/ETHK-B5-V.bcmap',
        158,
        '1fea3fd0d9f0f679f80505800851ef2e4131d81127e18c006938ffa2f4c8b247',
      ),
      f(
        'cmaps/EUC-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/EUC-H.bcmap',
        578,
        'f9939cd57fccdc65c5d9f4c205fd497ebdbd283643308da5663801a8c1d9c595',
      ),
      f(
        'cmaps/EUC-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/EUC-V.bcmap',
        170,
        '1283a50a706507c4436da83ede9ad7a4440be25378f2e96f6c81a430081426a3',
      ),
      f(
        'cmaps/Ext-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Ext-H.bcmap',
        2536,
        '4000ed4e61a1c668ef453bbd0603cfa383defa793abd46a57ed870d7f527350b',
      ),
      f(
        'cmaps/Ext-RKSJ-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Ext-RKSJ-H.bcmap',
        2542,
        'e0d2f0df337660e73813238dd4a725f11f0621b90f3273857db253d0e7694caa',
      ),
      f(
        'cmaps/Ext-RKSJ-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Ext-RKSJ-V.bcmap',
        218,
        'f617a22b6d67febb187990952006c91a9f5a4db21155d268c656252d0c21985d',
      ),
      f(
        'cmaps/Ext-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Ext-V.bcmap',
        215,
        'c2087fb845a9e3acea0c2922cd40e6af67e11957bec74dcd597f1285edd490ce',
      ),
      f(
        'cmaps/GB-EUC-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/GB-EUC-H.bcmap',
        549,
        '928bad06fd84a48f5ba7150d7716609119fb660f2aaa73eccad81ddab9b9d203',
      ),
      f(
        'cmaps/GB-EUC-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/GB-EUC-V.bcmap',
        179,
        'a9ad88ac2479da529b16dc48abc5952332e27bc355335f91df5729a587533324',
      ),
      f(
        'cmaps/GB-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/GB-H.bcmap',
        528,
        '1018c777a8910b5bb46d7d54a4aee9d51ca5cff8addb2b41c969d9101cb3fd1c',
      ),
      f(
        'cmaps/GB-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/GB-V.bcmap',
        175,
        '0b96789143c0bbf9f1641ae7165b3456dccd14dabffcbb0bd654d5bf6f94f863',
      ),
      f(
        'cmaps/GBK-EUC-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/GBK-EUC-H.bcmap',
        14692,
        '2103fed28650ede096a2281104a1a8a4304dae0db414342c636867522307123b',
      ),
      f(
        'cmaps/GBK-EUC-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/GBK-EUC-V.bcmap',
        180,
        'a7fd35dd14d9dbdb955f34e6c0630618b6620dfd09d4283b2f65a65ce77fcaea',
      ),
      f(
        'cmaps/GBK2K-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/GBK2K-H.bcmap',
        19662,
        '3d919ae72af16c5cc6846ec87a4326a9f125e493c59d3628429d35c2c95fe8c4',
      ),
      f(
        'cmaps/GBK2K-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/GBK2K-V.bcmap',
        219,
        'b927fdfd595c07ce9158bf2ec13f4641b2e83b01c70989dadfabd6ed7c6ac2dc',
      ),
      f(
        'cmaps/GBKp-EUC-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/GBKp-EUC-H.bcmap',
        14686,
        'd15ebd8e81fb4fe8a244f1b1e877922e03500ac69eddf5001093e502430451d2',
      ),
      f(
        'cmaps/GBKp-EUC-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/GBKp-EUC-V.bcmap',
        181,
        'fdc736d46e642625dccc8ad8c59f2c69fc7db7a13f2e799c6c6b779e707bb97a',
      ),
      f(
        'cmaps/GBpc-EUC-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/GBpc-EUC-H.bcmap',
        557,
        '3c4a4eb82f05abe51f6650985c630e180438bfdd491318f5d20d2ec29236e1c3',
      ),
      f(
        'cmaps/GBpc-EUC-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/GBpc-EUC-V.bcmap',
        181,
        '215bdfa2842705624b4cf4cd29b8e3c720f1e192365e0305c11030a424c84d7c',
      ),
      f(
        'cmaps/GBT-EUC-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/GBT-EUC-H.bcmap',
        7290,
        'dc5f44e48a39f3367ae28665027d8ab1d8cedb5a9dcc5068a900acd6709f60f9',
      ),
      f(
        'cmaps/GBT-EUC-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/GBT-EUC-V.bcmap',
        180,
        'a1ad24e63653b8aa388c18fa5e498f007564e43dde699a9f91ccb4645c999be8',
      ),
      f(
        'cmaps/GBT-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/GBT-H.bcmap',
        7269,
        '8afda745a505763f3ff54c8126eeb48ef376ea9ed07d9f42ff9a22c5c547ec57',
      ),
      f(
        'cmaps/GBT-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/GBT-V.bcmap',
        176,
        'cdc2ec5c3c7c7033290c9a8894878202f08674eb9b1ae7d36218430326768771',
      ),
      f(
        'cmaps/GBTpc-EUC-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/GBTpc-EUC-H.bcmap',
        7298,
        '7b23e2f7bfdb6c918f567b7324bf858f398bd8cd5f268d74ece19a3c91bf4f32',
      ),
      f(
        'cmaps/GBTpc-EUC-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/GBTpc-EUC-V.bcmap',
        182,
        'd7a1b13ead9ab511cf2cd01de6ce8b02aa8e8767e84895337d7a3b67f039f93b',
      ),
      f(
        'cmaps/H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/H.bcmap',
        553,
        'a0233e21047ec00b852125b243cbcf30abee511155b6d8159c24f944384bc9ee',
      ),
      f(
        'cmaps/Hankaku.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Hankaku.bcmap',
        132,
        'b454701f7aecd7856769016dfd04ca64280a060f2c67a2466d50b4395d24974e',
      ),
      f(
        'cmaps/Hiragana.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Hiragana.bcmap',
        124,
        '2ed669394756dd9458651cd9995ab29ab691ecb7686659003306cdf22767a414',
      ),
      f(
        'cmaps/HKdla-B5-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/HKdla-B5-H.bcmap',
        2654,
        '5242bce18fb13ab4cc59b146a03eba36e4ce42667eeff09e10981a9d2aa4996b',
      ),
      f(
        'cmaps/HKdla-B5-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/HKdla-B5-V.bcmap',
        148,
        '2e0537f786c0791d41a925f72bad2d4e7268aa6cbf15a1400a722672cec38e2c',
      ),
      f(
        'cmaps/HKdlb-B5-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/HKdlb-B5-H.bcmap',
        2414,
        'fdc8159984bf5dbe475c0d5dfcb621ecee4dea07c38c668bd77f4c679e23b9b3',
      ),
      f(
        'cmaps/HKdlb-B5-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/HKdlb-B5-V.bcmap',
        148,
        'b249eb9dcb915ab45057c5d4d7aa55ef88d0efbb092af6bae0b2d4705d139abf',
      ),
      f(
        'cmaps/HKgccs-B5-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/HKgccs-B5-H.bcmap',
        2292,
        'ab64c7fc5e9b2e97750cc4f269b0da14fd8649e49151b7598c8df86599bac591',
      ),
      f(
        'cmaps/HKgccs-B5-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/HKgccs-B5-V.bcmap',
        149,
        '02ebdf7cdffb5395fb21091cd58a013a18ae5388922822f9dc6292ef16b98956',
      ),
      f(
        'cmaps/HKm314-B5-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/HKm314-B5-H.bcmap',
        1772,
        'bfd8bbde6b36a9da4c1c902c74121a30d9807a7079a00eeea218be6adc223cef',
      ),
      f(
        'cmaps/HKm314-B5-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/HKm314-B5-V.bcmap',
        149,
        '2a64a815cfb6fdd480674a868762e3d161fda17543b20c9209978559f0667164',
      ),
      f(
        'cmaps/HKm471-B5-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/HKm471-B5-H.bcmap',
        2171,
        '49d7c037758826b5b6c0fa329c35bbf25d3943197754e72ecd30c6fb04d745e6',
      ),
      f(
        'cmaps/HKm471-B5-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/HKm471-B5-V.bcmap',
        149,
        'be24c109e78aa4fe3c1f27d30aab3ed0741e783fa1b6b6c2719741072b54b132',
      ),
      f(
        'cmaps/HKscs-B5-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/HKscs-B5-H.bcmap',
        4437,
        '08599378f41d96b40537adef6e6edcc4a787bc63f5accf47c026df4905a13914',
      ),
      f(
        'cmaps/HKscs-B5-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/HKscs-B5-V.bcmap',
        159,
        'd073542b7dad1c4cbf01c1af5f0cd13218d1281a491956e310c55702fc8705c4',
      ),
      f(
        'cmaps/Katakana.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Katakana.bcmap',
        100,
        '3b6ca6642fbf8822da00d5e58a8aa275216d5c32dbf2bd73e934197fc9fc5c53',
      ),
      f(
        'cmaps/KSC-EUC-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/KSC-EUC-H.bcmap',
        1848,
        '6784e16dbc5861c036c23d3e55f0d4ba0975a3e464da0ee8e49bcfff0be070c4',
      ),
      f(
        'cmaps/KSC-EUC-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/KSC-EUC-V.bcmap',
        164,
        'fdb36bad85e9924823d49db374067988e024cf80fc894711f2c9178951cbbe95',
      ),
      f(
        'cmaps/KSC-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/KSC-H.bcmap',
        1831,
        'c1f6d61f1d3304fd539a65ae72624fa567ecc3853bf52e283958a7a2515b3eee',
      ),
      f(
        'cmaps/KSC-Johab-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/KSC-Johab-H.bcmap',
        16791,
        '939993d213f68db763bf156217c217ae23af082b91a0eacecf3d11eb4ff8ef8c',
      ),
      f(
        'cmaps/KSC-Johab-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/KSC-Johab-V.bcmap',
        166,
        '5d61967aac0e666def721e8b8d0fed8f95a879a14f2e76ce516c3d11c621e519',
      ),
      f(
        'cmaps/KSC-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/KSC-V.bcmap',
        160,
        'd7da5afd9f1fe74816d79c9325f0139a4efb6438664ebfdf9a7aa92f3034360f',
      ),
      f(
        'cmaps/KSCms-UHC-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/KSCms-UHC-H.bcmap',
        2787,
        '5b70d8f6a4fa9e2283dc649f0ff95d906d56efbee50a20e8d2faec3a8fed078e',
      ),
      f(
        'cmaps/KSCms-UHC-HW-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/KSCms-UHC-HW-H.bcmap',
        2789,
        'a5e6ba22aceb02fdedee11bfb9ed138463d89e85b87810b9f075b469d936f8ec',
      ),
      f(
        'cmaps/KSCms-UHC-HW-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/KSCms-UHC-HW-V.bcmap',
        169,
        '890332a6a26880d463a12f2a6ff048bf9cf7e45077cfb1ca8815b89baa7bf411',
      ),
      f(
        'cmaps/KSCms-UHC-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/KSCms-UHC-V.bcmap',
        166,
        '1631b531c9a40c8cbe24c2317dba107362e49fa6e18af620414d627c111d570c',
      ),
      f(
        'cmaps/KSCpc-EUC-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/KSCpc-EUC-H.bcmap',
        2024,
        '709480682c55cedbb0124b9960d78e28febeee0df2e34607d61aac6601647ec7',
      ),
      f(
        'cmaps/KSCpc-EUC-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/KSCpc-EUC-V.bcmap',
        166,
        '031707887d6fc2378a36cdb6775334fd7a236c3f95048d8436abf43fe26fc49d',
      ),
      f(
        'cmaps/LICENSE',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/LICENSE',
        2080,
        'aa92ab5a472974865a96fd4a4e9c13bb41bf6fe1b309cb6b8da48bc9e19839a2',
      ),
      f(
        'cmaps/NWP-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/NWP-H.bcmap',
        2765,
        '286c6c9e335da330928a01edc3c97a3a623f1f7f3c42762b0a7dc2f651b1a78f',
      ),
      f(
        'cmaps/NWP-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/NWP-V.bcmap',
        252,
        '3a75fb7b59adfb172710758c425d8ac6c93fd5360a64dd4afd5dd04e60ab4b4d',
      ),
      f(
        'cmaps/RKSJ-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/RKSJ-H.bcmap',
        534,
        'a70de61a22a898f693f02cc011c3e3cff2e10aaa7cddb4661e456a21ae859f78',
      ),
      f(
        'cmaps/RKSJ-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/RKSJ-V.bcmap',
        170,
        '68c1a64506471a524ea5cfc3b3a9f8f70031989a6bd95427b1351f33ccf50b06',
      ),
      f(
        'cmaps/Roman.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/Roman.bcmap',
        96,
        '1c6b3ef9d9e5cb1aa329142ce9414b90f9b6d7f9182a2a9e927378dab8f0d43f',
      ),
      f(
        'cmaps/UniCNS-UCS2-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniCNS-UCS2-H.bcmap',
        48280,
        '779428116752f34e2490a1941d24e4634c71e3c22d053b811d2090ae2fb3c704',
      ),
      f(
        'cmaps/UniCNS-UCS2-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniCNS-UCS2-V.bcmap',
        156,
        '1e5cc184b850ea44abc2df8ae5674279df668e8edf5e2a1a2ea2bd77adbd280f',
      ),
      f(
        'cmaps/UniCNS-UTF8-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniCNS-UTF8-H.bcmap',
        53629,
        '2f2a742bcd1a84a148a4a518b9eed51a8f9c6ca5ed3bc5e2e41fff97de5dc2d8',
      ),
      f(
        'cmaps/UniCNS-UTF8-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniCNS-UTF8-V.bcmap',
        157,
        'b7c3f10780a8c62dd1c8ff6c30dc1e4e23b6cdc87c3a96fcd514cc98ffd3af9d',
      ),
      f(
        'cmaps/UniCNS-UTF16-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniCNS-UTF16-H.bcmap',
        50419,
        '32ff139b3c7b91d6ad25f994701f3ce7b242906022c418fd73e6493fc228bfe5',
      ),
      f(
        'cmaps/UniCNS-UTF16-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniCNS-UTF16-V.bcmap',
        156,
        '278eb1e68d1a236c60ef59472cf0176ee0d45f364285e76ca12419a08d46fb9a',
      ),
      f(
        'cmaps/UniCNS-UTF32-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniCNS-UTF32-H.bcmap',
        52679,
        'bf26eb67fe19ee5ba915799e80ca72408400aa8342fdf6a244a4f44de8f97336',
      ),
      f(
        'cmaps/UniCNS-UTF32-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniCNS-UTF32-V.bcmap',
        160,
        'f7da3caf83ceb1cb37936fa10700d9ba6e9c3f72c5bc9724e3ac79bff0c0179e',
      ),
      f(
        'cmaps/UniGB-UCS2-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniGB-UCS2-H.bcmap',
        43366,
        '9201569b402e81ad8860650bd86350c4fa28e5dd5971f05fcacaf40f51de18ed',
      ),
      f(
        'cmaps/UniGB-UCS2-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniGB-UCS2-V.bcmap',
        193,
        'f10282335e4d64203bc2a653a3a47d745ec76c8ae04549f4d50180c1899be216',
      ),
      f(
        'cmaps/UniGB-UTF8-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniGB-UTF8-H.bcmap',
        46837,
        'f217b439c80ee5fa1bc2cf6d1defcc319f8d84483d166a00ee199e05a68588df',
      ),
      f(
        'cmaps/UniGB-UTF8-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniGB-UTF8-V.bcmap',
        181,
        'a64df947632878eacc532fa193c735c92a383b7d66e6f8374ac193af7c64fc63',
      ),
      f(
        'cmaps/UniGB-UTF16-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniGB-UTF16-H.bcmap',
        44086,
        '386fd39581245c034da016a92d23f3df1117d169f996100050b264fc09a84e35',
      ),
      f(
        'cmaps/UniGB-UTF16-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniGB-UTF16-V.bcmap',
        178,
        '0473cfbba612b92dd9918f0ff8aee9112897c48e0ffdc0eb82da3144ed8ea84a',
      ),
      f(
        'cmaps/UniGB-UTF32-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniGB-UTF32-H.bcmap',
        45738,
        'f48a145dc4e3ed1dca1dde7111716a72306a2a4191ab05c6bae3a5c3a961cd2f',
      ),
      f(
        'cmaps/UniGB-UTF32-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniGB-UTF32-V.bcmap',
        182,
        '106acc49b7118bdef944e32107b4f348238f3929a0a15d3b7aab7b9101535993',
      ),
      f(
        'cmaps/UniJIS-UCS2-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniJIS-UCS2-H.bcmap',
        25439,
        'ad2352f40870880fbf7f8ee5abadff743fbd025fbf9830b8ada472d1c5e4da0b',
      ),
      f(
        'cmaps/UniJIS-UCS2-HW-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniJIS-UCS2-HW-H.bcmap',
        119,
        '16e87edca954177c0881c874859d6783220925d821b5cdfb8755b61ebd93f9ce',
      ),
      f(
        'cmaps/UniJIS-UCS2-HW-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniJIS-UCS2-HW-V.bcmap',
        680,
        '1973457e2c0192819947e56068625b34fb9a72ecc8a476ce6d7eaae5f73e2e5c',
      ),
      f(
        'cmaps/UniJIS-UCS2-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniJIS-UCS2-V.bcmap',
        664,
        '42a133d8e2ce9dd6d2288018e01592d2bf2435b326d39b94ea0b6e6a44ac33d3',
      ),
      f(
        'cmaps/UniJIS-UTF8-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniJIS-UTF8-H.bcmap',
        41695,
        '798fb0bf06ab0788d1f6a91c2db7de581612eef03c628f10e8f7ecd8f70ab448',
      ),
      f(
        'cmaps/UniJIS-UTF8-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniJIS-UTF8-V.bcmap',
        678,
        '1021611424f913b2df0bfdbe94bd327c04e224ec89d8e821c6501ea3d21f4265',
      ),
      f(
        'cmaps/UniJIS-UTF16-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniJIS-UTF16-H.bcmap',
        39443,
        'f6a89c5688978548c83fcee990e205bc63c74274d5c69b49032a3bd4c49a05ee',
      ),
      f(
        'cmaps/UniJIS-UTF16-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniJIS-UTF16-V.bcmap',
        643,
        'c67126fc7c73850855186bb0d6482ac0a365057e0b58778c4ab9f234683fef53',
      ),
      f(
        'cmaps/UniJIS-UTF32-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniJIS-UTF32-H.bcmap',
        40539,
        '96195950ce0fe24443d8eb426fa6b88534ec421d7bef9046f0b2362809cfba73',
      ),
      f(
        'cmaps/UniJIS-UTF32-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniJIS-UTF32-V.bcmap',
        677,
        'ed4dafda402bdd19c4d5d8bf2ab41473c0f86f384552b4c7b963d6627daedeb1',
      ),
      f(
        'cmaps/UniJIS2004-UTF8-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniJIS2004-UTF8-H.bcmap',
        41779,
        '691c614ce432b3e62486efb54e5c84c6da5afe9b51b21253bde4758feb484183',
      ),
      f(
        'cmaps/UniJIS2004-UTF8-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniJIS2004-UTF8-V.bcmap',
        682,
        '40a8c7ea2d46711c5f78fc9a878a7db68b1543ba5cd60ecf14f519a2deb829b7',
      ),
      f(
        'cmaps/UniJIS2004-UTF16-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniJIS2004-UTF16-H.bcmap',
        39534,
        '710a32d7cb43fd6bd9dbf30da5971f8c941590f74441e208d852c2be0e74cc97',
      ),
      f(
        'cmaps/UniJIS2004-UTF16-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniJIS2004-UTF16-V.bcmap',
        647,
        '3b149aff5c5707b57fb3215d1775852c8b1f413ec0f679ea628f25cf87fe098d',
      ),
      f(
        'cmaps/UniJIS2004-UTF32-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniJIS2004-UTF32-H.bcmap',
        40630,
        '8d2658e18741af7937d586a57c89729a6fec0d86121197c1f8518aa58b29cdfb',
      ),
      f(
        'cmaps/UniJIS2004-UTF32-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniJIS2004-UTF32-V.bcmap',
        681,
        '6dd475782f2897648a683c48b2fa015a15b8f06856760bddc8a17a63f418bacb',
      ),
      f(
        'cmaps/UniJISPro-UCS2-HW-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniJISPro-UCS2-HW-V.bcmap',
        705,
        '6826f94d789d7bf1960668c1c5819c34c9585c1b23152fbc19ee81c7df08524b',
      ),
      f(
        'cmaps/UniJISPro-UCS2-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniJISPro-UCS2-V.bcmap',
        689,
        '493de9fd1a08f7946065d8ab58f0c3c9fe489f5a0f109f2d05a3169b4bd5789f',
      ),
      f(
        'cmaps/UniJISPro-UTF8-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniJISPro-UTF8-V.bcmap',
        726,
        '6181d382cf736c5e09492e8be9f26f31fa25b7462253f23ab16646af432cad81',
      ),
      f(
        'cmaps/UniJISX0213-UTF32-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniJISX0213-UTF32-H.bcmap',
        40517,
        '692044e1fb33445668632bc9fe7386805c624864be1ddeb29d65bb0c99fc630c',
      ),
      f(
        'cmaps/UniJISX0213-UTF32-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniJISX0213-UTF32-V.bcmap',
        684,
        'dd54e16ca7bffb3a886242549b2bf7d78a277087f7c60d2636f118c21a5b0646',
      ),
      f(
        'cmaps/UniJISX02132004-UTF32-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniJISX02132004-UTF32-H.bcmap',
        40608,
        'f80ea5a989be30ccda5a8804baef6d3b4b044d2b339bf8b31c671b2466171cf6',
      ),
      f(
        'cmaps/UniJISX02132004-UTF32-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniJISX02132004-UTF32-V.bcmap',
        688,
        '94c22bd99e771c5fbe0dd8dc39850570d4db0075074aca13e272813edd7cc57f',
      ),
      f(
        'cmaps/UniKS-UCS2-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniKS-UCS2-H.bcmap',
        25783,
        'a1081396ab4adb6f4a5b6c15f896963c244c1c9bcb65ce5616d06096a1b9811c',
      ),
      f(
        'cmaps/UniKS-UCS2-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniKS-UCS2-V.bcmap',
        178,
        '6cab547431958fbdc1d401d06ebd4dd61a73f5509a10f974df32bcbca11a2e43',
      ),
      f(
        'cmaps/UniKS-UTF8-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniKS-UTF8-H.bcmap',
        27790,
        '3fac9c65145f72d7d42157a3b9c5ed6904632184e6a0888f2b828699afd2002f',
      ),
      f(
        'cmaps/UniKS-UTF8-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniKS-UTF8-V.bcmap',
        169,
        '9ecc6cf30dd354b9778ddba163b6cc7302b087ce9f39d1ba73472d2b75ed13ca',
      ),
      f(
        'cmaps/UniKS-UTF16-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniKS-UTF16-H.bcmap',
        26327,
        '42d35b396286499dfae1737a07adb3a64500df37b426580bfb1d3ea872938519',
      ),
      f(
        'cmaps/UniKS-UTF16-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniKS-UTF16-V.bcmap',
        164,
        '5bdb7390c80dcc136cb47d41dc7460082560969c17322ee739fe3020fb642410',
      ),
      f(
        'cmaps/UniKS-UTF32-H.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniKS-UTF32-H.bcmap',
        26451,
        '3a01ec51ed1b828101351e337ffb8250abe11880032e5210f881170fed2588de',
      ),
      f(
        'cmaps/UniKS-UTF32-V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/UniKS-UTF32-V.bcmap',
        168,
        'dfda895eceaed081af030dbbb962b49629eea817fc3c02bae15db93d0c68acd7',
      ),
      f(
        'cmaps/V.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/V.bcmap',
        166,
        'b9ad1c0c09ff14bca52f9a28a9767eb857ad0e8946e64ba14c7387a7eb69866a',
      ),
      f(
        'cmaps/WP-Symbol.bcmap',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/WP-Symbol.bcmap',
        179,
        '543923bead225732aba30976690ee89095a19628277b5863efecc2c728d5d7bf',
      ),
      f(
        'standard_fonts/FoxitDingbats.pfb',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/standard_fonts/FoxitDingbats.pfb',
        29513,
        '845c752392b6c914fb989c75a08b7792b88f542d2499042ef2889f8c814a16ed',
      ),
      f(
        'standard_fonts/FoxitFixed.pfb',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/standard_fonts/FoxitFixed.pfb',
        17597,
        'b6c8fe53f134b8b6d4578cd2d544df4cee9624c4efa8d51a560fb40ea296101b',
      ),
      f(
        'standard_fonts/FoxitFixedBold.pfb',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/standard_fonts/FoxitFixedBold.pfb',
        18055,
        'f1b7159702973f54fc86254ea38bcf3712b2a736eb3a0995751e9f4bb45ad603',
      ),
      f(
        'standard_fonts/FoxitFixedBoldItalic.pfb',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/standard_fonts/FoxitFixedBoldItalic.pfb',
        19151,
        '8a000945843bd31add06aee63bf9fd41b7578b4f3242a4b7cd46349ad9d24d4d',
      ),
      f(
        'standard_fonts/FoxitFixedItalic.pfb',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/standard_fonts/FoxitFixedItalic.pfb',
        18746,
        '5007faf8320fa1fcc08b8894b356ad976f60b992ba29ee5272578bbdebaf3876',
      ),
      f(
        'standard_fonts/FoxitSerif.pfb',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/standard_fonts/FoxitSerif.pfb',
        19469,
        '4f57d2b9d884af8f907bf22df6019b52d86cbf6214fdbd02b1ae05472a543f35',
      ),
      f(
        'standard_fonts/FoxitSerifBold.pfb',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/standard_fonts/FoxitSerifBold.pfb',
        19395,
        '0bdf4b04e964139818d51eda03d566ba999fc3ba2421b1c6c51f9dc969022e80',
      ),
      f(
        'standard_fonts/FoxitSerifBoldItalic.pfb',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/standard_fonts/FoxitSerifBoldItalic.pfb',
        20733,
        'a406cac82583bf98175cb62c87ed5e95c45fbb34eece63a10b0a13e793cb2e10',
      ),
      f(
        'standard_fonts/FoxitSerifItalic.pfb',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/standard_fonts/FoxitSerifItalic.pfb',
        21227,
        '610ae0687198045c4db5d1a6650fd5e92536631706382eb8b72e38df578d0ae9',
      ),
      f(
        'standard_fonts/FoxitSymbol.pfb',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/standard_fonts/FoxitSymbol.pfb',
        16729,
        '47967d055530e7357088a08403115425643ec2cdfd6201ba8af0fbd7116c1539',
      ),
      f(
        'standard_fonts/LICENSE_FOXIT',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/standard_fonts/LICENSE_FOXIT',
        1553,
        'b578cdd2345840ada550bd12519533812320d5f1d21cf4c1c7e1b1b0a31c98b7',
      ),
      f(
        'wasm/jbig2.wasm',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/wasm/jbig2.wasm',
        103671,
        '466f45c2a61a698152fb5400c27e56ff2ceb73dcb71fde3fc366a502308eaab0',
      ),
      f(
        'wasm/LICENSE_JBIG2',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/wasm/LICENSE_JBIG2',
        12862,
        '9e66b7f1b934a28b37f3bc4dac97915de1674271e79a0a88182a18ed9731b4d1',
      ),
      f(
        'wasm/LICENSE_OPENJPEG',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/wasm/LICENSE_OPENJPEG',
        2112,
        'a6af136f3e15038a666b61f376612a07d9a4e48cb7c01adbf3e33b3f14ab49b6',
      ),
      f(
        'wasm/LICENSE_PDFJS_JBIG2',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/wasm/LICENSE_PDFJS_JBIG2',
        555,
        'aad3cce09842e00e9e11ad5e8fef8cc02fbc3a3768fe2f007443b9cee37aaee5',
      ),
      f(
        'wasm/LICENSE_PDFJS_OPENJPEG',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/wasm/LICENSE_PDFJS_OPENJPEG',
        1285,
        '717fc62da03292dbb4dd0c8280bd4ce7bb8550dcf31d772bc93455fb50313425',
      ),
      f(
        'wasm/openjpeg.wasm',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/wasm/openjpeg.wasm',
        251131,
        '95e5002597af0824004aa57b1900fe019715db389e37640b1e58395e42f00cc5',
      ),
    ],
  },
  // ---- 语音转文字（D-151，音频会话）：Android 用 whisper.cpp 在本机识别，模型从 Hugging Face 固定版本下载 ----
  // jsDelivr 单个文件最大 20 MB，放不下模型，所以用 Hugging Face 固定提交（commit）的地址。
  {
    id: 'speech-vad',
    version: '6.2.0',
    name: { en: 'Speech detection', zh: '语音检测', fr: 'Détection de la parole' },
    description: {
      en: 'Finds where people are talking in a recording, so silence and music are skipped (Silero VAD).',
      zh: '找出录音里有人说话的部分，跳过静音和音乐（Silero VAD）。',
      fr: 'Repère les passages où l’on parle dans un enregistrement, pour ignorer les silences et la musique (Silero VAD).',
    },
    license: 'MIT (Silero VAD, ggml conversion by whisper.cpp)',
    files: [
      f(
        'vad.bin',
        'https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v6.2.0.bin',
        885098,
        '2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987',
      ),
    ],
  },
  {
    id: 'speech-whisper-small',
    version: '1.0.0',
    name: { en: 'Speech to text', zh: '语音转文字', fr: 'Transcription' },
    description: {
      en: 'Turns recordings into text on this device (whisper small). Better for Chinese, slower.',
      zh: '在本机把录音转成文字（whisper small）。中文更准，速度慢一些。',
      fr: 'Transcrit les enregistrements en texte sur cet appareil (whisper small). Meilleur pour le chinois, mais plus lent.',
    },
    license: 'MIT (OpenAI Whisper small, ggml q5_1 by whisper.cpp)',
    requires: ['speech-vad'],
    files: [
      f(
        'model.bin',
        'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small-q5_1.bin',
        190085487,
        'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
      ),
    ],
  },
  {
    id: 'speech-whisper-base',
    version: '1.0.0',
    name: { en: 'Speech to text (fast)', zh: '语音转文字（快速）', fr: 'Transcription (rapide)' },
    description: {
      en: 'Turns recordings into text on this device (whisper base). About 3 times faster, less accurate for Chinese.',
      zh: '在本机把录音转成文字（whisper base）。快约 3 倍，中文错字多一些。',
      fr: 'Transcrit les enregistrements en texte sur cet appareil (whisper base). Environ 3 fois plus rapide, mais moins précis pour le chinois.',
    },
    license: 'MIT (OpenAI Whisper base, ggml q5_1 by whisper.cpp)',
    requires: ['speech-vad'],
    files: [
      f(
        'model.bin',
        'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base-q5_1.bin',
        59707625,
        '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898',
      ),
    ],
  },
];

/** OCR 语言代码（tesseract）→ 扩展包 ID。 */
export const OCR_LANGUAGES = [
  'eng',
  'chi_sim',
  'chi_tra',
  'jpn',
  'kor',
  'fra',
  'deu',
  'spa',
  'por',
  'ita',
  'rus',
  'vie',
] as const;
export type OcrLanguage = (typeof OCR_LANGUAGES)[number];
export const ocrPackId = (lang: string) => `ocr-${lang.replace('_', '-')}`;

export const packById = (id: string) => PACKS.find((p) => p.id === id);

/** 一个扩展包连同依赖一共要下载的字节数。 */
export function packDownloadSize(id: string, installed: ReadonlySet<string> = new Set()): number {
  const pack = packById(id);
  if (!pack || installed.has(id)) return 0;
  const own = pack.files.reduce((sum, file) => sum + file.size, 0);
  return (
    own + (pack.requires ?? []).reduce((sum, dep) => sum + packDownloadSize(dep, installed), 0)
  );
}
