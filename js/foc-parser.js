/**
 * 植物资料库 - 浏览器端 FOC PDF 解析器
 * 使用 pdf.js 提取文本，然后用正则解析 FOC 内容结构
 */

/** v3: 双语文本工具 - 按"连续语言段"将文本切分为中/英两部分 */
const BilingualUtil = {
  /** 给定一段混合中英文的文本，返回 { zh, en } */
  split(text) {
    if (!text) return { zh: '', en: '' };
    // 按段落切分（双换行/句号后 + 大写或中文字符开头）
    const parts = text
      .split(/\n{2,}|(?<=[.。;；])\s*(?=[A-Z一-鿿])/)
      .map(s => s.trim())
      .filter(Boolean);
    const zhArr = [];
    const enArr = [];
    for (const p of parts) {
      const zhCount = (p.match(/[一-鿿㐀-䶿]/g) || []).length;
      const enCount = (p.match(/[A-Za-z]{2,}/g) || []).length;
      if (zhCount > enCount * 2) zhArr.push(p);
      else if (enCount > 0) enArr.push(p);
      else zhArr.push(p);  // 数字/符号兜底归中文
    }
    return { zh: zhArr.join('\n\n'), en: enArr.join('\n\n') };
  },

  /** 判断文本是否主要是中文（≥50% 中文字符） */
  isMostlyChinese(text) {
    if (!text) return false;
    const total = text.length;
    const zh = (text.match(/[一-鿿㐀-䶿]/g) || []).length;
    return total > 0 && zh / total > 0.3;
  }
};

const FOCParser = {
  _pdfJsLoaded: false,

  /** 按需加载 pdf.js（首次调用时） */
  async _loadPdfJs() {
    if (this._pdfJsLoaded) return;
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'lib/pdf.min.js';
      script.onload = () => {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
        this._pdfJsLoaded = true;
        resolve();
      };
      script.onerror = () => reject(new Error('无法加载 pdf.js'));
      document.head.appendChild(script);
    });
  },

  /** 从 PDF File 对象提取全文 */
  async extractText(file) {
    await this._loadPdfJs();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map(item => item.str).join(' ');
      pages.push(text);
    }
    return pages.join('\n');
  },

  /** 从文件名解析科名: "Violaceae 堇菜科.pdf" → { latin, chinese } */
  parseFamilyFromFilename(filename) {
    const stem = filename.replace(/\.pdf$/i, '');
    const m = stem.match(/^([A-Za-z]+)\s+([\u4e00-\u9fff\u3400-\u4dbf]+)/);
    if (m) return { latin: m[1], chinese: m[2] };
    const m2 = stem.match(/^([A-Za-z]+)/);
    if (m2) return { latin: m2[1], chinese: null };
    return null;
  },

  /** 解析属列表 */
  parseGenera(text) {
    const pattern = /(\d+)\.\s+([A-Z][A-Z]+)\s+([A-Z][a-zé][^,\n]+)/g;
    const genera = [];
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const nameUpper = m[2];
      if (nameUpper.endsWith('ACEAE') || nameUpper.endsWith('ALES')) continue;
      genera.push({
        genus: nameUpper[0] + nameUpper.slice(1).toLowerCase(),
        authority: m[3].trim()
      });
    }
    return genera;
  },

  /** 解析二歧检索表文本为结构化 JSON */
  parseDichotomousKey(textBlock) {
    if (!textBlock) return [];
    const couplets = {};
    const lines = textBlock.split('\n');

    for (let line of lines) {
      line = line.trim();
      // 匹配 "1a. text ... N" 或 "1a. text ... GenusName"
      const m = line.match(/^(\d+)(a|b)\.\s+(.+?)(?:\s*\.{2,}\s*(.+))?$/);
      if (!m) continue;

      const num = parseInt(m[1]);
      const label = m[2];
      const desc = m[3].trim();
      const target = m[4]?.trim();

      if (!couplets[num]) couplets[num] = { number: num, leads: [] };

      const lead = { label, text: desc };
      if (target) {
        if (/^\d+$/.test(target)) {
          lead.goto = parseInt(target);
        } else {
          lead.result = target;
        }
      }
      couplets[num].leads.push(lead);
    }

    return Object.keys(couplets).sort((a, b) => a - b).map(k => couplets[k]);
  },

  /** 解析种条目 */
  parseSpecies(text, knownGenera) {
    const genusSet = new Set(knownGenera.map(g => g.genus));
    const lines = text.split('\n');
    const startPattern = /^(\d+)\.\s+([A-Z][a-z]+)\s+((?:(?:var|subsp|f|ssp)\.\s+)?[a-z][a-z-]{2,})\s+(.+)/;
    const yearPattern = /(\d{4})\./;
    const cnPattern = /([\u4e00-\u9fff\u3400-\u4dbf]{2,8})/;

    const species = [];
    const seen = new Set();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const m = startPattern.exec(line);
      if (!m) continue;

      const genus = m[2];
      if (!genusSet.has(genus)) continue;

      const epithet = m[3].trim();
      const latinName = `${genus} ${epithet}`;
      const rest = m[4].trim();

      // 合并后续行找年份
      let combined = rest;
      for (let k = 1; k <= 3; k++) {
        if (yearPattern.test(combined)) break;
        if (i + k < lines.length) combined += ' ' + lines[i + k].trim();
      }
      if (!yearPattern.test(combined)) continue;

      // 去重
      if (seen.has(latinName)) continue;
      seen.add(latinName);

      // 提取命名人
      const yearMatch = yearPattern.exec(combined);
      const beforeYear = combined.substring(0, yearMatch.index).trim().replace(/,$/, '').trim();
      const authority = beforeYear.split(',')[0].trim().replace(/\s+/g, ' ');

      // 查找中文名
      let chineseName = null;
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const cnMatch = cnPattern.exec(lines[j]);
        if (cnMatch) { chineseName = cnMatch[1]; break; }
      }

      species.push({
        latin_name: latinName,
        chinese_name: chineseName,
        genus,
        species_epithet: epithet,
        authority
      });
    }

    return species;
  },

  /** 解析完整 FOC PDF，返回结构化结果 */
  async parsePDF(file) {
    const familyInfo = this.parseFamilyFromFilename(file.name);
    if (!familyInfo) throw new Error('无法从文件名解析科名');

    const text = await this.extractText(file);
    const genera = this.parseGenera(text);
    const species = this.parseSpecies(text, genera);

    // 尝试提取检索表
    let keyToGenera = [];
    const keyMatch = text.match(/Key to genera([\s\S]*?)(?=1\.\s+[A-Z][A-Z]+\s+[A-Z])/i);
    if (keyMatch) {
      keyToGenera = this.parseDichotomousKey(keyMatch[1]);
    }

    return {
      familyInfo: {
        latin: familyInfo.latin,
        chinese: familyInfo.chinese,
        display: familyInfo.chinese
          ? `${familyInfo.chinese} ${familyInfo.latin}`
          : familyInfo.latin
      },
      genera,
      species,
      keyToGenera,
      generaCount: genera.length,
      speciesCount: species.length
    };
  }
};
