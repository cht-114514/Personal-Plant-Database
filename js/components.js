/**
 * 植物资料库 - Vue 3 组件库
 * 包含：分类树、植物详情、交互式检索表、科/属介绍页
 */

// ==================== 分类树组件 ====================

const TaxonomyTreeComponent = {
  name: 'TaxonomyTree',
  props: {
    tree: { type: Object, required: true },
    selectedPath: { type: Array, default: () => [] },
    depth: { type: Number, default: 0 }
  },
  emits: ['select'],
  template: `
    <div class="tree-node" v-if="tree">
      <div
        class="tree-node-header"
        :class="{ selected: isSelected }"
        :style="{ '--depth': depth }"
        @click="toggle"
      >
        <span
          class="tree-toggle"
          :class="{ expanded: isOpen, leaf: !hasChildren }"
        >&#9654;</span>
        <span class="tree-label">{{ tree.label }}</span>
        <span class="tree-level-tag" v-if="tree.levelLabel">{{ tree.levelLabel }}</span>
        <span class="tree-count">({{ tree.count }})</span>
      </div>
      <div v-show="isOpen" v-if="hasChildren">
        <taxonomy-tree
          v-for="child in tree.children"
          :key="child.value || child.label"
          :tree="child"
          :selected-path="selectedPath"
          :depth="depth + 1"
          @select="$emit('select', $event)"
        ></taxonomy-tree>
      </div>
    </div>
  `,
  setup(props, { emit }) {
    const isOpen = ref(props.depth < 1);
    const hasChildren = computed(() => props.tree.children && props.tree.children.length > 0);
    const isSelected = computed(() => {
      if (!props.tree.value) return false;
      return props.selectedPath.includes(props.tree.value);
    });

    function toggle() {
      if (hasChildren.value) {
        isOpen.value = !isOpen.value;
      }
      if (props.tree.level && props.tree.value) {
        emit('select', { level: props.tree.level, value: props.tree.value, label: props.tree.label });
      }
    }

    return { isOpen, hasChildren, isSelected, toggle };
  }
};

// ==================== 检索表：从 key_text 解析树形结构 ====================

/**
 * 从 FOC 原始检索表文本解析出带 goto 的对句数组
 * 输入格式示例:
 *   1a. Petals imbricate in bud.
 *   2a. Herbs; ... 23. Panax
 *   2b. Shrubs; ...
 *   3a. ... 21. Pentapanax
 *   3b. ... 22. Aralia
 *   1b. Petals valvate in bud.
 *   4a. ...
 */
function parseKeyText(text) {
  if (!text || text.trim().length === 0) return [];

  // 按行处理，合并跨行的条目
  const lines = text.split('\n');
  const entries = []; // {number, label, text, result, goto}
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // 匹配对句开头: "1a." "2b." "10a." 等
    const leadMatch = line.match(/^(\d+)([a-b])\.\s+(.*)$/);
    if (leadMatch) {
      // 保存上一条
      if (current) entries.push(finishEntry(current));
      current = {
        number: parseInt(leadMatch[1]),
        label: leadMatch[2],
        textParts: [leadMatch[3]]
      };
    } else if (current) {
      // 续行（长描述折行）
      // 排除明显不属于检索表的行（如属描述开头）
      if (/^\d+\.\s+[A-Z][A-Z]+/.test(line)) break; // 全大写属名行 = 检索表结束
      if (/^[\u4e00-\u9fff]/.test(line)) continue; // 纯中文行跳过
      current.textParts.push(line);
    }
  }
  if (current) entries.push(finishEntry(current));

  return entries;
}

function finishEntry(entry) {
  let fullText = entry.textParts.join(' ').replace(/\s+/g, ' ').trim();

  // 提取结果：文本末尾可能是
  //   (a) 属级 key: "....... 23. Panax"           → "Panax"
  //   (b) 种级 key(缩写): "....... 17. A. alpestre" → "A. alpestre"
  //   (c) 种级 key(全名): "....... Amitostigma alpestre" → "Amitostigma alpestre"
  //   (d) 种下变种:     "....... A. alpestre var. xx"    → "A. alpestre var. xx"
  //   (e) goto 跳转:   "....... 4"                       → goto=4
  let result = null;
  let goto = null;

  // 合并模式 a/b/c/d:
  // 可选的 "N. " 前缀 + 可选的 "Subfam./Tribe " 前缀 + 名字部分
  // 名字: 一个"属标识"(缩写 "A." 或全名 "Amitostigma") + 可选的种加词/infraspecific
  const NAME_PAT =
    '(?:[A-Z]\\.|[A-Z][a-z]+)' +                  // 属缩写或全名
    '(?:\\s+[a-z][\\w-]*)?' +                     // 可选种加词
    '(?:\\s+(?:var\\.|subsp\\.|f\\.|ssp\\.)\\s+[a-z][\\w-]*)?';  // 可选种下

  // 末尾可能的 "(p. NN)" 页号
  const PAGE_SUFFIX = '(?:\\s*\\(p\\.\\s*\\d+\\))?';
  // 可选的 "Subfam." 或 "Tribe " 前缀（捕获时保留）
  const PREFIX = '(?:(?:Subfam|Tribe|Subtribe)\\.\\s+)?';

  const resultRe = new RegExp(
    `\\.{2,}\\s*(?:\\d+\\.\\s+)?(${PREFIX}${NAME_PAT})${PAGE_SUFFIX}\\s*$`
  );
  const resultMatch = fullText.match(resultRe);
  if (resultMatch) {
    result = resultMatch[1].trim();
    fullText = fullText
      .substring(0, fullText.lastIndexOf(resultMatch[0]))
      .replace(/\.{2,}\s*$/, '')
      .trim();
  }

  // 模式 e: "...... 4" 只有编号
  if (!result) {
    const gotoMatch = fullText.match(/\.{2,}\s*(\d+)\s*$/);
    if (gotoMatch) {
      goto = parseInt(gotoMatch[1]);
      fullText = fullText
        .substring(0, fullText.lastIndexOf(gotoMatch[0]))
        .replace(/\.{2,}\s*$/, '')
        .trim();
    }
  }

  return {
    number: entry.number,
    label: entry.label,
    text: fullText,
    result: result,
    goto: goto,
  };
}

/**
 * 从对句数组构建树
 */
function buildKeyTree(entries) {
  if (!entries || entries.length === 0) return [];

  // 按编号分组为对句对 (a/b 配对)
  const couplets = {};
  for (const e of entries) {
    if (!couplets[e.number]) couplets[e.number] = [];
    couplets[e.number].push(e);
  }

  // 推断 goto:每个无 result 无 goto 的 lead,其 goto 是"源文本顺序中下一个不同编号的 couplet"。
  // 不能像之前那样用 allNums 排序后取下一个——会让 1a 和 1b 共享同一个 goto,
  // 其中一个的子树会被 visited.has 屏蔽掉。
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e.result && !e.goto) {
      for (let j = i + 1; j < entries.length; j++) {
        if (entries[j].number !== e.number) {
          e.goto = entries[j].number;
          break;
        }
      }
    }
  }

  // 构建树:允许同一 couplet 被多处访问(深拷贝防循环已由 goto 推断保证不会真正循环)
  function buildNode(num, path) {
    if (!couplets[num] || path.has(num)) return null;
    const newPath = new Set(path);
    newPath.add(num);
    return couplets[num].map(lead => ({
      label: lead.label,
      text: lead.text,
      result: lead.result,
      children: lead.goto ? buildNode(lead.goto, newPath) : null,
    }));
  }

  const allNums = Object.keys(couplets).map(Number).sort((a, b) => a - b);
  const startNum = allNums.length > 0 ? allNums[0] : 1;
  return buildNode(startNum, new Set()) || [];
}

// ==================== 递归树分支组件 ====================

const KeyBranchComponent = {
  name: 'KeyBranch',
  props: {
    branches: { type: Array, required: true },
    depth: { type: Number, default: 0 },
    level: { type: String, default: 'genus' }
  },
  emits: ['navigate', 'navigate-plant'],
  template: `
    <div class="key-tree-level">
      <div v-for="(branch, i) in branches" :key="i" class="key-tree-branch">
        <div class="key-branch-line"
             :class="{ 'has-children': branch.children && branch.children.length, 'is-leaf': !branch.children || !branch.children.length }"
             @click="branch.children && branch.children.length ? toggle(i) : null">
          <span class="branch-indent" :style="{ width: depth * 20 + 'px' }"></span>
          <span class="branch-icon">{{ branch.children && branch.children.length ? (isOpen(i) ? '▾' : '▸') : '·' }}</span>
          <span class="branch-label">{{ branch.label }}.</span>
          <span class="branch-text">{{ branch.text }}</span>
        </div>

        <!-- 叶节点:物种/属卡片 -->
        <div v-if="branch.leaf && (!branch.children || !branch.children.length)"
             class="key-leaf-card-wrap"
             :style="{ paddingLeft: (depth * 20 + 28) + 'px' }">
          <!-- 物种卡片 -->
          <div v-if="branch.leaf.type === 'species'"
               class="key-leaf-card species"
               :class="{ missing: !branch.leaf.plant }"
               @click.stop="branch.leaf.plant && $emit('navigate-plant', branch.leaf.plant)">
            <div class="key-leaf-image">
              <img v-if="branch.leaf.plant && branch.leaf.plant.primary_photo_url"
                   :src="branch.leaf.plant.primary_photo_url"
                   :alt="branch.leaf.plant.chinese_name" loading="lazy">
              <span v-else class="key-leaf-placeholder">🌿</span>
            </div>
            <div class="key-leaf-info">
              <div class="key-leaf-chinese">
                {{ branch.leaf.plant ? (branch.leaf.plant.chinese_name || '—') : '—' }}
              </div>
              <div class="key-leaf-latin"><i>{{ branch.leaf.fullLatin }}</i></div>
              <div v-if="!branch.leaf.plant" class="key-leaf-missing-tag">未收录</div>
            </div>
          </div>
          <!-- 属卡片(科级 key) -->
          <div v-else-if="branch.leaf.type === 'genus'"
               class="key-leaf-card genus"
               :class="{ missing: branch.leaf.count === 0 }"
               @click.stop="branch.leaf.count > 0 && $emit('navigate', branch.leaf.genus)">
            <div class="key-leaf-info">
              <div class="key-leaf-latin"><i>{{ branch.leaf.genus }}</i></div>
              <div class="key-leaf-count">
                {{ branch.leaf.count > 0 ? branch.leaf.count + ' 种' : '本库未收录' }}
              </div>
            </div>
          </div>
          <!-- 亚科/族卡片(科级 key 中的中间节点)-->
          <div v-else-if="branch.leaf.type === 'subtaxon'"
               class="key-leaf-card subtaxon"
               @click.stop="$emit('navigate', branch.leaf.label)">
            <div class="key-leaf-info">
              <div class="key-leaf-latin"><i>{{ branch.leaf.label }}</i></div>
              <div class="key-leaf-count">{{ branch.leaf.isSubfamily ? '亚科' : '族' }}</div>
            </div>
          </div>
        </div>
        <!-- 兜底:result 存在但 leaf 解析失败,展示纯文本 -->
        <div v-else-if="branch.result && (!branch.children || !branch.children.length)"
             class="branch-result-fallback"
             :style="{ paddingLeft: (depth * 20 + 28) + 'px' }">
          → <i>{{ branch.result }}</i>
        </div>

        <div v-if="branch.children && branch.children.length && isOpen(i)" class="key-subtree">
          <key-branch
            :branches="branch.children"
            :depth="depth + 1"
            :level="level"
            @navigate="$emit('navigate', $event)"
            @navigate-plant="$emit('navigate-plant', $event)"
          ></key-branch>
        </div>
      </div>
    </div>
  `,
  setup(props) {
    const collapsed = ref({});

    function isOpen(i) {
      if (collapsed.value[i] !== undefined) return !collapsed.value[i];
      return props.depth < 3;
    }

    function toggle(i) {
      const open = isOpen(i);
      collapsed.value = { ...collapsed.value, [i]: open };
    }

    return { isOpen, toggle };
  }
};

// ==================== 检索表主组件（树形渲染） ====================

/**
 * 把检索表叶节点的 result 字符串解析成 plant/genus 对象并附着到分支上,
 * 这样 KeyBranch 可以直接渲染成物种卡片/属卡片。
 */
function resolveKeyLeaves(branches, level, genusContext) {
  if (!branches || !branches.length) return branches;
  return branches.map(b => {
    const out = { ...b };
    if (b.children && b.children.length) {
      out.children = resolveKeyLeaves(b.children, level, genusContext);
    } else if (b.result) {
      out.leaf = resolveLeafResult(b.result, level, genusContext);
    }
    return out;
  });
}

