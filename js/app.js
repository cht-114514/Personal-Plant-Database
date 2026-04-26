/**
 * 植物资料库 - Vue 3 主应用
 */
const { createApp, ref, computed, watch, onMounted, nextTick } = Vue;

// ==================== PPBC 文件名解析器 ====================

const PPBCParser = {
  /**
   * 解析 PPBC 格式的文件名
   * 格式: "拉丁名(+分隔) 中文名 PPBC ID 拍摄者 地点"
   * 例: "Nepeta+cataria+L. 荆芥 PPBC 22816696 崔瞳岳 新疆维吾尔自治区阿禾公路-布尔津"
   */
  parse(filename) {
    // 去掉扩展名
    const name = filename.replace(/\.[^.]+$/, '');

    // 分隔符：支持空格和下划线
    const SEP = '[\\s_]+';
    const sepRe = /[\s_]+/;

    // 用 "PPBC 数字" 作为锚点拆分，比单一正则更健壮
    const ppbcAnchor = name.match(new RegExp(SEP + 'PPBC' + SEP + '(\\d+)' + SEP));
    if (ppbcAnchor) {
      const left = name.substring(0, ppbcAnchor.index);   // "拉丁名_中文名"
      const right = name.substring(ppbcAnchor.index + ppbcAnchor[0].length); // "拍摄者_地点"
      const ppbcId = ppbcAnchor[1];

      // 左半：拉丁名 + 中文名（以第一个汉字为界）
      const leftMatch = left.match(/^(.+?)[\s_]+([\u4e00-\u9fff\u3400-\u4dbf].*)$/);
      if (leftMatch) {
        const latinRaw = leftMatch[1].replace(/\+/g, ' ').trim();
        const chineseName = leftMatch[2].replace(/_/g, ' ').trim();

        // 右半：按分隔符拆 — 第一段 = 拍摄者，其余 = 地点
        const rightParts = right.split(sepRe).filter(Boolean);
        const photographer = rightParts[0] || null;
        const location = rightParts.slice(1).join(' ') || null;

        return {
          latin_name: latinRaw,
          chinese_name: chineseName,
          ppbc_id: ppbcId,
          photographer,
          location,
          ...this.parseLatinName(latinRaw)
        };
      }
    }

    // 退化：提取拉丁名和中文名（以第一个汉字为界）
    const simpleMatch = name.match(/^(.+?)[\s_]+([\u4e00-\u9fff\u3400-\u4dbf][^\s_]*)/);
    if (simpleMatch) {
      const latinRaw = simpleMatch[1].replace(/\+/g, ' ').trim();
      return {
        latin_name: latinRaw,
        chinese_name: simpleMatch[2].trim(),
        ppbc_id: null,
        photographer: null,
        location: null,
        ...this.parseLatinName(latinRaw)
      };
    }

    return {
      latin_name: name.replace(/\+/g, ' '),
      chinese_name: null,
      ppbc_id: null,
      photographer: null,
      location: null,
      genus: null,
      species_epithet: null,
      authority: null
    };
  },

  /** 解析拉丁学名为 属 + 种加词 + 命名人 */
  parseLatinName(latin) {
    // 格式: "Genus species Authority" 或 "Genus species var. subspecies Auth."
    const parts = latin.split(/\s+/);
    if (parts.length >= 2) {
      const genus = parts[0];
      let speciesEpithet = parts[1];
      // 命名人通常以大写字母开头或含有点号
      let authorityStart = 2;
      // 如果第二个词是 var./subsp./f. 等，种加词包含更多
      if (['var.', 'subsp.', 'f.', 'ssp.'].includes(parts[1])) {
        speciesEpithet = parts.slice(1, 3).join(' ');
        authorityStart = 3;
      }
      const authority = parts.slice(authorityStart).join(' ') || null;
      return { genus, species_epithet: speciesEpithet, authority };
    }
    return { genus: parts[0] || null, species_epithet: null, authority: null };
  }
};

// ==================== 分类学查找 ====================

const TaxonomyLookup = {
  data: null,

  async load() {
    try {
      const resp = await fetch('data/taxonomy-lookup.json');
      if (resp.ok) {
        this.data = await resp.json();
      }
    } catch (e) {
      console.log('分类学查找表未找到，将跳过自动分类');
    }
  },

  lookup(genus) {
    if (!this.data || !genus) return null;
    return this.data[genus] || null;
  }
};

// 组件已移至 js/components.js（TaxonomyTree, PlantDetail, DichotomousKey, TaxonomyIntro）

// ==================== 主应用 ====================