function resolveLeafResult(result, level, genusContext) {
  const s = result.trim();
  if (level === 'family') {
    // 科级 key: leaf 可能是 "Genus" / "Subfam. X (p. 20)" / "1. Subfam. X (p. 20)"
    // 提取真正的属名/亚科名（去掉编号前缀、Subfam. 前缀、(p. xx) 后缀）
    let cleaned = s
      .replace(/^\d+\.\s*/, '')           // 去掉前导编号 "1. "
      .replace(/\s*\(p\.\s*\d+\)\s*$/i, '') // 去掉 "(p. 20)"
      .replace(/\.$/, '')                  // 去掉末尾句号
      .trim();
    let isSubfamily = false;
    if (/^Subfam\.\s+/i.test(cleaned)) {
      isSubfamily = true;
      cleaned = cleaned.replace(/^Subfam\.\s+/i, '').trim();
    } else if (/^Tribe\s+/i.test(cleaned)) {
      isSubfamily = true; // 族也归为非属节点
      cleaned = cleaned.replace(/^Tribe\s+/i, '').trim();
    }
    // 单一拉丁名词（开头大写、无空格）才视为可点击的属
    const isGenusLike = /^[A-Z][a-zA-Z]+$/.test(cleaned);
    if (isSubfamily || !isGenusLike) {
      // 亚科/族：作为可点击但跳转到搜索的节点
      return { type: 'subtaxon', label: cleaned, original: s, isSubfamily };
    }
    const count = (typeof BotanicalDB !== 'undefined' && BotanicalDB.countSpeciesInGenus)
      ? BotanicalDB.countSpeciesInGenus(cleaned)
      : 0;
    return { type: 'genus', genus: cleaned, count };
  }
  // 属级 key: leaf = 种名,可能是缩写("A. alpestre")或全名("Amitostigma alpestre")
  const abbr = s.match(/^([A-Z])\.\s+(\S+)(?:\s+(var\.|subsp\.|f\.|ssp\.)\s+(\S+))?/);
  const full = s.match(/^([A-Z][a-z]+)\s+(\S+)(?:\s+(var\.|subsp\.|f\.|ssp\.)\s+(\S+))?/);
  let genus = null, epithet = null;
  let fullLatin = s;
  if (abbr) {
    genus = genusContext || abbr[1];
    epithet = abbr[2];
    fullLatin = genusContext ? `${genusContext} ${epithet}` : s;
  } else if (full) {
    genus = full[1];
    epithet = full[2];
    fullLatin = `${genus} ${epithet}`;
  }
  let plant = null;
  if (genus && epithet && typeof BotanicalDB !== 'undefined' && BotanicalDB.findPlantByBinomial) {
    plant = BotanicalDB.findPlantByBinomial(genus, epithet);
  }
  return { type: 'species', fullLatin, genus, epithet, plant };
}

const DichotomousKeyComponent = {
  name: 'DichotomousKey',
  props: {
    keyData: { type: Array, default: () => [] },
    keyText: { type: String, default: '' },
    level: { type: String, default: 'genus' },
    genusContext: { type: String, default: '' }
  },
  emits: ['navigate', 'navigate-plant'],
  template: `
    <div class="dichotomous-key" v-if="tree && tree.length > 0">
      <div class="key-header">
        <h3 class="key-title">{{ level === 'family' ? '属检索表 Key to genera' : '种检索表 Key to species' }}</h3>
      </div>
      <div class="key-tree">
        <key-branch
          :branches="tree"
          :depth="0"
          :level="level"
          @navigate="$emit('navigate', $event)"
          @navigate-plant="$emit('navigate-plant', $event)"
        ></key-branch>
      </div>
    </div>
  `,
  setup(props) {
    const tree = computed(() => {
      let rawTree = [];
      // 优先用 key_text（有完整 goto 信息）
      if (props.keyText && props.keyText.trim().length > 0) {
        const entries = parseKeyText(props.keyText);
        rawTree = buildKeyTree(entries);
      } else if (props.keyData && props.keyData.length > 0) {
        // 回退到 key_data(旧格式)
        const entries = [];
        for (const c of props.keyData) {
          for (const l of c.leads) {
            if (l.label) {
              entries.push({
                number: c.number,
                label: l.label,
                text: (l.text || '').replace(/\.{2,}\s*\d+\s*$/, '').trim(),
                result: l.result || null,
                goto: l.goto || null
              });
            }
          }
        }
        rawTree = buildKeyTree(entries);
      }
      return resolveKeyLeaves(rawTree, props.level, props.genusContext);
    });
    return { tree };
  }
};

// ==================== 科/属介绍页组件 ====================