const app = createApp({
  setup() {
    // 状态
    const loading = ref(true);
    const allPlants = ref([]);
    const filteredPlants = ref([]);
    const currentPlant = ref(null);
    const currentPhotos = ref([]);
    const currentInfraspecific = ref([]);
    const currentParentPlant = ref(null);
    const taxonomyTree = ref({ label: '植物界', children: [], count: 0 });
    const searchQuery = ref('');
    const isSearching = ref(false);
    const showExplorer = ref(false);
    const selectedTaxonPath = ref([]);
    const breadcrumbs = ref([]);
    const totalPlants = ref(0);
    const showImportDialog = ref(false);
    const isDragOver = ref(false);
    const importResults = ref([]);
    const searchInput = ref(null);
    const importTab = ref('ppbc');
    const importHintFamily = ref('');
    const dictionaryResults = ref([]);
    const showDictionary = ref(false);
    const showSettings = ref(false);
    const settings = ref({
      familiesPerPage: Number(localStorage.getItem('botanical.settings.familiesPerPage') || 8)
    });

    // v3: 版本号 + 待审定计数 + Hash 路由
    const appVersion = ref('');
    const pendingCount = ref(0);
    const currentRoute = ref({ page: 'home' });
    const showPendingQueue = ref(false);

    // v3: 修订对话框 + 新增对话框
    const reviseDialog = ref({ visible: false, targetLevel: 'species', targetPlant: null, targetTaxonName: '' });
    const addTaxonDialog = ref({ visible: false, parentLevel: 'genus', parentName: '' });

    // v3: 主页 Hero / Overview / Family Sections 数据
    const topFamilies = ref([]);
    const topRegions = ref([]);
    const familyBlocks = ref([]);
    const totalFamilies = ref(0);

    const isHomeView = computed(() => {
      return !isSearching.value
        && !currentPlant.value
        && breadcrumbs.value.length === 0
        && currentRoute.value.page === 'home';
    });

    function splitFamilyName(s) {
      if (!s) return { zh: '', latin: '' };
      const m = s.match(/^([^\sA-Za-z]+)\s+([A-Za-z]+(?:eae|ales|inae|inea|aceae)?)$/);
      if (m) return { zh: m[1].trim(), latin: m[2].trim() };
      const m2 = s.match(/^([A-Za-z]+)$/);
      if (m2) return { zh: '', latin: m2[1] };
      return { zh: s, latin: '' };
    }

    async function loadHomeOverview() {
      try {
        // Top families
        const famRes = BotanicalDB.db.exec(`
          SELECT family, COUNT(*) AS c, COUNT(DISTINCT genus) AS gc
          FROM plants
          WHERE family IS NOT NULL AND family != '' AND (status IS NULL OR status = 'approved')
          GROUP BY family
          ORDER BY c DESC
          LIMIT 12
        `);
        const famRows = BotanicalDB._toObjects(famRes);
        topFamilies.value = famRows.slice(0, 6).map(r => {
          const sp = splitFamilyName(r.family);
          return { family: r.family, familyZh: sp.zh, familyLatin: sp.latin, count: r.c };
        });

        // Total family count
        const totalFamRes = BotanicalDB.db.exec(`
          SELECT COUNT(DISTINCT family) FROM plants
          WHERE family IS NOT NULL AND family != '' AND (status IS NULL OR status = 'approved')
        `);
        totalFamilies.value = totalFamRes[0]?.values?.[0]?.[0] || 0;

        // Top regions (by photo county_code → roll up to province name)
        const regRes = BotanicalDB.db.exec(`
          SELECT province_code, COUNT(*) AS c
          FROM photos
          WHERE province_code IS NOT NULL AND province_code != ''
          GROUP BY province_code
          ORDER BY c DESC
          LIMIT 6
        `);
        const regRows = BotanicalDB._toObjects(regRes);
        topRegions.value = regRows.map(r => {
          const div = BotanicalDB.getAdminDivisionByCode(r.province_code);
          return {
            code: r.province_code,
            name: div ? div.name_zh : r.province_code,
            count: r.c,
            levelLabel: '省'
          };
        });

        // Family blocks: top N families with sample cards
        const blocks = [];
        const familiesPerPage = Math.min(12, Math.max(4, Number(settings.value.familiesPerPage) || 8));
        for (const f of famRows.slice(0, familiesPerPage)) {
          const samplesRes = BotanicalDB.db.exec(`
            SELECT p.*, ph.file_path AS primary_photo
            FROM plants p
            LEFT JOIN photos ph ON ph.plant_id = p.id AND ph.is_primary = 1
            WHERE p.family = ? AND (p.status IS NULL OR p.status = 'approved')
            ORDER BY p.genus, p.chinese_name
            LIMIT 6
          `, [f.family]);
          const samples = BotanicalDB._toObjects(samplesRes);
          // 加载主图 URL
          const paths = samples.filter(p => p.primary_photo).map(p => p.primary_photo);
          if (paths.length > 0) {
            const urlMap = await BotanicalDB.getImageURLsBatch(paths);
            for (const p of samples) {
              if (p.primary_photo && urlMap[p.primary_photo]) p.primary_photo_url = urlMap[p.primary_photo];
            }
          }
          const sp = splitFamilyName(f.family);
          blocks.push({
            family: f.family,
            familyZh: sp.zh,
            familyLatin: sp.latin,
            letter: (sp.latin || sp.zh || '?')[0].toUpperCase(),
            count: f.c,
            genusCount: f.gc,
            samples
          });
        }
        familyBlocks.value = blocks;
      } catch (e) {
        console.error('加载首页概览失败:', e);
      }
    }

    function openReviseDialog(opts) {
      reviseDialog.value = { visible: true, ...opts };
    }
    function closeReviseDialog() { reviseDialog.value.visible = false; }
    function openAddTaxonDialog(opts) {
      addTaxonDialog.value = { visible: true, ...opts };
    }
    function closeAddTaxonDialog() { addTaxonDialog.value.visible = false; }
    function onTaxonRevisionSubmitted() {
      refreshPendingCount();
    }

    async function loadAppVersion() {
      try {
        const resp = await fetch('VERSION');
        if (resp.ok) appVersion.value = (await resp.text()).trim();
      } catch (e) {}
    }

    function refreshPendingCount() {
      try {
        pendingCount.value = BotanicalDB.countPendingChanges();
      } catch (e) {
        pendingCount.value = 0;
      }
    }

    function openPendingQueue() {
      window.location.hash = '#/pending';
    }

    function openDictionary() {
      window.location.hash = '#/dict';
    }

    function closeDictionary() {
      showDictionary.value = false;
      if (window.location.hash === '#/dict') window.location.hash = '';
    }

    function openSettings() {
      showSettings.value = true;
    }

    function closeSettings() {
      showSettings.value = false;
    }

    async function onSettingsChanged(nextSettings) {
      settings.value = { ...settings.value, ...nextSettings };
      localStorage.setItem('botanical.settings.familiesPerPage', String(settings.value.familiesPerPage));
      await loadHomeOverview();
    }

    async function onDatabaseRestored() {
      await refreshData();
      refreshPendingCount();
      await loadHomeOverview();
    }

    function openFOCImport(payload = {}) {
      const family = payload.family || '';
      const query = new URLSearchParams({ tab: 'foc' });
      if (family) query.set('family', family);
      window.location.hash = '#/import?' + query.toString();
    }

    function openAdminPage(code) {
      window.location.hash = `#/admin/${code}`;
    }

    function closeOverlay() {
      window.location.hash = '';
    }

    function parseHash() {
      const h = window.location.hash || '';
      // #/pending
      if (h === '#/pending') {
        currentRoute.value = { page: 'pending' };
        showPendingQueue.value = true;
        showDictionary.value = false;
        return;
      }
      if (h === '#/dict') {
        currentRoute.value = { page: 'home' };
        showPendingQueue.value = false;
        showDictionary.value = true;
        return;
      }
      if (h.startsWith('#/import')) {
        currentRoute.value = { page: 'home' };
        showPendingQueue.value = false;
        showDictionary.value = false;
        const query = h.includes('?') ? h.slice(h.indexOf('?') + 1) : '';
        const params = new URLSearchParams(query);
        importTab.value = params.get('tab') || 'ppbc';
        importHintFamily.value = params.get('family') || '';
        showImportDialog.value = true;
        return;
      }
      // #/admin/652322
      const m = h.match(/^#\/admin\/(\w+)$/);
      if (m) {
        currentRoute.value = { page: 'admin', code: m[1] };
        showPendingQueue.value = false;
        showDictionary.value = false;
        return;
      }
      currentRoute.value = { page: 'home' };
      showPendingQueue.value = false;
      showDictionary.value = false;
    }

    window.addEventListener('hashchange', parseHash);

    // 手动添加物种
    const addSpeciesForm = ref({
      genus: '', species_epithet: '', authority: '',
      chinese_name: '', description: '', notes: ''
    });
    const genusLookupResult = ref(null);
    const addSpeciesResult = ref(null);
    const canSubmitSpecies = computed(() => {
      return addSpeciesForm.value.genus.trim()
        && addSpeciesForm.value.species_epithet.trim()
        && addSpeciesForm.value.chinese_name.trim();
    });

    // FOC 浏览器导入
    const focParseResult = ref(null);

    // 分页 + 懒加载
    const PAGE_SIZE = 60;
    const displayedPlants = ref([]);
    const hasMore = ref(true);
    const scrollContentRef = ref(null);
    const sentinelRef = ref(null);
    // 分类学超链接
    const explorerInitialTaxon = ref(null);

    let searchDebounceTimer = null;
    let _scrollObserver = null;

    // ===== 分页核心函数 =====

    async function loadNextPage() {
      const start = displayedPlants.value.length;
      const batch = filteredPlants.value.slice(start, start + PAGE_SIZE);
      if (batch.length === 0) { hasMore.value = false; return; }

      // 批量解析本批次图片 URL（单次 IDB 事务）
      const paths = batch
        .filter(p => p.primary_photo && !p.primary_photo_url)
        .map(p => p.primary_photo);
      if (paths.length > 0) {
        const urlMap = await BotanicalDB.getImageURLsBatch(paths);
        for (const p of batch) {
          if (p.primary_photo && urlMap[p.primary_photo]) {
            p.primary_photo_url = urlMap[p.primary_photo];
          }
        }
      }

      displayedPlants.value = [...displayedPlants.value, ...batch];
      hasMore.value = (start + PAGE_SIZE) < filteredPlants.value.length;
    }

    function resetPagination() {
      displayedPlants.value = [];
      hasMore.value = true;
      loadNextPage();
    }

    // ===== 初始化 =====

    onMounted(async () => {
      try {
        await BotanicalDB.init();
        await TaxonomyLookup.load();
        await loadAppVersion();
        await refreshData();
        refreshPendingCount();
        parseHash();
        await loadHomeOverview();
      } catch (e) {
        console.error('数据库初始化失败:', e);
        window.$toast?.error('数据库初始化失败：' + e.message);
      } finally {
        loading.value = false;
      }

      // 无限滚动 IntersectionObserver
      await nextTick();
      _scrollObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasMore.value) {
          loadNextPage();
        }
      }, {
        root: scrollContentRef.value,
        rootMargin: '300px'
      });
      watch(sentinelRef, (el) => {
        if (el) _scrollObserver.observe(el);
      }, { immediate: true });
    });

    async function refreshData() {
      allPlants.value = BotanicalDB.getAllPlants();
      filteredPlants.value = allPlants.value;
      resetPagination();
      taxonomyTree.value = BotanicalDB.getTaxonomyTree();
      totalPlants.value = BotanicalDB.getStats().total_plants;
    }

    // 搜索
    function onSearchInput() {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        doSearch();
      }, 250);
    }

    async function doSearch() {
      const q = searchQuery.value.trim();
      if (q) {
        isSearching.value = true;
        dictionaryResults.value = BotanicalDB.searchDictionary(q);
        filteredPlants.value = BotanicalDB.search(q);
        resetPagination();
        breadcrumbs.value = [];
        selectedTaxonPath.value = [];
      } else {
        clearSearch();
      }
    }

    function clearSearch() {
      searchQuery.value = '';
      isSearching.value = false;
      dictionaryResults.value = [];
      filteredPlants.value = allPlants.value;
      currentPlant.value = null;
      resetPagination();
    }

    // 分类树导航
    async function onTaxonSelect({ level, value, label }) {
      selectedTaxonPath.value = [value];
      filteredPlants.value = BotanicalDB.getPlantsByTaxon(level, value);
      resetPagination();
      isSearching.value = false;
      searchQuery.value = '';

      // 构建面包屑
      const levelOrder = ['kingdom', 'phylum', 'class', 'order', 'family', 'genus'];

      if (filteredPlants.value.length > 0) {
        const sample = filteredPlants.value[0];
        const crumbs = [];
        for (const l of levelOrder) {
          if (sample[l]) {
            crumbs.push({ label: sample[l], level: l, value: sample[l] });
          }
          if (l === level) break;
        }
        breadcrumbs.value = crumbs;
      } else {
        breadcrumbs.value = [{ label, level, value }];
      }

      currentPlant.value = null;
      currentParentPlant.value = null;
    }

    function onBreadcrumbClick(crumb, index) {
      if (index < breadcrumbs.value.length - 1) {
        onTaxonSelect(crumb);
      }
    }

    // 从分类导航中打开植物
    async function onExplorerNavigatePlant(plant) {
      showExplorer.value = false;
      // 设置面包屑
      const crumbs = [];
      if (plant.family) crumbs.push({ label: plant.family, level: 'family', value: plant.family });
      if (plant.genus) crumbs.push({ label: plant.genus, level: 'genus', value: plant.genus });
      breadcrumbs.value = crumbs;
      // 筛选同属植物，返回时显示相关物种
      if (plant.genus) {
        filteredPlants.value = BotanicalDB.getPlantsByTaxon('genus', plant.genus);
        resetPagination();
        selectedTaxonPath.value = [plant.genus];
      }
      await openPlant(plant);
    }

    // 打开植物详情
    async function openPlant(plant) {
      currentPlant.value = BotanicalDB.getPlant(plant.id);
      const photos = BotanicalDB.getPlantPhotos(plant.id);
      for (const photo of photos) {
        photo.image_url = await BotanicalDB.getImageURL(photo.file_path);
      }
      currentPhotos.value = photos;

      // V2: 加载种下分类群
      currentInfraspecific.value = BotanicalDB.getInfraspecificTaxa(plant.id);

      // V2: 如果是种下分类，加载母种信息
      if (currentPlant.value.parent_id) {
        currentParentPlant.value = BotanicalDB.getPlant(currentPlant.value.parent_id);
      } else {
        currentParentPlant.value = null;
      }
    }

    // 删除植物
    async function deletePlant({ plantId }) {
      // 删除前获取所有照片路径，清理图片存储
      const photos = BotanicalDB.getPlantPhotos(plantId);
      BotanicalDB.deletePlant(plantId);
      await BotanicalDB.saveDB();
      for (const photo of photos) {
        await BotanicalDB.deleteImage(photo.file_path);
      }
      currentPlant.value = null;
      currentPhotos.value = [];
      await refreshData();
    }

    // 删除照片
    async function deletePhoto({ photoId, plantId }) {
      // 获取照片文件路径用于清理图片存储
      const photoRes = BotanicalDB.db.exec(`SELECT file_path FROM photos WHERE id = ?`, [photoId]);
      const filePath = photoRes.length > 0 ? photoRes[0].values[0][0] : null;

      BotanicalDB.deletePhoto(photoId);
      await BotanicalDB.saveDB();

      // 清理 IndexedDB 中的图片
      if (filePath) await BotanicalDB.deleteImage(filePath);

      // 刷新当前植物照片（解析 URL）
      const photos = BotanicalDB.getPlantPhotos(plantId);
      for (const photo of photos) {
        photo.image_url = await BotanicalDB.getImageURL(photo.file_path);
      }
      currentPhotos.value = photos;
      await refreshData();
    }

    // 保存照片元数据
    async function savePhotoMeta({ photoId, data }) {
      BotanicalDB.updatePhoto(photoId, data);
      await BotanicalDB.saveDB();
      if (currentPlant.value) {
        const photos = BotanicalDB.getPlantPhotos(currentPlant.value.id);
        for (const photo of photos) {
          photo.image_url = await BotanicalDB.getImageURL(photo.file_path);
        }
        currentPhotos.value = photos;
      }
    }

    // 保存物种简介
    async function saveDescription({ plantId, description }) {
      BotanicalDB.updateDescription(plantId, description);
      await BotanicalDB.saveDB();
      if (currentPlant.value && currentPlant.value.id === plantId) {
        currentPlant.value = { ...currentPlant.value, description };
      }
    }

    // 返回首页
    function goHome() {
      clearSearch();
      breadcrumbs.value = [];
      selectedTaxonPath.value = [];
      currentPlant.value = null;
      currentParentPlant.value = null;
      currentInfraspecific.value = [];
      filteredPlants.value = allPlants.value;
      resetPagination();
    }

    // 在详情页为植物添加照片(支持 PPBC 文件名解析 + 跨物种误操作提示)
    function getUsedPhotoPaths() {
      try {
        const rows = BotanicalDB._toObjects(BotanicalDB.db.exec('SELECT file_path FROM photos'));
        return new Set(rows.map(r => r.file_path).filter(Boolean));
      } catch (e) {
        return new Set();
      }
    }

    function makeUniqueImagePath(file, usedNames) {
      const raw = file.name || 'photo';
      const safe = raw.replace(/[^\w\u4e00-\u9fff.+-]/g, '_').replace(/^_+/, '') || 'photo';
      const dot = safe.lastIndexOf('.');
      const stem = dot > 0 ? safe.slice(0, dot) : safe;
      const ext = dot > 0 ? safe.slice(dot) : '';
      let counter = 0;
      let candidate = `${Date.now()}_${safe}`;
      while (usedNames.has(candidate)) {
        counter += 1;
        candidate = `${Date.now()}_${stem}_${counter}${ext}`;
      }
      usedNames.add(candidate);
      return candidate;
    }

    async function addPhotosToPlant({ plantId, files }) {
      const target = BotanicalDB.getPlant(plantId);
      const _addPhotosUsedNames = getUsedPhotoPaths();
      let _addPhotosSuccess = 0;
      let _addPhotosFailed = 0;

      for (const file of files) {
        try {
          const parsed = PPBCParser.parse(file.name);
          let finalPlantId = plantId;
          let meta = { ppbc_id: null, photographer: null, location: null };

          if (parsed.latin_name) {
            // 文件名成功解析出拉丁名,保留元数据
            meta = {
              ppbc_id: parsed.ppbc_id,
              photographer: parsed.photographer,
              location: parsed.location
            };

            // 校验解析出的物种是否就是当前详情页的物种(用二元组,忽略命名人)
            if (target && parsed.genus && parsed.species_epithet) {
              const parsedMatch = BotanicalDB.findPlantByBinomial(
                parsed.genus, parsed.species_epithet
              );
              if (parsedMatch && parsedMatch.id !== plantId) {
                const ok = confirm(
                  `文件 "${file.name}" 解析为 ${parsed.latin_name}\n` +
                  `与当前物种 ${target.latin_name} (${target.chinese_name || '-'}) 不一致。\n\n` +
                  `点"确定"=关联到当前物种 ${target.latin_name}\n` +
                  `点"取消"=关联到解析出的物种 ${parsedMatch.latin_name} (${parsedMatch.chinese_name || '-'})`
                );
                if (!ok) finalPlantId = parsedMatch.id;
              }
            }
          }

          const filePath = makeUniqueImagePath(file, _addPhotosUsedNames);
          const saved = await BotanicalDB.saveImage(filePath, file);
          if (!saved) throw new Error('图片文件保存失败');
          await BotanicalDB.getImageURL(filePath);

          const existingPhotos = BotanicalDB.getPlantPhotos(finalPlantId);
          BotanicalDB.addPhoto({
            plant_id: finalPlantId,
            filename: file.name,
            file_path: filePath,
            ppbc_id: meta.ppbc_id,
            photographer: meta.photographer,
            location: meta.location,
            is_primary: existingPhotos.length === 0
          });
          _addPhotosSuccess++;
        } catch (err) {
          _addPhotosFailed++;
          console.error('上传失败:', file.name, err);
          if (window.$toast) window.$toast.error('「' + file.name + '」上传失败：' + err.message);
        }
      }
      await BotanicalDB.saveDB();

      // 刷新当前详情页照片列表（响应式数组替换）
      try {
        const photos = BotanicalDB.getPlantPhotos(plantId);
        const paths = photos.filter(p => p.file_path).map(p => p.file_path);
        const urlMap = paths.length > 0 ? await BotanicalDB.getImageURLsBatch(paths) : {};
        currentPhotos.value = photos.map(p => ({
          ...p,
          image_url: urlMap[p.file_path] || ('data/images/' + p.file_path)
        }));
      } catch (err) {
        console.warn('刷新照片列表失败:', err);
      }
      await refreshData();

      if (window.$toast) {
        if (_addPhotosFailed === 0 && _addPhotosSuccess > 0) window.$toast.success('已上传 ' + _addPhotosSuccess + ' 张照片');
        else if (_addPhotosSuccess > 0 && _addPhotosFailed > 0) window.$toast.warning('完成：成功 ' + _addPhotosSuccess + '，失败 ' + _addPhotosFailed);
        else if (_addPhotosFailed > 0) window.$toast.error('全部 ' + _addPhotosFailed + ' 张照片上传失败');
      }
    }

    // ===== 手动添加物种 =====

    function onGenusInput() {
      const genus = addSpeciesForm.value.genus.trim();
      if (genus.length >= 2) {
        genusLookupResult.value = TaxonomyLookup.lookup(genus);
      } else {
        genusLookupResult.value = null;
      }
    }

    async function submitAddSpecies() {
      const form = addSpeciesForm.value;
      const genus = form.genus.trim();
      const epithet = form.species_epithet.trim();
      const authority = form.authority.trim();
      const latinName = genus + ' ' + epithet + (authority ? ' ' + authority : '');

      // 去重
      const existing = BotanicalDB.findPlantByBinomial(genus, epithet);
      if (existing) {
        addSpeciesResult.value = {
          status: 'error',
          message: `物种 ${genus} ${epithet} 已存在（${existing.chinese_name || existing.latin_name}）`
        };
        return;
      }

      const taxon = TaxonomyLookup.lookup(genus);
      const plantData = {
        latin_name: latinName,
        chinese_name: form.chinese_name.trim(),
        genus: genus,
        species_epithet: epithet,
        authority: authority || null,
        kingdom: taxon?.kingdom || '植物界 Plantae',
        phylum: taxon?.phylum || null,
        class: taxon?.class || null,
        order: taxon?.order || null,
        family: taxon?.family || null,
        notes: form.notes.trim() || '',
        // v3: 手动录入也走审定
        status: 'pending',
        data_source: 'manual'
      };

      const plantId = BotanicalDB.addPlant(plantData);
      BotanicalDB.ensureTaxonomyDescriptionsForPlant({ id: plantId, ...plantData });
      if (form.description.trim()) {
        BotanicalDB.updateDescription(plantId, form.description.trim());
      }
      BotanicalDB.addPendingChange('new_species', {
        plant_id: plantId,
        latin_name: latinName,
        chinese_name: form.chinese_name.trim(),
        source: 'manual'
      }, { target_table: 'plants', target_id: plantId });
      await BotanicalDB.saveDB();
      await refreshData();
      refreshPendingCount();

      addSpeciesResult.value = {
        status: 'success',
        message: `已进入审定页面：${form.chinese_name.trim()} (${genus} ${epithet})`
      };

      // 重置表单
      addSpeciesForm.value = {
        genus: '', species_epithet: '', authority: '',
        chinese_name: '', description: '', notes: ''
      };
      genusLookupResult.value = null;
    }

    // ===== FOC 浏览器导入 =====

    let _focParsedData = null;

    async function onFOCFileDrop(e) {
      isDragOver.value = false;
      const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
      if (files.length > 0) await parseFOCFile(files[0]);
    }

    async function onFOCFileSelect(e) {
      const files = Array.from(e.target.files);
      if (files.length > 0) await parseFOCFile(files[0]);
      e.target.value = '';
    }

    async function parseFOCFile(file) {
      try {
        const result = await FOCParser.parsePDF(file);
        _focParsedData = result;
        focParseResult.value = {
          familyDisplay: result.familyInfo.display,
          generaCount: result.generaCount,
          speciesCount: result.speciesCount
        };
      } catch (err) {
        importResults.value = [{ filename: file.name, status: 'error', message: err.message }];
        window.$toast?.error('FOC 解析失败：' + err.message);
      }
    }

    async function confirmFOCImport() {
      if (!_focParsedData) return;
      const data = _focParsedData;
      importResults.value = [];

      // 写入检索表到 taxonomy_descriptions
      if (data.keyToGenera.length > 0) {
        BotanicalDB.saveTaxonomyDescription({
          taxon_level: 'family',
          taxon_name: data.familyInfo.latin,
          family: data.familyInfo.display,
          description: '',
          key_data: JSON.stringify(data.keyToGenera),
          key_text: ''
        });
      }

      // 更新 taxonomy-lookup 并导入物种
      let newCount = 0, mergeCount = 0;
      for (const sp of data.species) {
        const taxon = TaxonomyLookup.lookup(sp.genus);
        const existing = BotanicalDB.findPlantByBinomial(sp.genus, sp.species_epithet);

        if (existing) {
          mergeCount++;
        } else {
          BotanicalDB.addPlant({
            latin_name: sp.latin_name + (sp.authority ? ' ' + sp.authority : ''),
            chinese_name: sp.chinese_name,
            genus: sp.genus,
            species_epithet: sp.species_epithet,
            authority: sp.authority,
            kingdom: taxon?.kingdom || '植物界 Plantae',
            phylum: taxon?.phylum || null,
            class: taxon?.class || null,
            order: taxon?.order || null,
            family: taxon?.family || data.familyInfo.display,
            notes: ''
          });
          newCount++;
        }
      }

      await BotanicalDB.saveDB();
      await refreshData();

      importResults.value = [{
        filename: data.familyInfo.display,
        status: 'success',
        message: `导入完成：${newCount} 新增, ${mergeCount} 已存在`
      }];
      focParseResult.value = null;
      _focParsedData = null;
    }

    // ===== 导入功能 =====

    async function onFileDrop(e) {
      isDragOver.value = false;
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      if (files.length > 0) {
        await importFiles(files);
      }
    }

    async function onFileSelect(e) {
      const files = Array.from(e.target.files);
      if (files.length > 0) {
        await importFiles(files);
      }
    }

    async function importFiles(files) {
      importResults.value = [];
      const usedPhotoPaths = getUsedPhotoPaths();

      for (const file of files) {
        try {
          const parsed = PPBCParser.parse(file.name);

          if (!parsed.latin_name) {
            importResults.value.push({
              filename: file.name, status: 'error', message: '无法解析文件名'
            });
            continue;
          }

          // 查找或创建植物记录
          let plant = BotanicalDB.findPlantByLatinName(parsed.latin_name);
          if (!plant && parsed.genus && parsed.species_epithet) {
            // 拉丁名带命名人时精确匹配失败,降级用 genus + species_epithet 再查
            plant = BotanicalDB.findPlantByBinomial(parsed.genus, parsed.species_epithet);
          }
          let isNew = false;
          let isPending = false;
          let plantData = null;

          if (!plant) {
            // v3: 拉丁名未匹配 → 创建 status='pending' 的物种，并加入审定队列
            const taxon = TaxonomyLookup.lookup(parsed.genus);
            plantData = {
              latin_name: parsed.latin_name,
              chinese_name: parsed.chinese_name,
              genus: parsed.genus,
              species_epithet: parsed.species_epithet,
              authority: parsed.authority,
              kingdom: taxon?.kingdom || '植物界 Plantae',
              phylum: taxon?.phylum || null,
              class: taxon?.class || null,
              order: taxon?.order || null,
              family: taxon?.family || null,
              notes: '',
              status: 'pending',
              data_source: 'PPBC'
            };
          } else if (plant.status === 'pending') {
            isPending = true;
          }

          // 生成安全的文件路径
          const filePath = makeUniqueImagePath(file, usedPhotoPaths);
          const saved = await BotanicalDB.saveImage(filePath, file);
          if (!saved) throw new Error('图片文件保存失败');
          await BotanicalDB.getImageURL(filePath);

          if (!plant && plantData) {
            const plantId = BotanicalDB.addPlant(plantData);
            plant = { id: plantId, ...plantData };
            isNew = true;
            isPending = true;
            BotanicalDB.ensureTaxonomyDescriptionsForPlant(plant);

            BotanicalDB.addPendingChange('new_species', {
              plant_id: plantId,
              latin_name: parsed.latin_name,
              chinese_name: parsed.chinese_name,
              source: 'PPBC',
              filename: file.name
            }, { target_table: 'plants', target_id: plantId });
          }

          // 添加照片记录
          const existingPhotos = BotanicalDB.getPlantPhotos(plant.id);
          BotanicalDB.addPhoto({
            plant_id: plant.id,
            filename: file.name,
            file_path: filePath,
            ppbc_id: parsed.ppbc_id,
            photographer: parsed.photographer,
            location: parsed.location,
            is_primary: existingPhotos.length === 0
          });

          let msg, status;
          if (isPending && isNew) {
            msg = `已进入审定页面: ${parsed.chinese_name || parsed.latin_name}`;
            status = 'pending';
          } else if (isPending) {
            msg = `追加到待审定: ${parsed.chinese_name || parsed.latin_name}`;
            status = 'pending';
          } else {
            msg = `追加照片: ${parsed.chinese_name || parsed.latin_name}`;
            status = 'success';
          }

          importResults.value.push({
            filename: file.name,
            status,
            message: msg
          });

        } catch (e) {
          importResults.value.push({
            filename: file.name, status: 'error', message: e.message
          });
          window.$toast?.error('导入失败：' + file.name);
        }
      }

      // 持久化并刷新
      await BotanicalDB.saveDB();
      await refreshData();
      refreshPendingCount();
    }

    // ===== 分类学超链接 =====
    function onTaxonomyNavigate({ level, value }) {
      if (level === 'family' || level === 'genus') {
        explorerInitialTaxon.value = { level, value };
        showExplorer.value = true;
      } else {
        currentPlant.value = null;
        onTaxonSelect({ level, value, label: value });
      }
    }

    function closeExplorer() {
      showExplorer.value = false;
      explorerInitialTaxon.value = null;
    }

    return {
      loading, allPlants, filteredPlants, displayedPlants, currentPlant, currentPhotos,
      currentInfraspecific, currentParentPlant,
      taxonomyTree, searchQuery, isSearching, showExplorer, selectedTaxonPath,
      breadcrumbs, totalPlants, showImportDialog, isDragOver, importResults,
      searchInput, importTab, importHintFamily, dictionaryResults,
      addSpeciesForm, genusLookupResult, addSpeciesResult, canSubmitSpecies,
      focParseResult, hasMore, scrollContentRef, sentinelRef,
      explorerInitialTaxon,
      onSearchInput, doSearch, clearSearch, onTaxonSelect, onBreadcrumbClick,
      openPlant, deletePlant, deletePhoto, savePhotoMeta, saveDescription,
      addPhotosToPlant, goHome, onFileDrop, onFileSelect,
      onGenusInput, submitAddSpecies,
      onFOCFileDrop, onFOCFileSelect, confirmFOCImport,
      onExplorerNavigatePlant, onTaxonomyNavigate, closeExplorer,
      appVersion, pendingCount, openPendingQueue, refreshPendingCount,
      showDictionary, openDictionary, closeDictionary,
      showSettings, settings, openSettings, closeSettings, onSettingsChanged, onDatabaseRestored, openFOCImport,
      currentRoute, showPendingQueue, openAdminPage, closeOverlay,
      reviseDialog, addTaxonDialog, openReviseDialog, closeReviseDialog,
      openAddTaxonDialog, closeAddTaxonDialog, onTaxonRevisionSubmitted,
      isHomeView, topFamilies, topRegions, familyBlocks, totalFamilies
    };
  }
});

// 注册组件（定义在 js/components.js 中）
app.component('TaxonomyTree', TaxonomyTreeComponent);
app.component('PlantDetail', PlantDetailComponent);
app.component('KeyBranch', KeyBranchComponent);
app.component('DichotomousKey', DichotomousKeyComponent);
app.component('TaxonomyIntro', TaxonomyIntroComponent);
app.component('TaxonomyExplorer', TaxonomyExplorerComponent);
// v3 新增
app.component('AdminPicker', AdminPickerComponent);
app.component('PendingQueue', PendingQueueComponent);
app.component('PendingCard', PendingCardComponent);
app.component('AdminPage', AdminPageComponent);
app.component('ReviseDialog', ReviseDialogComponent);
app.component('AddTaxonDialog', AddTaxonDialogComponent);
app.component('DictionaryPanel', DictionaryPanelComponent);
app.component('SettingsDialog', SettingsDialogComponent);
app.component('ToastCenter', ToastComponent);

// 挂载应用
app.mount('#app');