const TaxonomyIntroComponent = {
  name: 'TaxonomyIntro',
  props: {
    level: { type: String, required: true },
    taxonName: { type: String, required: true },
    description: { type: Object, default: null },
    plants: { type: Array, default: () => [] }
  },
  emits: ['select-plant', 'save-description', 'navigate-key'],
  template: `
    <div class="taxon-intro">
      <div class="taxon-intro-header">
        <h2 class="taxon-intro-title">{{ taxonName }}</h2>
        <span class="taxon-level-badge">{{ level === 'family' ? '科' : '属' }}</span>
      </div>

      <!-- 描述 -->
      <div class="taxon-description-section" v-if="description">
        <div v-if="!editingDesc">
          <div v-if="description.description" class="taxon-description-text">
            {{ description.description }}
          </div>
          <div v-else class="taxon-desc-empty" @click="startEditDesc">
            点击添加描述
          </div>
          <button class="btn-edit-small" @click="startEditDesc" v-if="description.description">编辑</button>
        </div>
        <div v-else class="description-editor">
          <textarea v-model="descForm" rows="6" class="taxon-desc-textarea"></textarea>
          <div class="desc-actions">
            <button class="btn-save" @click="saveDesc">保存</button>
            <button class="btn-cancel" @click="editingDesc = false">取消</button>
          </div>
        </div>
      </div>

      <!-- 检索表:叶节点已渲染成物种卡片,有 key 时不再独立列出物种 -->
      <div v-if="hasKey || editingKey">
        <div class="taxon-key-toolbar" v-if="!editingKey">
          <button class="btn-edit-small" @click="startEditKey">编辑检索表</button>
        </div>
        <dichotomous-key
          v-if="hasKey && !editingKey"
          :key-text="description ? description.key_text : ''"
          :key-data="parsedKeyData"
          :level="level"
          :genus-context="level === 'genus' ? taxonName : ''"
          @navigate="$emit('navigate-key', $event)"
          @navigate-plant="$emit('select-plant', $event)"
        ></dichotomous-key>
        <div class="key-editor" v-if="editingKey">
          <label>检索表文本（FOC 原始格式，每行一项 "Na. 描述 ... 目标"）</label>
          <textarea v-model="keyForm" rows="14" placeholder="1a. 叶基生 ... 2&#10;1b. 叶非基生 ... 3&#10;2a. 花序顶生 ... Genus1&#10;2b. 花序腋生 ... Genus2"></textarea>
          <div class="key-editor-help">保存后会自动重新解析检索表树结构。</div>
          <div class="key-editor-actions">
            <button class="btn-save" @click="saveKey">保存</button>
            <button class="btn-cancel" @click="editingKey = false">取消</button>
          </div>
        </div>
      </div>

      <!-- A2 回退:无检索表时才展示物种列表 -->
      <div class="taxon-species-section" v-else-if="plants.length > 0">
        <h3 class="taxon-species-title">
          {{ level === 'family' ? '科下物种' : '此属无检索表,共' }}
          <span class="taxon-species-count">{{ plants.length }} 种</span>
        </h3>
        <div class="card-grid">
          <div v-for="plant in plants" :key="plant.id"
               class="plant-card" @click="$emit('select-plant', plant)">
            <div class="card-image">
              <img v-if="plant.primary_photo_url" :src="plant.primary_photo_url"
                   :alt="plant.chinese_name" loading="lazy">
              <div v-else class="card-image-placeholder"><span>🌿</span></div>
            </div>
            <div class="card-info">
              <div class="card-name">{{ plant.chinese_name || '未命名' }}</div>
              <div class="card-latin"><i>{{ plant.latin_name }}</i></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  setup(props, { emit }) {
    const editingDesc = ref(false);
    const descForm = ref('');
    const editingKey = ref(false);
    const keyForm = ref('');

    const parsedKeyData = computed(() => {
      if (!props.description || !props.description.key_data) return [];
      try {
        const data = JSON.parse(props.description.key_data);
        return Array.isArray(data) ? data : [];
      } catch { return []; }
    });

    const hasKey = computed(() => {
      if (!props.description) return false;
      const kt = props.description.key_text;
      if (kt && kt.trim().length > 0) return true;
      return parsedKeyData.value.length > 0;
    });

    function startEditDesc() {
      descForm.value = props.description?.description || '';
      editingDesc.value = true;
    }

    function saveDesc() {
      emit('save-description', {
        id: props.description.id,
        field: 'description',
        value: descForm.value
      });
      editingDesc.value = false;
    }

    function startEditKey() {
      keyForm.value = props.description?.key_text || '';
      editingKey.value = true;
    }

    function saveKey() {
      const text = keyForm.value;
      // 重新解析检索表
      const parsed = (typeof FOCParser !== 'undefined' && FOCParser.parseDichotomousKey)
        ? FOCParser.parseDichotomousKey(text)
        : [];
      emit('save-description', {
        id: props.description?.id,
        taxon_level: props.level,
        taxon_name: props.taxonName,
        field: 'key_text',
        value: text,
        key_data: JSON.stringify(parsed)
      });
      editingKey.value = false;
    }

    return { editingDesc, descForm, parsedKeyData, hasKey,
             editingKey, keyForm, startEditKey, saveKey,
             startEditDesc, saveDesc };
  }
};

// ==================== 全屏分类导航与检索表 ====================

const TaxonomyExplorerComponent = {
  name: 'TaxonomyExplorer',
  props: {
    visible: { type: Boolean, default: false },
    tree: { type: Object, required: true },
    initialTaxon: { type: Object, default: null }
  },
  emits: ['close', 'navigate-plant', 'revise', 'add-taxon'],
  template: `
    <div class="explorer-overlay" v-show="visible">
      <div class="explorer">
        <div class="explorer-header explorer-header-clean">
          <button class="explorer-back-btn" @click="$emit('close')" title="返回">
            <span>&larr;</span> 返回
          </button>
          <h2 class="explorer-heading">分类导航与检索表 <span class="explorer-heading-latin">Taxonomy &amp; Keys</span></h2>
          <div class="explorer-header-rule"></div>
        </div>
        <div class="explorer-body">
          <aside class="explorer-tree-panel">
            <div class="explorer-tree-header">分类树 Taxa</div>
            <div class="explorer-tree-scroll">
              <taxonomy-tree
                :tree="tree"
                :selected-path="selectedPath"
                @select="onTreeSelect"
              ></taxonomy-tree>
            </div>
          </aside>
          <main class="explorer-content-panel" ref="contentPanel">
            <div v-if="!currentView" class="explorer-placeholder">
              <div class="explorer-placeholder-icon">🔍</div>
              <p class="explorer-placeholder-text">在左侧分类树中选择一个科或属</p>
              <p class="explorer-placeholder-hint">查看形态描述和交互式检索表</p>
            </div>
            <div v-else class="explorer-content">
              <nav class="explorer-nav" v-if="viewStack.length > 1">
                <template v-for="(v, i) in viewStack" :key="i">
                  <span class="explorer-nav-item"
                        :class="{ current: i === viewStack.length - 1 }"
                        @click="goToView(i)">{{ v.displayName }}</span>
                  <span v-if="i < viewStack.length - 1" class="explorer-nav-sep">›</span>
                </template>
              </nav>

              <header class="explorer-title-section">
                <div>
                  <h2 class="explorer-taxon-name">{{ currentTaxonZh }}</h2>
                  <p class="explorer-taxon-latin" v-if="currentTaxonLatin">
                    <i>{{ currentTaxonLatin }}</i>
                    <span v-if="currentTaxonAuthority"> {{ currentTaxonAuthority }}</span>
                  </p>
                </div>
                <span class="explorer-level-badge">{{ currentView.level === 'family' ? '科 Family' : '属 Genus' }}</span>
              </header>

              <div class="explorer-rule"></div>

              <!-- 统计：family 显示 4 格，genus 显示 3 格 -->
              <div class="explorer-stats-row" :class="{ 'cols-3': currentView.level === 'genus' }">
                <div class="ex-stat" v-if="currentView.level === 'family'">
                  <span class="ex-stat-num">{{ stats.genera }}</span><span class="ex-stat-lbl">属 Genera</span>
                </div>
                <div class="ex-stat"><span class="ex-stat-num">{{ stats.species }}</span><span class="ex-stat-lbl">种 Species</span></div>
                <div class="ex-stat"><span class="ex-stat-num">{{ stats.provinces }}</span><span class="ex-stat-lbl">省级分布 Provinces</span></div>
                <div class="ex-stat"><span class="ex-stat-num">{{ stats.photos }}</span><span class="ex-stat-lbl">照片 Photos</span></div>
              </div>

              <!-- 修订 + 新增按钮（独立一行） -->
              <div class="explorer-taxon-actions">
                <button class="btn-revise btn-revise-sm"
                        @click="$emit('revise', { targetLevel: currentView.level, targetTaxonName: currentView.latinName })">
                  修订{{ currentView.level === 'family' ? '科' : '属' }}
                </button>
                <button class="btn-quick-add btn-quick-add-sm"
                        @click="$emit('add-taxon', { parentLevel: currentView.level, parentName: currentView.latinName })">
                  + 新增{{ currentView.level === 'family' ? '属' : '种' }}
                </button>
              </div>

              <!-- 形态描述 -->
              <section v-if="currentView.description && currentView.description.description && !editingDesc">
                <header class="explorer-section-head">
                  <span class="explorer-section-mark">¶</span>
                  <h3 class="explorer-section-title-h">形态描述 Morphology</h3>
                  <button class="btn-edit-small" @click="startEditDesc">编辑</button>
                </header>
                <div class="explorer-description">
                  <p>{{ currentView.description.description }}</p>
                </div>
              </section>
              <section v-else-if="!currentView.description?.description && !editingDesc">
                <header class="explorer-section-head">
                  <span class="explorer-section-mark">¶</span>
                  <h3 class="explorer-section-title-h">形态描述 Morphology</h3>
                  <button class="btn-edit-small" @click="startEditDesc">添加描述</button>
                </header>
              </section>
              <section v-if="editingDesc">
                <header class="explorer-section-head">
                  <span class="explorer-section-mark">¶</span>
                  <h3 class="explorer-section-title-h">编辑形态描述</h3>
                </header>
                <div class="description-editor">
                  <textarea v-model="descForm" rows="6" class="taxon-desc-textarea" placeholder="形态描述..."></textarea>
                  <div class="desc-actions">
                    <button class="btn-save" @click="saveDesc">保存</button>
                    <button class="btn-cancel" @click="editingDesc = false">取消</button>
                  </div>
                </div>
              </section>

              <!-- 检索表 -->
              <section class="explorer-key-section" v-if="hasKey || editingKey">
                <header class="explorer-section-head">
                  <span class="explorer-section-mark">⌖</span>
                  <h3 class="explorer-section-title-h">{{ currentView.level === 'family' ? '属检索表 Key to Genera' : '种检索表 Key to Species' }}</h3>
                  <button v-if="!editingKey" class="btn-edit-small" @click="startEditKey">编辑</button>
                </header>
                <dichotomous-key
                  v-if="hasKey && !editingKey"
                  :key-text="currentView.description ? currentView.description.key_text : ''"
                  :key-data="keyData"
                  :level="currentView.level"
                  :genus-context="currentView.level === 'genus' ? currentView.latinName : ''"
                  @navigate="onKeyResult"
                  @navigate-plant="$emit('navigate-plant', $event)"
                ></dichotomous-key>
                <div class="key-editor" v-if="editingKey">
                  <label>检索表文本（FOC 原始格式，每行一项 "Na. 描述 ... 目标"）</label>
                  <textarea v-model="keyForm" rows="14" placeholder="1a. 叶基生 ... 2&#10;1b. 叶非基生 ... 3"></textarea>
                  <div class="key-editor-help">保存后会自动重新解析检索表树结构。</div>
                  <div class="key-editor-actions">
                    <button class="btn-save" @click="saveKey">保存</button>
                    <button class="btn-cancel" @click="editingKey = false">取消</button>
                  </div>
                </div>
              </section>

              <!-- 物种列表 -->
              <section class="explorer-species-section" v-if="hasKey && !keyHasResolvableLeaves && speciesList.length > 0">
                <header class="explorer-section-head">
                  <span class="explorer-section-mark">◇</span>
                  <h3 class="explorer-section-title-h">本库收录的物种 <span class="explorer-species-count">{{ speciesList.length }} 种</span></h3>
                </header>
                <div class="explorer-species-list">
                  <div v-for="sp in speciesList" :key="sp.id"
                       class="explorer-species-item"
                       @click="$emit('navigate-plant', sp)">
                    <span class="esp-name">{{ sp.chinese_name || '—' }}</span>
                    <span class="esp-latin"><i>{{ sp.latin_name }}</i></span>
                  </div>
                </div>
              </section>
              <section class="explorer-species-section" v-else-if="speciesList.length > 0 && !hasKey">
                <header class="explorer-section-head">
                  <span class="explorer-section-mark">◇</span>
                  <h3 class="explorer-section-title-h">{{ currentView.level === 'family' ? '科下物种' : '本属物种' }} <span class="explorer-species-count">{{ speciesList.length }} 种</span></h3>
                </header>
                <div class="explorer-species-list">
                  <div v-for="sp in speciesList" :key="sp.id"
                       class="explorer-species-item"
                       @click="$emit('navigate-plant', sp)">
                    <span class="esp-name">{{ sp.chinese_name || '—' }}</span>
                    <span class="esp-latin"><i>{{ sp.latin_name }}</i></span>
                  </div>
                </div>
              </section>
              <div v-else-if="!hasKey && speciesList.length === 0" class="explorer-placeholder">
                <p class="explorer-placeholder-text">该分类下暂无检索表或物种数据</p>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  `,
  setup(props, { emit }) {
    const selectedPath = ref([]);
    const viewStack = ref([]);
    const currentView = ref(null);
    const speciesList = ref([]);
    const contentPanel = ref(null);

    const keyData = computed(() => {
      if (!currentView.value?.description?.key_data) return [];
      try {
        const d = JSON.parse(currentView.value.description.key_data);
        return Array.isArray(d) ? d : [];
      } catch { return []; }
    });

    const hasKey = computed(() => {
      const desc = currentView.value?.description;
      if (!desc) return false;
      return (desc.key_text && desc.key_text.trim().length > 0) || keyData.value.length > 0;
    });

    // 拆分 "兰科 Orchidaceae Juss." → { zh, latin, authority }
    function splitTaxonName(s) {
      if (!s) return { zh: '', latin: '', authority: '' };
      const m = s.match(/^([^\sA-Za-z]+)?\s*([A-Za-z]+(?:eae|ales|inae|inea|aceae)?)(?:\s+(.+))?$/);
      if (m) return { zh: (m[1] || '').trim(), latin: (m[2] || '').trim(), authority: (m[3] || '').trim() };
      return { zh: s, latin: '', authority: '' };
    }
    const currentTaxonZh = computed(() => {
      if (!currentView.value) return '';
      return splitTaxonName(currentView.value.displayName).zh || currentView.value.latinName;
    });
    const currentTaxonLatin = computed(() => {
      if (!currentView.value) return '';
      return splitTaxonName(currentView.value.displayName).latin || currentView.value.latinName;
    });
    const currentTaxonAuthority = computed(() => {
      if (!currentView.value) return '';
      return splitTaxonName(currentView.value.displayName).authority || '';
    });

    // 统计：属数 / 种数 / 省级分布数 / 照片数
    const stats = computed(() => {
      const v = currentView.value;
      if (!v || !BotanicalDB.db) return { genera: 0, species: 0, provinces: 0, photos: 0 };
      try {
        const lvl = v.level === 'genus' ? 'genus' : 'family';
        const colName = lvl === 'family' ? 'family' : 'genus';
        const countSpecies = BotanicalDB.db.exec(
          `SELECT COUNT(*) FROM plants WHERE ${colName} = ? AND (status IS NULL OR status='approved')`,
          [v.value]
        )[0]?.values?.[0]?.[0] || 0;
        let countGenera = 0;
        if (lvl === 'family') {
          countGenera = BotanicalDB.db.exec(
            `SELECT COUNT(DISTINCT genus) FROM plants WHERE family = ? AND genus IS NOT NULL AND (status IS NULL OR status='approved')`,
            [v.value]
          )[0]?.values?.[0]?.[0] || 0;
        }
        const countProvinces = BotanicalDB.db.exec(
          `SELECT COUNT(DISTINCT ph.province_code) FROM photos ph
           JOIN plants p ON p.id = ph.plant_id
           WHERE p.${colName} = ? AND ph.province_code IS NOT NULL AND ph.province_code != ''`,
          [v.value]
        )[0]?.values?.[0]?.[0] || 0;
        const countPhotos = BotanicalDB.db.exec(
          `SELECT COUNT(*) FROM photos ph
           JOIN plants p ON p.id = ph.plant_id
           WHERE p.${colName} = ?`,
          [v.value]
        )[0]?.values?.[0]?.[0] || 0;
        return { genera: countGenera, species: countSpecies, provinces: countProvinces, photos: countPhotos };
      } catch (e) {
        return { genera: 0, species: 0, provinces: 0, photos: 0 };
      }
    });

    // 检索表是否有可解析到物种/属的叶节点。用于判断是否需要补充显示扁平列表
    // (比如兰科 key 指向亚科时,没有属级叶节点可渲染成卡片)
    const keyHasResolvableLeaves = computed(() => {
      const kt = currentView.value?.description?.key_text || '';
      if (!kt.trim()) return false;
      // 行尾是 "N. Genus" 或 "N. A. species" 这种就能当 leaf 渲染
      return /\.{2,}\s*\d*\.?\s*(?:[A-Z]\.\s+[a-z]+|[A-Z][a-z]+(?:\s+[a-z]+)?)\s*$/m.test(kt);
    });

    function onTreeSelect({ level, value, label }) {
      selectedPath.value = [value];
      if (level === 'family' || level === 'genus') {
        const latinName = value.match(/[A-Z][a-z]+(?:aceae|eae)?/)?.[0] || value;
        const desc = BotanicalDB.getTaxonomyDescription(level, latinName);
        const plants = BotanicalDB.getPlantsByTaxon(level, value);
        const view = { level, value, displayName: label || value, latinName, description: desc };
        viewStack.value = [view];
        currentView.value = view;
        speciesList.value = plants;
        if (contentPanel.value) contentPanel.value.scrollTop = 0;
      }
    }

    function onKeyResult(taxonName) {
      const desc = BotanicalDB.getTaxonomyDescription('genus', taxonName);
      if (desc) {
        const plants = BotanicalDB.getPlantsByTaxon('genus', taxonName);
        const view = { level: 'genus', value: taxonName, displayName: taxonName, latinName: taxonName, description: desc };
        viewStack.value = [...viewStack.value, view];
        currentView.value = view;
        speciesList.value = plants;
        if (contentPanel.value) contentPanel.value.scrollTop = 0;
      } else {
        const results = BotanicalDB.search(taxonName);
        if (results.length === 1) {
          emit('navigate-plant', results[0]);
        } else if (results.length > 0) {
          speciesList.value = results;
        }
      }
    }

    function goToView(index) {
      viewStack.value = viewStack.value.slice(0, index + 1);
      currentView.value = viewStack.value[index];
      speciesList.value = BotanicalDB.getPlantsByTaxon(currentView.value.level, currentView.value.value);
      if (contentPanel.value) contentPanel.value.scrollTop = 0;
    }

    function onEsc(e) {
      if (e.key === 'Escape' && props.visible) emit('close');
    }
    onMounted(() => document.addEventListener('keydown', onEsc));

    // 从物种详情页的分类链接跳转进来时，自动定位到对应科/属
    watch(() => [props.visible, props.initialTaxon], ([vis, taxon]) => {
      if (vis && taxon && taxon.level && taxon.value) {
        onTreeSelect({ level: taxon.level, value: taxon.value, label: taxon.value });
      }
    }, { immediate: true });

    // v3: 描述与检索表编辑
    const editingDesc = ref(false);
    const editingKey = ref(false);
    const descForm = ref('');
    const keyForm = ref('');

    function startEditDesc() {
      descForm.value = currentView.value?.description?.description || '';
      editingDesc.value = true;
    }

    function saveDesc() {
      const view = currentView.value;
      if (!view) return;
      BotanicalDB.saveTaxonomyDescription({
        taxon_level: view.level,
        taxon_name: view.latinName,
        family: view.level === 'family' ? view.latinName : (view.description?.family || ''),
        description: descForm.value,
        key_data: view.description?.key_data || '[]',
        key_text: view.description?.key_text || '',
        references_text: view.description?.references_text || ''
      });
      BotanicalDB.saveDB();
      // 刷新当前 view 的 description
      view.description = BotanicalDB.getTaxonomyDescription(view.level, view.latinName);
      editingDesc.value = false;
    }

    function startEditKey() {
      keyForm.value = currentView.value?.description?.key_text || '';
      editingKey.value = true;
    }

    function saveKey() {
      const view = currentView.value;
      if (!view) return;
      const text = keyForm.value;
      const parsed = (typeof FOCParser !== 'undefined' && FOCParser.parseDichotomousKey)
        ? FOCParser.parseDichotomousKey(text)
        : [];
      BotanicalDB.saveTaxonomyDescription({
        taxon_level: view.level,
        taxon_name: view.latinName,
        family: view.level === 'family' ? view.latinName : (view.description?.family || ''),
        description: view.description?.description || '',
        key_data: JSON.stringify(parsed),
        key_text: text,
        references_text: view.description?.references_text || ''
      });
      BotanicalDB.saveDB();
      view.description = BotanicalDB.getTaxonomyDescription(view.level, view.latinName);
      editingKey.value = false;
    }

    return {
      selectedPath, viewStack, currentView, speciesList, keyData, hasKey,
      keyHasResolvableLeaves, contentPanel,
      onTreeSelect, onKeyResult, goToView,
      editingDesc, editingKey, descForm, keyForm,
      startEditDesc, saveDesc, startEditKey, saveKey,
      currentTaxonZh, currentTaxonLatin, currentTaxonAuthority, stats
    };
  }
};

// ==================== 植物详情组件（含 V2 增强） ====================

const PlantDetailComponent = {
  name: 'PlantDetail',
  props: {
    plant: { type: Object, required: true },
    photos: { type: Array, default: () => [] },
    infraspecificTaxa: { type: Array, default: () => [] },
    parentPlant: { type: Object, default: null }
  },
  emits: ['back', 'delete-plant', 'delete-photo', 'save-photo-meta', 'save-description', 'revise',
          'open-foc-import',
          'add-photos', 'save-field', 'open-infraspecific', 'open-parent', 'navigate-taxonomy'],
  template: `
    <div class="plant-detail">
      <!-- 标题（标本馆风：eyebrow + 大标题 + latin-line + actions） -->
      <header class="detail-header detail-header-v2">
        <button class="detail-back" @click="$emit('back')" title="返回">&larr;</button>
        <div class="detail-title-block">
          <div class="detail-eyebrow" v-if="plant.family || plant.genus">
            <span v-if="plant.family">{{ plant.family }}</span>
            <span v-if="plant.family && plant.genus"> · </span>
            <span v-if="plant.genus"><i>{{ plant.genus }}</i></span>
          </div>
          <h2 class="detail-title">{{ plant.chinese_name || '未命名' }}<span class="infra-rank-badge" v-if="plant.infraspecific_rank" style="margin-left:10px;font-size:0.5em;vertical-align:middle">{{ plant.infraspecific_rank }}</span></h2>
          <p class="detail-latin-line">
            <i class="detail-latin latin-clickable-name">
              <template v-for="(token, i) in latinTokens" :key="i">
                <span v-if="token.isWord" class="latin-word" @click.stop="showLatinPopover(token.word, $event)">{{ token.text }}</span>
                <span v-else>{{ token.text }}</span>
              </template>
            </i>
            <span class="detail-author" v-if="plant.authority">&nbsp;{{ plant.authority }}</span>
          </p>
        </div>
        <div class="detail-actions">
          <button class="btn-revise" @click="$emit('revise', { targetLevel: 'species', targetPlant: plant })" title="修订此物种的分类归属">修订</button>
          <button class="btn-delete-plant" @click="confirmDeletePlant" title="删除此植物">删除</button>
        </div>
      </header>

      <!-- 种下分类的面包屑 -->
      <div class="infra-breadcrumb" v-if="parentPlant">
        <span class="infra-breadcrumb-link" @click="$emit('open-parent', parentPlant)">
          {{ parentPlant.chinese_name || parentPlant.latin_name }}
        </span>
        <span class="breadcrumb-sep"> &rsaquo; </span>
        <span>{{ plant.chinese_name || plant.latin_name }}</span>
      </div>

      <div class="detail-body detail-body-v2">
        <!-- 左侧：照片画廊 + plant-prose -->
        <div class="detail-left">
          <!-- 无照片时的添加入口 -->
          <div class="photo-empty" v-if="photos.length === 0">
            <div class="photo-empty-icon">📷</div>
            <p>暂无照片</p>
            <button class="btn-add-photo" @click="$refs.photoInput.click()">添加照片</button>
            <input type="file" ref="photoInput" accept="image/*" multiple style="display:none" @change="onAddPhotos">
          </div>

          <!-- 照片画廊 -->
          <div class="photo-gallery" v-if="photos.length > 0">
            <div class="gallery-main">
              <img :src="currentPhoto.image_url || ''" :alt="plant.chinese_name">
            </div>
            <div class="gallery-caption">
              <span>
                <span style="font-style:normal">{{ ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩'][currentPhotoIndex] || ('#' + (currentPhotoIndex+1)) }}</span>
                <span v-if="currentPhoto.admin_division || currentPhoto.location"> {{ currentPhoto.admin_division || currentPhoto.location }}</span>
                <span v-if="currentPhoto.location_detail"> · {{ currentPhoto.location_detail }}</span>
                <span v-if="currentPhoto.shot_date"> / {{ currentPhoto.shot_date }}</span>
              </span>
              <span class="gallery-photographer" v-if="currentPhoto.photographer">— {{ currentPhoto.photographer }}</span>
            </div>
            <div class="gallery-thumbs-row">
              <div class="gallery-thumbs" v-if="photos.length > 1">
                <div v-for="(photo, i) in photos" :key="photo.id"
                     class="gallery-thumb" :class="{ active: i === currentPhotoIndex }"
                     @click="currentPhotoIndex = i">
                  <img :src="photo.image_url || ''" :alt="'照片 ' + (i+1)">
                  <span class="thumb-delete" @click.stop="confirmDeletePhoto(photo, i)" title="删除此照片">&times;</span>
                </div>
              </div>
              <button class="btn-add-photo-thumb" @click="$refs.photoInputGallery.click()" title="添加更多照片">＋</button>
              <input type="file" ref="photoInputGallery" accept="image/*" multiple style="display:none" @change="onAddPhotos">
            </div>
            <div class="single-photo-actions" v-if="photos.length === 1">
              <button class="btn-delete-photo-single" @click="confirmDeletePhoto(photos[0], 0)">删除此照片</button>
            </div>

            <!-- 照片元数据编辑（折叠） -->
            <div class="photo-meta-form" v-if="editingMeta">
              <div class="meta-form-row"><label>拍摄者</label><input type="text" v-model="metaForm.photographer" placeholder="拍摄者姓名"></div>
              <div class="meta-form-row meta-form-row-block">
                <label>行政区划</label>
                <admin-picker v-model="adminPickerModel"></admin-picker>
              </div>
              <div class="meta-form-row"><label>拍摄时间</label><input type="date" v-model="metaForm.shot_date"></div>
              <div class="meta-form-actions">
                <button class="btn-save" @click="savePhotoMeta">保存</button>
                <button class="btn-cancel" @click="editingMeta = false">取消</button>
              </div>
            </div>
            <button v-else class="btn-edit-meta" @click="startEditMeta">编辑照片信息</button>
          </div>

          <!-- 主要内容：plant-prose -->
          <article class="plant-prose">
            <!-- 形态描述 -->
            <header class="prose-h-row">
              <h3 class="prose-h">形态描述 <span class="prose-h-en">Morphology</span>
                <span class="lang-tabs" v-if="hasBilingualDesc" style="margin-left:12px">
                  <button class="lang-tab" :class="{ active: descLang === 'zh' }" @click="descLang = 'zh'">中</button>
                  <button class="lang-tab" :class="{ active: descLang === 'en' }" @click="descLang = 'en'">EN</button>
                </span>
                <button class="btn-edit-small" v-if="!editingDesc" @click="startEditDesc">编辑</button>
                <button class="btn-edit-small btn-foc-import" v-if="showFOCImportPrompt" @click="$emit('open-foc-import', { family: familyLatinName })">从 FOC 导入</button>
              </h3>
            </header>
            <div v-if="!editingDesc">
              <p class="prose-lead" v-if="displayDescription">{{ displayDescription }}</p>
              <p v-else class="prose-lead" style="color:var(--color-text-muted);font-style:italic;cursor:pointer" @click="startEditDesc">点击添加形态描述...</p>
            </div>
            <div v-else class="description-editor">
              <textarea v-model="descForm" placeholder="输入物种形态描述..." rows="6"></textarea>
              <div class="desc-actions">
                <button class="btn-save" @click="saveDescription">保存</button>
                <button class="btn-cancel" @click="editingDesc = false">取消</button>
              </div>
            </div>

            <!-- 生境与分布 -->
            <h3 class="prose-h" v-if="ecologyDisplay.habitat || ecologyDisplay.altitude || ecologyDisplay.distribution">
              生境与分布 <span class="prose-h-en">Habitat &amp; Distribution</span>
            </h3>
            <div class="prose-fact-row" v-if="ecologyDisplay.habitat || ecologyDisplay.altitude || ecologyDisplay.distribution">
              <div class="prose-fact" v-if="ecologyDisplay.habitat"><span class="pf-k">生境</span><span class="pf-v">{{ ecologyDisplay.habitat }}</span></div>
              <div class="prose-fact" v-if="ecologyDisplay.altitude"><span class="pf-k">海拔</span><span class="pf-v">{{ ecologyDisplay.altitude }}</span></div>
              <div class="prose-fact" v-if="ecologyDisplay.distribution"><span class="pf-k">分布</span><span class="pf-v">{{ ecologyDisplay.distribution }}</span></div>
            </div>

            <!-- 种下分类 -->
            <template v-if="infraspecificTaxa.length > 0">
              <h3 class="prose-h">种下分类 <span class="prose-h-en">Infraspecific Taxa</span></h3>
              <ul class="infra-list infra-list-v2">
                <li v-for="taxon in infraspecificTaxa" :key="taxon.id"
                    class="infra-item" @click="$emit('open-infraspecific', taxon)">
                  <span class="infra-rank-tag">{{ taxon.infraspecific_rank }}</span>
                  <span class="infra-latin"><i>{{ taxon.latin_name }}</i></span>
                  <span class="infra-cn" v-if="taxon.chinese_name">{{ taxon.chinese_name }}</span>
                </li>
              </ul>
            </template>

            <!-- 照片记录表 -->
            <template v-if="photos.length > 0">
              <h3 class="prose-h">照片记录 <span class="prose-h-en">Photo Records</span></h3>
              <table class="photo-info-table">
                <thead><tr><th>#</th><th>行政区划</th><th>具体地点</th><th>拍摄时间</th><th>拍摄者</th></tr></thead>
                <tbody>
                  <tr v-for="(photo, i) in photos" :key="photo.id"
                      :class="{ 'active-photo': i === currentPhotoIndex }" @click="currentPhotoIndex = i">
                    <td>{{ i + 1 }}</td>
                    <td>{{ photo.admin_division || photo.location || '—' }}</td>
                    <td>{{ photo.location_detail || '—' }}</td>
                    <td>{{ photo.shot_date || '—' }}</td>
                    <td>{{ photo.photographer || '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </template>
          </article>
        </div>

        <!-- 右侧：Infobox（标本馆样式：深色 header + 缩略图 + 分类 + 命名 + 异名） -->
        <aside class="infobox infobox-v2">
          <div class="infobox-header">
            <div class="infobox-header-cn">{{ plant.chinese_name || plant.latin_name }}</div>
            <div class="infobox-header-latin" v-if="plant.chinese_name"><i>{{ latinNameOnly }}</i></div>
          </div>

          <!-- 缩略图 -->
          <div class="infobox-photo" v-if="currentPhoto.image_url">
            <img :src="currentPhoto.image_url" :alt="plant.chinese_name">
          </div>

          <!-- 分类 -->
          <div class="infobox-section">
            <div class="infobox-section-title">分类 Classification</div>
            <div class="infobox-row" v-if="plant.kingdom"><span class="infobox-label">界</span><span class="infobox-value">{{ plant.kingdom }}</span></div>
            <div class="infobox-row" v-if="plant.phylum"><span class="infobox-label">门</span><span class="infobox-value infobox-taxon-link" @click="$emit('navigate-taxonomy', { level: 'phylum', value: plant.phylum })">{{ plant.phylum }}</span></div>
            <div class="infobox-row" v-if="plant.class"><span class="infobox-label">纲</span><span class="infobox-value infobox-taxon-link" @click="$emit('navigate-taxonomy', { level: 'class', value: plant.class })">{{ plant.class }}</span></div>
            <div class="infobox-row" v-if="plant.order"><span class="infobox-label">目</span><span class="infobox-value infobox-taxon-link" @click="$emit('navigate-taxonomy', { level: 'order', value: plant.order })">{{ plant.order }}</span></div>
            <div class="infobox-row" v-if="plant.family"><span class="infobox-label">科</span><span class="infobox-value infobox-taxon-link" @click="$emit('navigate-taxonomy', { level: 'family', value: plant.family })">{{ plant.family }}</span></div>
            <div class="infobox-row" v-if="plant.genus"><span class="infobox-label">属</span><span class="infobox-value infobox-taxon-link" @click="$emit('navigate-taxonomy', { level: 'genus', value: plant.genus })"><i>{{ plant.genus }}</i></span></div>
          </div>

          <!-- 命名 -->
          <div class="infobox-section" v-if="plant.authority || plant.species_epithet">
            <div class="infobox-section-title">命名 Naming</div>
            <div class="infobox-row" v-if="plant.authority"><span class="infobox-label">命名人</span><span class="infobox-value">{{ plant.authority }}</span></div>
            <div class="infobox-row" v-if="plant.species_epithet">
              <span class="infobox-label">种加词</span>
              <span class="infobox-value">
                <i><span class="latin-word" @click.stop="showLatinPopover(plant.species_epithet, $event)">{{ plant.species_epithet }}</span></i>
              </span>
            </div>
            <div class="infobox-row">
              <span class="infobox-label">学名</span>
              <span class="infobox-value">
                <i class="latin-clickable-name">
                  <template v-for="(token, i) in latinTokens" :key="'info-' + i">
                    <span v-if="token.isWord" class="latin-word" @click.stop="showLatinPopover(token.word, $event)">{{ token.text }}</span>
                    <span v-else>{{ token.text }}</span>
                  </template>
                </i>
              </span>
            </div>
          </div>

          <!-- 异名 -->
          <div class="infobox-section" v-if="synonymList.length > 0">
            <div class="infobox-section-title">异名 Synonyms</div>
            <p class="infobox-synonym" v-for="syn in synonymList" :key="syn">
              <i>{{ syn }}</i>
            </p>
          </div>

          <!-- 数据来源 -->
          <div class="infobox-section" v-if="ppbcIds.length > 0 || plant.data_source">
            <div class="infobox-section-title">数据来源 Source</div>
            <div class="infobox-row" v-if="plant.data_source"><span class="infobox-label">来源</span><span class="infobox-value">{{ plant.data_source }}</span></div>
            <div class="infobox-row" v-for="pid in ppbcIds" :key="pid">
              <span class="infobox-label">PPBC</span><span class="infobox-value">{{ pid }}</span>
            </div>
          </div>
        </aside>
      </div>

      <div v-if="latinPopover.visible"
           class="latin-popover"
           :style="{ left: latinPopover.x + 'px', top: latinPopover.y + 'px' }"
           @click.stop>
        <button class="latin-popover-close" @click="closeLatinPopover">&times;</button>
        <div class="latin-popover-word">{{ latinPopover.word }}</div>
        <div v-if="latinPopover.entries.length > 0">
          <div class="latin-popover-entry" v-for="entry in latinPopover.entries" :key="entry.id">
            <div class="latin-popover-cn" v-if="entry.chinese_meaning">{{ entry.chinese_meaning }}</div>
            <div class="latin-popover-en" v-if="entry.english_meaning">{{ entry.english_meaning }}</div>
            <div class="latin-popover-pron" v-if="entry.pronunciation">[{{ entry.pronunciation }}]</div>
          </div>
        </div>
        <div v-else class="latin-popover-empty">暂无词典记录</div>
      </div>

      <!-- 确认对话框 -->
      <div class="confirm-overlay" v-if="confirmAction" @click.self="confirmAction = null">
        <div class="confirm-dialog">
          <p>{{ confirmAction.message }}</p>
          <div class="confirm-actions">
            <button class="btn-confirm-yes" @click="confirmAction.onConfirm(); confirmAction = null">确认删除</button>
            <button class="btn-cancel" @click="confirmAction = null">取消</button>
          </div>
        </div>
      </div>
    </div>
  `,
  setup(props, { emit }) {
    const currentPhotoIndex = ref(0);
    const editingMeta = ref(false);
    const editingDesc = ref(false);
    const confirmAction = ref(null);
    const metaForm = ref({
      photographer: '', admin_division: '', location_detail: '', shot_date: '',
      country_code: 'CN', province_code: '', city_code: '', county_code: ''
    });
    const adminPickerModel = ref({});
    const descForm = ref('');
    const descLang = ref('zh');
    const latinPopover = ref({ visible: false, x: 0, y: 0, word: '', entries: [] });

    // v3: 双语展示
    const hasBilingualDesc = computed(() => {
      const p = props.plant;
      const hasZh = p.description_zh || (p.description && BilingualUtil.isMostlyChinese(p.description));
      const hasEn = p.description_en || (p.description && !BilingualUtil.isMostlyChinese(p.description));
      // 同时有 zh 段和 en 段时（无论独立字段还是混合）才显示 tabs
      if (p.description_zh && p.description_en) return true;
      if (p.description) {
        const split = BilingualUtil.split(p.description);
        return split.zh.length > 10 && split.en.length > 10;
      }
      return false;
    });

    const displayDescription = computed(() => {
      const p = props.plant;
      if (descLang.value === 'en') {
        if (p.description_en) return p.description_en;
        if (p.description) {
          const split = BilingualUtil.split(p.description);
          return split.en || p.description;
        }
        return '';
      }
      // zh
      if (p.description_zh) return p.description_zh;
      if (p.description) {
        if (hasBilingualDesc.value) {
          const split = BilingualUtil.split(p.description);
          return split.zh;
        }
        return p.description;
      }
      return '';
    });

    function pickByLang(zhField, enField, fallbackField) {
      const p = props.plant;
      if (descLang.value === 'en') {
        if (p[enField]) return p[enField];
        if (p[fallbackField]) {
          const split = BilingualUtil.split(p[fallbackField]);
          return split.en || (BilingualUtil.isMostlyChinese(p[fallbackField]) ? '' : p[fallbackField]);
        }
        return '';
      }
      if (p[zhField]) return p[zhField];
      if (p[fallbackField]) {
        const split = BilingualUtil.split(p[fallbackField]);
        return split.zh || (BilingualUtil.isMostlyChinese(p[fallbackField]) ? p[fallbackField] : '');
      }
      return '';
    }

    const ecologyDisplay = computed(() => ({
      habitat: pickByLang('description_habitat_zh', 'description_habitat_en', 'description_habitat'),
      altitude: pickByLang('description_altitude_zh', 'description_altitude_en', 'description_altitude'),
      distribution: pickByLang('description_distribution_zh', 'description_distribution_en', 'description_distribution')
    }));

    const currentPhoto = computed(() => props.photos[currentPhotoIndex.value] || {});
    const allLocations = computed(() => [...new Set(props.photos.map(p => p.admin_division || p.location).filter(Boolean))]);
    const allPhotographers = computed(() => [...new Set(props.photos.map(p => p.photographer).filter(Boolean))]);
    const ppbcIds = computed(() => props.photos.map(p => p.ppbc_id).filter(Boolean));

    // V2: 异名列表
    const synonymList = computed(() => {
      if (!props.plant.synonyms) return [];
      return props.plant.synonyms.split('\n').map(s => s.trim()).filter(Boolean);
    });

    // v3.1: 拉丁名拆出 author（避免 latin_name 末尾重复显示命名人）
    const latinNameOnly = computed(() => {
      const ln = props.plant.latin_name || '';
      const auth = props.plant.authority || '';
      if (auth && ln.endsWith(' ' + auth)) {
        return ln.slice(0, -auth.length).trim();
      }
      return ln;
    });

    const latinTokens = computed(() => {
      return (latinNameOnly.value || '').split(/(\s+)/).filter(Boolean).map(text => {
        const word = text.trim().replace(/^[×x]\s*/, '').replace(/[^A-Za-z-]/g, '').toLowerCase();
        return { text, word, isWord: !!word && /[A-Za-z]/.test(word) };
      });
    });

    const familyLatinName = computed(() => {
      return BotanicalDB._extractLatinTaxonName(props.plant.family) || props.plant.family || '';
    });

    const showFOCImportPrompt = computed(() => {
      if (displayDescription.value || !familyLatinName.value) return false;
      const familyDesc = BotanicalDB.getTaxonomyDescription('family', familyLatinName.value);
      return !familyDesc || !familyDesc.description;
    });

    function showLatinPopover(word, event) {
      const clean = (word || '').replace(/[^A-Za-z-]/g, '').toLowerCase();
      if (clean.length < 2) return;
      const entries = BotanicalDB.searchDictionary(clean);
      latinPopover.value = {
        visible: true,
        x: Math.min(event.clientX + 10, window.innerWidth - 300),
        y: Math.min(event.clientY + 12, window.innerHeight - 180),
        word: clean,
        entries
      };
    }

    function closeLatinPopover() {
      latinPopover.value = { visible: false, x: 0, y: 0, word: '', entries: [] };
    }

    function startEditMeta() {
      const p = currentPhoto.value;
      const rawLoc = (p.location || '').trim();
      const hasAdmCodes = !!(p.province_code || p.city_code || p.county_code);
      const seedDetail = (p.location_detail || '').trim()
        || (!hasAdmCodes && !p.admin_division && rawLoc ? rawLoc : '');
      metaForm.value = {
        photographer: p.photographer || '',
        admin_division: p.admin_division || '',
        location_detail: seedDetail,
        shot_date: p.shot_date || '',
        country_code: p.country_code || 'CN',
        province_code: p.province_code || '',
        city_code: p.city_code || '',
        county_code: p.county_code || ''
      };
      adminPickerModel.value = {
        country_code: metaForm.value.country_code,
        province_code: metaForm.value.province_code,
        city_code: metaForm.value.city_code,
        county_code: metaForm.value.county_code,
        location_detail: metaForm.value.location_detail,
        admin_division: metaForm.value.admin_division
      };
      editingMeta.value = true;
    }

    // adminPickerModel 同步到 metaForm
    watch(adminPickerModel, (val) => {
      if (!val) return;
      metaForm.value.country_code = val.country_code || 'CN';
      metaForm.value.province_code = val.province_code || '';
      metaForm.value.city_code = val.city_code || '';
      metaForm.value.county_code = val.county_code || '';
      metaForm.value.location_detail = val.location_detail || '';
      metaForm.value.admin_division = val.admin_division || '';
    }, { deep: true });

    function savePhotoMeta() {
      emit('save-photo-meta', { photoId: currentPhoto.value.id, data: { ...metaForm.value } });
      editingMeta.value = false;
    }

    function startEditDesc() {
      descForm.value = props.plant.description || '';
      editingDesc.value = true;
    }

    function saveDescription() {
      emit('save-description', { plantId: props.plant.id, description: descForm.value });
      editingDesc.value = false;
    }

    function confirmDeletePlant() {
      confirmAction.value = {
        message: `确定要删除「${props.plant.chinese_name || props.plant.latin_name}」及其所有照片吗？此操作不可撤销。`,
        onConfirm: () => emit('delete-plant', { plantId: props.plant.id })
      };
    }

    function confirmDeletePhoto(photo, index) {
      confirmAction.value = {
        message: `确定要删除第 ${index + 1} 张照片吗？`,
        onConfirm: () => {
          emit('delete-photo', { photoId: photo.id, plantId: props.plant.id });
        }
      };
    }

    function onAddPhotos(e) {
      const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
      if (files.length > 0) emit('add-photos', { plantId: props.plant.id, files });
      e.target.value = '';
    }

    watch(currentPhotoIndex, () => { editingMeta.value = false; });
    watch(() => props.plant.id, () => {
      currentPhotoIndex.value = 0;
      editingMeta.value = false;
      editingDesc.value = false;
      confirmAction.value = null;
      closeLatinPopover();
    });

    return {
      currentPhotoIndex, currentPhoto, editingMeta, editingDesc,
      confirmAction, metaForm, descForm, synonymList, latinNameOnly, latinTokens,
      adminPickerModel,
      descLang, hasBilingualDesc, displayDescription, ecologyDisplay,
      allLocations, allPhotographers, ppbcIds,
      familyLatinName, showFOCImportPrompt, latinPopover, showLatinPopover, closeLatinPopover,
      startEditMeta, savePhotoMeta, startEditDesc, saveDescription,
      confirmDeletePlant, confirmDeletePhoto, onAddPhotos
    };
  }
};

// ==================== V3: AdminPicker 行政区划级联选择器 ====================
const AdminPickerComponent = {
  props: {
    modelValue: { type: Object, default: () => ({}) }
  },
  emits: ['update:modelValue'],
  template: `
    <div class="admin-picker">
      <div class="admin-picker-row">
        <select class="admin-picker-select" disabled>
          <option>中国</option>
        </select>
        <select class="admin-picker-select" v-model="provinceCode" @change="onProvinceChange">
          <option value="">省/直辖市/自治区...</option>
          <option v-for="p in provinces" :key="p.code" :value="p.code">{{ p.name_zh }}</option>
        </select>
        <select class="admin-picker-select" v-model="cityCode" @change="onCityChange" :disabled="!provinceCode">
          <option value="">市/地区...</option>
          <option v-for="c in cities" :key="c.code" :value="c.code">{{ c.name_zh }}</option>
        </select>
        <select class="admin-picker-select" v-model="countyCode" @change="onCountyChange" :disabled="!cityCode">
          <option value="">县/区...</option>
          <option v-for="x in counties" :key="x.code" :value="x.code">{{ x.name_zh }}</option>
        </select>
      </div>
      <input type="text" class="admin-picker-detail" v-model="locationDetail"
             @input="emitChange" placeholder="小地点（如：城西 5km 路边）">
      <div class="admin-picker-preview" v-if="displayText">{{ displayText }}</div>
    </div>
  `,
  setup(props, { emit }) {
    const { ref, computed, watch } = Vue;
    const provinceCode = ref(props.modelValue.province_code || '');
    const cityCode = ref(props.modelValue.city_code || '');
    const countyCode = ref(props.modelValue.county_code || '');
    const locationDetail = ref(props.modelValue.location_detail || '');

    const provinces = ref(BotanicalDB.getAdminDivisions('CN'));
    const cities = ref([]);
    const counties = ref([]);

    function reloadCities() {
      cities.value = provinceCode.value ? BotanicalDB.getAdminDivisions(provinceCode.value) : [];
    }
    function reloadCounties() {
      counties.value = cityCode.value ? BotanicalDB.getAdminDivisions(cityCode.value) : [];
    }
    reloadCities();
    reloadCounties();

    const displayText = computed(() => {
      const parts = [];
      const p = provinces.value.find(x => x.code === provinceCode.value);
      const c = cities.value.find(x => x.code === cityCode.value);
      const x = counties.value.find(x => x.code === countyCode.value);
      if (p) parts.push(p.name_zh);
      if (c) parts.push(c.name_zh);
      if (x) parts.push(x.name_zh);
      if (locationDetail.value) parts.push(locationDetail.value);
      return parts.join(' · ');
    });

    function onProvinceChange() {
      cityCode.value = '';
      countyCode.value = '';
      reloadCities();
      counties.value = [];
      emitChange();
    }
    function onCityChange() {
      countyCode.value = '';
      reloadCounties();
      emitChange();
    }
    function onCountyChange() { emitChange(); }

    function emitChange() {
      emit('update:modelValue', {
        country_code: 'CN',
        province_code: provinceCode.value || null,
        city_code: cityCode.value || null,
        county_code: countyCode.value || null,
        location_detail: locationDetail.value || null,
        admin_division: displayText.value || null
      });
    }

    // 监听外部 modelValue 变化（如切换照片时重置表单）
    watch(() => props.modelValue, (val) => {
      provinceCode.value = val.province_code || '';
      cityCode.value = val.city_code || '';
      countyCode.value = val.county_code || '';
      locationDetail.value = val.location_detail || '';
      reloadCities();
      reloadCounties();
    });

    return { provinces, cities, counties, provinceCode, cityCode, countyCode,
             locationDetail, displayText, onProvinceChange, onCityChange,
             onCountyChange, emitChange };
  }
};

// ==================== V3: PendingQueue 审定队列页 ====================
const PendingQueueComponent = {
  props: {
    visible: { type: Boolean, default: false }
  },
  emits: ['close', 'refresh'],
  template: `
    <div v-if="visible" class="pending-queue-overlay" @click.self="$emit('close')">
      <div class="pending-queue-panel">
        <div class="pending-queue-header">
          <h2>审定队列 <span class="pending-queue-heading-latin">Pending Review</span></h2>
          <div class="pending-queue-tabs lang-tabs">
            <button class="lang-tab" :class="{ active: tab === 'pending' }" @click="tab = 'pending'">待审定 · {{ countPending }}</button>
            <button class="lang-tab" :class="{ active: tab === 'approved' }" @click="tab = 'approved'">已通过</button>
            <button class="lang-tab" :class="{ active: tab === 'merged' }" @click="tab = 'merged'">已归并</button>
          </div>
          <button class="modal-close" @click="$emit('close')">&times;</button>
        </div>
        <div class="pending-queue-body">
          <div v-if="items.length === 0" class="pending-empty">
            <div class="pending-empty-stamp">⊕</div>
            <p>暂无{{ tab === 'pending' ? '待审定' : tab === 'approved' ? '已通过' : '已归并' }}的项目</p>
            <p class="pending-empty-hint" v-if="tab === 'pending'">上传新拉丁名的图片或手动新增物种后会出现在这里</p>
          </div>
          <pending-card
            v-for="item in items"
            :key="item.id"
            :item="item"
            @approve="onApprove"
            @reject="onReject"
          ></pending-card>
        </div>
      </div>
    </div>
  `,
  setup(props, { emit }) {
    const { ref, computed, watch } = Vue;
    const tab = ref('pending');
    const items = ref([]);
    const countPending = ref(0);

    function load() {
      items.value = BotanicalDB.getPendingChanges({ status: tab.value });
      // 注入 plant 详情用于卡片渲染
      for (const it of items.value) {
        if (it.target_id) {
          it.plant = BotanicalDB.getPlant(it.target_id);
          if (it.plant) it.photos = BotanicalDB.getPlantPhotos(it.target_id);
        }
      }
      countPending.value = BotanicalDB.countPendingChanges();
    }

    watch(tab, load);
    watch(() => props.visible, (v) => { if (v) load(); });

    async function onApprove(item) {
      try {
        BotanicalDB.approvePending(item.id);
        await BotanicalDB.saveDB();
        load();
        emit('refresh');
        window.$toast?.success('审定已通过');
      } catch (e) {
        window.$toast?.error('审定失败：' + e.message);
      }
    }

    async function onReject({ item, targetPlantId, reason }) {
      try {
        BotanicalDB.rejectPending(item.id, targetPlantId, reason);
        await BotanicalDB.saveDB();
        load();
        emit('refresh');
        window.$toast?.success('已归入目标物种');
      } catch (e) {
        window.$toast?.error('归入失败：' + e.message);
      }
    }

    return { tab, items, countPending, onApprove, onReject };
  }
};

// ==================== V3: PendingCard 审定卡片 ====================
const PendingCardComponent = {
  props: {
    item: { type: Object, required: true }
  },
  emits: ['approve', 'reject'],
  template: `
    <article class="pending-card" :class="'kind-' + item.kind">
      <header class="pending-card-head">
        <span class="pending-kind-tag">{{ kindLabel }}</span>
        <span class="pending-time">{{ formatTime(item.created_at) }}</span>
      </header>
      <div class="pending-card-body">
        <div class="pending-info" v-if="item.plant">
          <header class="pending-title-block">
            <div class="detail-eyebrow" v-if="item.plant.family">{{ item.plant.family }}</div>
            <h3 class="pending-title">{{ item.plant.chinese_name || '未命名' }}</h3>
            <p class="pending-latin-line">
              <i class="detail-latin">{{ plantLatinNoAuth }}</i>
              <span class="detail-author" v-if="item.plant.authority">&nbsp;{{ item.plant.authority }}</span>
            </p>
          </header>
          <div class="pending-meta">
            <span v-if="item.payload && item.payload.source">来源: {{ item.payload.source }}</span>
            <span v-if="item.payload && item.payload.filename" class="pending-meta-file">{{ item.payload.filename }}</span>
          </div>
          <div class="pending-photos" v-if="reactivePhotos.length > 0">
            <div v-for="ph in reactivePhotos" :key="ph.id" class="pending-photo">
              <img :src="ph.image_url || ('data/images/' + ph.file_path)" :alt="ph.filename" loading="lazy">
            </div>
          </div>
          <div class="pending-edit-row">
            <label>中文名 <span class="pending-edit-hint">审定前可修订</span></label>
            <input type="text" v-model="editChineseName" placeholder="物种中文名">
          </div>
          <div class="pending-edit-row">
            <label>简介 <span class="pending-edit-hint">可在审定前补充</span></label>
            <textarea v-model="editDescription" rows="3" placeholder="补充物种简介..."></textarea>
          </div>
        </div>
        <div v-else class="pending-info">
          <h3 class="pending-title">{{ kindLabel }}</h3>
          <pre class="pending-payload-raw">{{ JSON.stringify(item.payload, null, 2) }}</pre>
        </div>
      </div>
      <footer class="pending-card-actions" v-if="item.status === 'pending' && !showReject">
        <button class="btn-approve" @click="approve" :disabled="busy">审定通过</button>
        <button class="btn-reject" @click="showReject = true" :disabled="busy">审定不通过</button>
      </footer>
      <div class="pending-reject-form" v-if="showReject">
        <div class="pending-reject-header">归入已有物种</div>
        <label>输入拉丁名搜索目标物种</label>
        <input type="text" v-model="rejectLatin" @input="onRejectInput" placeholder="如 Amitostigma alpestre">
        <ul class="reject-suggestions" v-if="rejectSuggestions.length > 0">
          <li v-for="s in rejectSuggestions" :key="s.id" @click="pickRejectTarget(s)">
            <i>{{ s.latin_name }}</i> <span v-if="s.chinese_name">{{ s.chinese_name }}</span>
          </li>
        </ul>
        <label>归并原因（可选）</label>
        <input type="text" v-model="rejectReason" placeholder="例：异名、重新归类">
        <div class="reject-actions">
          <button class="btn-confirm-reject" @click="confirmReject" :disabled="!rejectTargetId || busy">确认归入</button>
          <button class="btn-cancel" @click="showReject = false">取消</button>
        </div>
      </div>
    </article>
  `,
  setup(props, { emit }) {
    const { ref, computed, watch, onMounted } = Vue;
    const showReject = ref(false);
    const rejectLatin = ref('');
    const rejectReason = ref('');
    const rejectTargetId = ref(null);
    const rejectSuggestions = ref([]);
    const editDescription = ref(props.item.plant?.description || '');
    const editChineseName = ref(props.item.plant?.chinese_name || '');
    const busy = ref(false);
    // 响应式照片副本（关键修复：原 item.photos 是 props，不会触发更新）
    const reactivePhotos = ref([]);

    const kindLabel = computed(() => ({
      'new_species': '新物种 New Species',
      'taxonomy_revise': '分类修订 Revise',
      'add_taxon': '新增分类 Add Taxon',
      'merge_taxon': '合并分类 Merge'
    }[props.item.kind] || props.item.kind));

    const plantLatinNoAuth = computed(() => {
      const ln = props.item.plant?.latin_name || '';
      const auth = props.item.plant?.authority || '';
      if (auth && ln.endsWith(' ' + auth)) return ln.slice(0, -auth.length).trim();
      return ln;
    });

    function formatTime(s) {
      if (!s) return '';
      return s.replace('T', ' ').slice(0, 16);
    }

    function approve() {
      if (busy.value) return;
      busy.value = true;
      try {
        if (props.item.plant && editDescription.value !== (props.item.plant.description || '')) {
          BotanicalDB.updateDescription(props.item.plant.id, editDescription.value);
        }
        if (props.item.plant && editChineseName.value !== (props.item.plant.chinese_name || '')) {
          BotanicalDB.updatePlantField(props.item.plant.id, 'chinese_name', editChineseName.value.trim());
        }
        emit('approve', props.item);
      } catch (e) {
        if (window.$toast) window.$toast.error('审定失败：' + e.message);
        else console.error(e);
      } finally {
        busy.value = false;
      }
    }

    function onRejectInput() {
      const q = rejectLatin.value.trim();
      if (q.length < 2) {
        rejectSuggestions.value = [];
        rejectTargetId.value = null;
        return;
      }
      const all = BotanicalDB.getAllPlants();
      const lowerQ = q.toLowerCase();
      rejectSuggestions.value = all.filter(p =>
        p.latin_name && p.latin_name.toLowerCase().includes(lowerQ)
      ).slice(0, 8);
    }

    function pickRejectTarget(plant) {
      rejectTargetId.value = plant.id;
      rejectLatin.value = plant.latin_name;
      rejectSuggestions.value = [];
    }

    function confirmReject() {
      if (!rejectTargetId.value || busy.value) return;
      busy.value = true;
      try {
        emit('reject', {
          item: props.item,
          targetPlantId: rejectTargetId.value,
          reason: rejectReason.value
        });
      } catch (e) {
        if (window.$toast) window.$toast.error('归入失败：' + e.message);
      } finally {
        busy.value = false;
        showReject.value = false;
      }
    }

    // A2 修复：照片响应式加载
    async function loadPhotoUrls() {
      const photos = (props.item.photos || []).slice();
      // 复制一份给 reactivePhotos，先显示占位
      reactivePhotos.value = photos.map(p => ({ ...p, image_url: p.image_url || null }));
      if (photos.length === 0) return;
      const paths = photos.filter(p => p.file_path).map(p => p.file_path);
      try {
        const urlMap = await BotanicalDB.getImageURLsBatch(paths);
        // 触发响应式：替换整个数组
        reactivePhotos.value = photos.map(p => ({
          ...p,
          image_url: urlMap[p.file_path] || ('data/images/' + p.file_path)
        }));
      } catch (e) {
        console.warn('图片 URL 加载失败:', e);
      }
    }

    onMounted(loadPhotoUrls);
    watch(() => props.item.photos?.length || 0, loadPhotoUrls);
    watch(() => props.item.plant?.id, () => {
      editDescription.value = props.item.plant?.description || '';
      editChineseName.value = props.item.plant?.chinese_name || '';
    });

    return { showReject, rejectLatin, rejectReason, rejectTargetId, rejectSuggestions,
             editDescription, editChineseName, kindLabel, formatTime, approve, onRejectInput,
             pickRejectTarget, confirmReject, busy, reactivePhotos, plantLatinNoAuth };
  }
};

// ==================== V3: AdminPage 行政区划页面 ====================
const AdminPageComponent = {
  props: {
    code: { type: String, default: null }
  },
  emits: ['close', 'open-plant'],
  template: `
    <div class="admin-page" v-if="code">
      <div class="admin-page-header">
        <button class="btn-back" @click="$emit('close')">← 返回</button>
        <nav class="admin-breadcrumb">
          <span v-for="(b, i) in breadcrumb" :key="b.code">
            <a @click="$emit('open-admin', b.code)">{{ b.name_zh }}</a>
            <span v-if="i < breadcrumb.length - 1"> › </span>
          </span>
        </nav>
      </div>
      <h2 class="admin-page-title">{{ currentName }}</h2>
      <div class="admin-page-stats">在该区域拍摄过的物种：{{ plants.length }} 种</div>
      <div class="card-grid" v-if="plants.length > 0">
        <div v-for="plant in plants" :key="plant.id" class="plant-card" @click="$emit('open-plant', plant)">
          <div class="card-image">
            <img v-if="plant.primary_photo_url" :src="plant.primary_photo_url" :alt="plant.chinese_name" loading="lazy">
            <div v-else class="card-image-placeholder"><span>🌿</span></div>
          </div>
          <div class="card-info">
            <div class="card-name">{{ plant.chinese_name || '未命名' }}</div>
            <div class="card-latin"><i>{{ plant.latin_name }}</i></div>
            <div class="card-family" v-if="plant.family">{{ plant.family }}</div>
          </div>
        </div>
      </div>
      <div v-else class="empty-state">
        <div class="empty-icon">📷</div>
        <p>该区域还没有拍摄过物种</p>
      </div>
    </div>
  `,
  setup(props) {
    const { ref, watch } = Vue;
    const plants = ref([]);
    const breadcrumb = ref([]);
    const currentName = ref('');

    async function load() {
      if (!props.code) { plants.value = []; breadcrumb.value = []; return; }
      const node = BotanicalDB.getAdminDivisionByCode(props.code);
      if (node) {
        breadcrumb.value = node.breadcrumb;
        currentName.value = node.name_zh;
      }
      plants.value = BotanicalDB.getPlantsByAdminCode(props.code);
      // 加载主图
      const paths = plants.value.filter(p => p.primary_photo).map(p => p.primary_photo);
      if (paths.length > 0) {
        const urlMap = await BotanicalDB.getImageURLsBatch(paths);
        for (const p of plants.value) {
          if (p.primary_photo && urlMap[p.primary_photo]) p.primary_photo_url = urlMap[p.primary_photo];
        }
      }
    }

    watch(() => props.code, load, { immediate: true });

    return { plants, breadcrumb, currentName };
  }
};

// ==================== V3: ReviseDialog 分类修订对话框 ====================
const ReviseDialogComponent = {
  props: {
    visible: { type: Boolean, default: false },
    targetLevel: { type: String, default: 'species' }, // 'species' | 'genus' | 'family'
    targetPlant: { type: Object, default: null },      // 物种级修订：当前物种
    targetTaxonName: { type: String, default: '' }     // 属/科级修订：当前分类名
  },
  emits: ['close', 'submitted'],
  template: `
    <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
      <div class="modal revise-modal">
        <div class="modal-header">
          <h2>{{ titleText }}</h2>
          <button class="modal-close" @click="$emit('close')">&times;</button>
        </div>
        <div class="modal-body">
          <div class="revise-action-tabs">
            <button v-for="opt in actionOptions" :key="opt.value"
                    class="revise-action-btn"
                    :class="{active: action === opt.value}"
                    @click="action = opt.value">{{ opt.label }}</button>
          </div>

          <!-- 物种级：变动属 -->
          <div v-if="action === 'change_genus'" class="revise-form">
            <label>新的属名（拉丁）</label>
            <input type="text" v-model="newGenus" placeholder="如 Bulbophyllum">
            <p class="revise-hint">当前属：<i>{{ targetPlant && targetPlant.genus }}</i></p>
          </div>

          <!-- 物种级：改为变种/亚种 -->
          <div v-if="action === 'to_infraspecific'" class="revise-form">
            <label>新的等级</label>
            <select v-model="newRank">
              <option value="var.">变种 (var.)</option>
              <option value="subsp.">亚种 (subsp.)</option>
              <option value="f.">变型 (f.)</option>
            </select>
            <label>母种拉丁名（必须为已有物种）</label>
            <input type="text" v-model="parentLatin" placeholder="如 Amitostigma alpestre">
          </div>

          <!-- 属级/科级：合并 -->
          <div v-if="action === 'merge'" class="revise-form">
            <label>归并到目标 {{ targetLevel === 'genus' ? '属' : '科' }}名</label>
            <input type="text" v-model="mergeTarget" placeholder="目标拉丁名">
          </div>

          <!-- 属级：更改科 -->
          <div v-if="action === 'change_family'" class="revise-form">
            <label>新的科名</label>
            <input type="text" v-model="newFamily" placeholder="如 Orchidaceae">
          </div>

          <!-- 科级：更改目 -->
          <div v-if="action === 'change_order'" class="revise-form">
            <label>新的目名</label>
            <input type="text" v-model="newOrder" placeholder="如 Asparagales">
          </div>

          <div class="revise-form">
            <label>修订理由（可选）</label>
            <input type="text" v-model="reason" placeholder="例：根据 APG IV 重新归类">
          </div>

          <div class="form-actions">
            <button class="btn-save" @click="submit" :disabled="!canSubmit">提交审定</button>
            <button class="btn-cancel" @click="$emit('close')">取消</button>
          </div>
          <p class="revise-hint">提交后进入审定页面，通过后才生效。</p>
        </div>
      </div>
    </div>
  `,
  setup(props, { emit }) {
    const { ref, computed, watch } = Vue;
    const action = ref('change_genus');
    const newGenus = ref('');
    const newRank = ref('var.');
    const parentLatin = ref('');
    const mergeTarget = ref('');
    const newFamily = ref('');
    const newOrder = ref('');
    const reason = ref('');

    const titleText = computed(() => {
      if (props.targetLevel === 'species') return `修订物种 ${props.targetPlant?.latin_name || ''}`;
      if (props.targetLevel === 'genus') return `修订属 ${props.targetTaxonName}`;
      if (props.targetLevel === 'family') return `修订科 ${props.targetTaxonName}`;
      return '修订';
    });

    const actionOptions = computed(() => {
      if (props.targetLevel === 'species') return [
        { value: 'change_genus', label: '变动属' },
        { value: 'to_infraspecific', label: '改为变种/亚种' }
      ];
      if (props.targetLevel === 'genus') return [
        { value: 'merge', label: '与某属合并' },
        { value: 'change_family', label: '更改科' }
      ];
      if (props.targetLevel === 'family') return [
        { value: 'merge', label: '与某科合并' },
        { value: 'change_order', label: '更改目' }
      ];
      return [];
    });

    watch(actionOptions, (opts) => {
      if (opts.length > 0 && !opts.find(o => o.value === action.value)) action.value = opts[0].value;
    }, { immediate: true });

    const canSubmit = computed(() => {
      if (action.value === 'change_genus') return newGenus.value.trim().length > 0;
      if (action.value === 'to_infraspecific') return parentLatin.value.trim().length > 0;
      if (action.value === 'merge') return mergeTarget.value.trim().length > 0;
      if (action.value === 'change_family') return newFamily.value.trim().length > 0;
      if (action.value === 'change_order') return newOrder.value.trim().length > 0;
      return false;
    });

    function submit() {
      let payload = {
        target_level: props.targetLevel,
        action: action.value,
        plant_id: props.targetPlant?.id || null,
        taxon_name: props.targetTaxonName || null,
        before: {},
        after: {}
      };

      if (action.value === 'change_genus') {
        payload.before.genus = props.targetPlant?.genus;
        payload.after.genus = newGenus.value.trim();
      } else if (action.value === 'to_infraspecific') {
        payload.after.infraspecific_rank = newRank.value;
        payload.after.parent_latin = parentLatin.value.trim();
      } else if (action.value === 'merge') {
        payload.before.name = props.targetTaxonName;
        payload.after.merge_into = mergeTarget.value.trim();
      } else if (action.value === 'change_family') {
        payload.before.family = '';
        payload.after.family = newFamily.value.trim();
      } else if (action.value === 'change_order') {
        payload.before.order = '';
        payload.after.order = newOrder.value.trim();
      }

      const kindMap = {
        'change_genus': 'taxonomy_revise',
        'to_infraspecific': 'taxonomy_revise',
        'merge': 'merge_taxon',
        'change_family': 'taxonomy_revise',
        'change_order': 'taxonomy_revise'
      };

      BotanicalDB.addPendingChange(kindMap[action.value], payload, {
        target_table: 'plants',
        target_id: props.targetPlant?.id || null,
        reason: reason.value
      });
      BotanicalDB.saveDB();
      emit('submitted');
      emit('close');
      // reset
      newGenus.value = ''; parentLatin.value = ''; mergeTarget.value = '';
      newFamily.value = ''; newOrder.value = ''; reason.value = '';
    }

    return { action, actionOptions, titleText, canSubmit,
             newGenus, newRank, parentLatin, mergeTarget, newFamily, newOrder, reason,
             submit };
  }
};

// ==================== V3: AddTaxonDialog 各级新增对话框 ====================
const AddTaxonDialogComponent = {
  props: {
    visible: { type: Boolean, default: false },
    parentLevel: { type: String, default: 'genus' },  // 'order' | 'family' | 'genus' | null（首页快捷新增=种）
    parentName: { type: String, default: '' }
  },
  emits: ['close', 'submitted'],
  template: `
    <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
      <div class="modal add-taxon-modal">
        <div class="modal-header">
          <h2>{{ titleText }}</h2>
          <button class="modal-close" @click="$emit('close')">&times;</button>
        </div>
        <div class="modal-body">
          <p v-if="parentName" class="add-taxon-context">
            归属于：<strong>{{ parentName }}</strong>（{{ parentLevelLabel }}）
          </p>
          <div class="add-taxon-form">
            <label>{{ targetLevelLabel }}名（拉丁） *</label>
            <input type="text" v-model="latinName" placeholder="拉丁名">
            <label>中文名</label>
            <input type="text" v-model="chineseName" placeholder="中文名（可选）">
            <label v-if="targetLevel === 'species'">命名人</label>
            <input v-if="targetLevel === 'species'" type="text" v-model="authority" placeholder="如 L., Hook.f.">
            <label v-if="targetLevel === 'species'">种加词（拉丁，仅 species）</label>
            <input v-if="targetLevel === 'species'" type="text" v-model="speciesEpithet" placeholder="如 alpestre">
            <label>简介</label>
            <textarea v-model="description" rows="3" placeholder="形态描述（可选）"></textarea>
            <div class="form-actions">
              <button class="btn-save" @click="submit" :disabled="!canSubmit">提交审定</button>
              <button class="btn-cancel" @click="$emit('close')">取消</button>
            </div>
            <p class="revise-hint">提交后进入审定页面，通过后才正式入库。</p>
          </div>
        </div>
      </div>
    </div>
  `,
  setup(props, { emit }) {
    const { ref, computed } = Vue;
    const latinName = ref('');
    const chineseName = ref('');
    const authority = ref('');
    const speciesEpithet = ref('');
    const description = ref('');

    const targetLevel = computed(() => {
      const map = { 'order': 'family', 'family': 'genus', 'genus': 'species' };
      return map[props.parentLevel] || 'species';
    });

    const targetLevelLabel = computed(() => ({
      'family': '科', 'genus': '属', 'species': '物种'
    }[targetLevel.value] || '物种'));

    const parentLevelLabel = computed(() => ({
      'order': '目', 'family': '科', 'genus': '属'
    }[props.parentLevel] || ''));

    const titleText = computed(() => {
      const tl = targetLevelLabel.value;
      return props.parentName ? `在 ${props.parentName} 下新增${tl}` : `快捷新增${tl}`;
    });

    const canSubmit = computed(() => {
      if (targetLevel.value === 'species') {
        return latinName.value.trim().length > 0 || speciesEpithet.value.trim().length > 0;
      }
      return latinName.value.trim().length > 0;
    });

    function submit() {
      const latinInput = latinName.value.trim();
      const inputParts = latinInput.split(/\s+/).filter(Boolean);
      const inferredGenus = props.parentName || inputParts[0] || '';
      const lookupName = targetLevel.value === 'species' ? inferredGenus : (latinInput || props.parentName);
      const taxon = TaxonomyLookup?.lookup?.(lookupName) || TaxonomyLookup?.lookup?.(props.parentName) || null;

      // 构造 plant 数据
      let plantData;
      if (targetLevel.value === 'species') {
        const epithet = speciesEpithet.value.trim();
        const latin = latinInput || (props.parentName + ' ' + epithet);
        const genus = props.parentName || inputParts[0] || '';
        plantData = {
          latin_name: latin + (authority.value.trim() ? ' ' + authority.value.trim() : ''),
          chinese_name: chineseName.value.trim() || null,
          genus,
          species_epithet: epithet || inputParts[1] || '',
          authority: authority.value.trim() || null,
          kingdom: taxon?.kingdom || '植物界 Plantae',
          phylum: taxon?.phylum || null,
          class: taxon?.class || null,
          order: taxon?.order || null,
          family: taxon?.family || (props.parentLevel === 'family' ? props.parentName : null),
          notes: '',
          status: 'pending',
          data_source: 'manual'
        };
      } else if (targetLevel.value === 'genus') {
        // 新增属：用占位物种来"代表"该属，因为 plants 表没有独立的属表
        plantData = {
          latin_name: latinInput + ' sp.',
          chinese_name: chineseName.value.trim() ? (chineseName.value.trim() + ' 属') : null,
          genus: latinInput,
          species_epithet: 'sp.',
          authority: null,
          family: props.parentName,
          kingdom: taxon?.kingdom || '植物界 Plantae',
          phylum: taxon?.phylum || null,
          class: taxon?.class || null,
          order: taxon?.order || null,
          notes: '新增属占位记录',
          status: 'pending',
          data_source: 'manual'
        };
      } else if (targetLevel.value === 'family') {
        plantData = {
          latin_name: latinInput + ' sp.',
          chinese_name: chineseName.value.trim() ? (chineseName.value.trim() + ' 科') : null,
          genus: 'unspecified',
          species_epithet: 'sp.',
          family: latinInput,
          order: props.parentName,
          kingdom: '植物界 Plantae',
          notes: '新增科占位记录',
          status: 'pending',
          data_source: 'manual'
        };
      }

      const plantId = BotanicalDB.addPlant(plantData);
      BotanicalDB.ensureTaxonomyDescriptionsForPlant({ id: plantId, ...plantData });
      if (description.value.trim()) {
        BotanicalDB.updateDescription(plantId, description.value.trim());
        if (targetLevel.value === 'family' || targetLevel.value === 'genus') {
          const levelName = targetLevel.value === 'family' ? BotanicalDB._extractLatinTaxonName(plantData.family) : plantData.genus;
          const existingDesc = BotanicalDB.getTaxonomyDescription(targetLevel.value, levelName);
          BotanicalDB.saveTaxonomyDescription({
            taxon_level: targetLevel.value,
            taxon_name: levelName,
            family: BotanicalDB._extractLatinTaxonName(plantData.family) || '',
            description: description.value.trim(),
            key_data: existingDesc?.key_data || '[]',
            key_text: existingDesc?.key_text || '',
            references_text: existingDesc?.references_text || ''
          });
        }
      }

      const kind = targetLevel.value === 'species' ? 'new_species' : 'add_taxon';
      BotanicalDB.addPendingChange(kind, {
        plant_id: plantId,
        target_level: targetLevel.value,
        latin_name: plantData.latin_name,
        chinese_name: plantData.chinese_name,
        parent_level: props.parentLevel,
        parent_name: props.parentName,
        source: 'manual'
      }, { target_table: 'plants', target_id: plantId });

      BotanicalDB.saveDB();
      emit('submitted');
      emit('close');
      // reset
      latinName.value = ''; chineseName.value = ''; authority.value = '';
      speciesEpithet.value = ''; description.value = '';
    }

    return { latinName, chineseName, authority, speciesEpithet, description,
             targetLevel, targetLevelLabel, parentLevelLabel, titleText, canSubmit, submit };
  }
};

// ==================== V3.2: 右侧拉丁词典面板 ====================
const DictionaryPanelComponent = {
  props: {
    visible: { type: Boolean, default: false }
  },
  emits: ['close'],
  template: `
    <div v-if="visible" class="dictionary-shell" @click.self="$emit('close')">
      <aside class="dictionary-panel">
        <header class="dictionary-panel-head">
          <div>
            <h2>拉丁词典 <span>Latin Dictionary</span></h2>
            <p>种加词与词源速查</p>
          </div>
          <button class="modal-close" @click="$emit('close')">&times;</button>
        </header>
        <div class="dictionary-search">
          <input type="text" v-model="query" placeholder="搜索 aphrodite, alba..." autofocus>
        </div>
        <div class="dictionary-letters">
          <button :class="{ active: letter === '' }" @click="query = ''; letter = ''">All</button>
          <button v-for="l in letters" :key="l" :class="{ active: letter === l }" @click="query = ''; letter = l">{{ l }}</button>
        </div>
        <div class="dictionary-list">
          <div v-for="entry in entries" :key="entry.id" class="dictionary-entry-row">
            <div class="dictionary-term"><i>{{ entry.latin_term }}</i></div>
            <div class="dictionary-cn" v-if="entry.chinese_meaning">{{ entry.chinese_meaning }}</div>
            <div class="dictionary-en" v-if="entry.english_meaning">{{ entry.english_meaning }}</div>
            <div class="dictionary-pron" v-if="entry.pronunciation">[{{ entry.pronunciation }}]</div>
          </div>
          <div v-if="entries.length === 0" class="dictionary-empty">没有匹配的词条</div>
        </div>
      </aside>
    </div>
  `,
  setup(props) {
    const query = ref('');
    const letter = ref('');
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

    const entries = computed(() => {
      if (!props.visible || !BotanicalDB.db) return [];
      const q = query.value.trim();
      if (q.length > 0) return BotanicalDB.searchDictionary(q);
      if (letter.value) {
        const res = BotanicalDB.db.exec(`
          SELECT * FROM dictionary
          WHERE LOWER(latin_term) LIKE ?
          ORDER BY latin_term
          LIMIT 80
        `, [letter.value.toLowerCase() + '%']);
        return BotanicalDB._toObjects(res);
      }
      const res = BotanicalDB.db.exec(`
        SELECT * FROM dictionary
        ORDER BY latin_term
        LIMIT 80
      `);
      return BotanicalDB._toObjects(res);
    });

    watch(query, () => {
      if (query.value.trim()) letter.value = '';
    });

    return { query, letter, letters, entries };
  }
};

// ==================== V3.2: 设置面板 ====================
const SettingsDialogComponent = {
  props: {
    visible: { type: Boolean, default: false },
    familiesPerPage: { type: Number, default: 8 }
  },
  emits: ['close', 'update-settings', 'restored'],
  template: `
    <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
      <div class="modal settings-modal">
        <div class="modal-header">
          <h2>设置 <span class="settings-title-latin">Settings</span></h2>
          <button class="modal-close" @click="$emit('close')">&times;</button>
        </div>
        <div class="modal-body settings-body">
          <section class="settings-section">
            <h3>显示设置</h3>
            <div class="settings-control-row">
              <label>主页家族数</label>
              <input type="range" min="4" max="12" step="1" v-model.number="localFamilies" @change="applyFamilies">
              <output>{{ localFamilies }}</output>
            </div>
          </section>

          <section class="settings-section">
            <h3>数据备份与恢复</h3>
            <div class="settings-actions">
              <button class="btn-save" @click="exportCurrentDB">导出当前数据库</button>
              <label class="btn-cancel settings-file-btn">
                从文件恢复
                <input type="file" accept=".db,.sqlite,.sqlite3,application/octet-stream" @change="restoreFromFile">
              </label>
            </div>
            <div class="backup-list" v-if="isDiskMode">
              <div class="backup-list-head">
                <span>服务器备份</span>
                <button class="btn-edit-small" @click="loadBackups">刷新</button>
              </div>
              <div v-if="backups.length === 0" class="backup-empty">暂无备份文件</div>
              <div v-for="backup in backups" :key="backup.name" class="backup-row">
                <div>
                  <div class="backup-name">{{ backup.name }}</div>
                  <div class="backup-meta">{{ formatSize(backup.size) }} · {{ backup.modified }}</div>
                </div>
                <button class="btn-revise btn-revise-sm" @click="restoreBackup(backup.name)">恢复</button>
              </div>
            </div>
            <p v-else class="settings-hint">当前未连接本地服务器，备份列表不可用；仍可导出或从文件恢复。</p>
          </section>
        </div>
      </div>
    </div>
  `,
  setup(props, { emit }) {
    const localFamilies = ref(props.familiesPerPage || 8);
    const backups = ref([]);
    const isDiskMode = computed(() => !!BotanicalDB._diskMode);

    watch(() => props.visible, (visible) => {
      if (!visible) return;
      localFamilies.value = props.familiesPerPage || 8;
      loadBackups();
    });

    function applyFamilies() {
      const next = Math.min(12, Math.max(4, Number(localFamilies.value) || 8));
      localFamilies.value = next;
      emit('update-settings', { familiesPerPage: next });
      window.$toast?.success('主页显示数量已更新');
    }

    function exportCurrentDB() {
      try {
        const data = BotanicalDB.exportDB();
        const blob = new Blob([data], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const date = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `botanical-${date}.db`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        window.$toast?.success('数据库已导出');
      } catch (e) {
        window.$toast?.error('导出失败：' + e.message);
      }
    }

    async function restoreFromFile(e) {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      if (!confirm('确定用此文件恢复数据库吗？当前数据库会先自动备份。')) return;
      try {
        const buffer = await file.arrayBuffer();
        await BotanicalDB.restoreDBFromArrayBuffer(buffer);
        emit('restored');
        window.$toast?.success('数据库已恢复');
      } catch (err) {
        window.$toast?.error('恢复失败：' + err.message);
      }
    }

    async function loadBackups() {
      if (!isDiskMode.value) { backups.value = []; return; }
      try {
        const resp = await fetch('/api/list-backups');
        if (!resp.ok) throw new Error('无法读取备份列表');
        const data = await resp.json();
        backups.value = data.files || [];
      } catch (e) {
        backups.value = [];
      }
    }

    async function restoreBackup(name) {
      if (!name) return;
      if (!confirm(`确定恢复备份「${name}」吗？当前数据库会先自动备份。`)) return;
      try {
        const resp = await fetch('/api/restore-db?source=' + encodeURIComponent(name), { method: 'POST' });
        if (!resp.ok) throw new Error('服务器恢复失败');
        const data = await resp.json();
        if (!data.ok) throw new Error(data.reason || '服务器恢复失败');
        await BotanicalDB.reloadFromDisk();
        emit('restored');
        await loadBackups();
        window.$toast?.success('备份已恢复');
      } catch (e) {
        window.$toast?.error('恢复失败：' + e.message);
      }
    }

    function formatSize(size) {
      const n = Number(size) || 0;
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
      return (n / 1024 / 1024).toFixed(1) + ' MB';
    }

    return { localFamilies, backups, isDiskMode, applyFamilies, exportCurrentDB,
             restoreFromFile, loadBackups, restoreBackup, formatSize };
  }
};

// ==================== V3.2: Toast 通知 ====================
const ToastComponent = {
  name: 'ToastCenter',
  template: `
    <div class="toast-stack">
      <div v-for="toast in toasts" :key="toast.id" class="toast-item" :class="'toast-' + toast.type">
        <span class="toast-dot"></span>
        <span class="toast-message">{{ toast.message }}</span>
        <button class="toast-close" @click="dismiss(toast.id)">&times;</button>
      </div>
    </div>
  `,
  setup() {
    const toasts = ref([]);
    let nextId = 1;

    function push(type, message, timeout = 4200) {
      const id = nextId++;
      toasts.value = [...toasts.value, { id, type, message }];
      if (timeout) setTimeout(() => dismiss(id), timeout);
      return id;
    }

    function dismiss(id) {
      toasts.value = toasts.value.filter(t => t.id !== id);
    }

    onMounted(() => {
      window.$toast = {
        success: (message) => push('success', message),
        error: (message) => push('error', message, 6000),
        warning: (message) => push('warning', message, 5200),
        info: (message) => push('info', message)
      };
    });

    return { toasts, dismiss };
  }
};
