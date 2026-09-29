import { IVodSync } from './interface4log.js';

/**
 * SOOP 원본 다시보기에서 파생된 클립·캐치가 원본의 어느 구간인지 지도로 보여준다. (구간은 재생 시간축 기준, changeSecond)
 *
 * - 원본 다시보기일 때만 동작한다. video info로 먼저 확인하고, 아니면 버튼도 만들지 않는다.
 * - 클립·캐치 검색은 사용자가 열기 버튼을 눌러 패널이 처음 만들어진 뒤에 시작한다.
 * - 상수와 순수 함수는 static 멤버라 인스턴스 없이 쓸 수 있다. 최상위에 클래스만 두는 건, TamperMonkey 빌드가
 *   모듈을 한 스코프에 이어 붙여서 최상위 이름이 다른 모듈과 충돌할 수 있기 때문이다.
 */
export class SoopClipMap extends IVodSync {
    constructor() {
        super();
        this.enabled = true;
        this.videoId = window.location.pathname.match(/\/player\/(\d+)/)?.[1] ?? '';
        /** 클립 탐색기 열기 버튼(button). createOpenClipMapButton이 만들고 positioningClipMapButton이 자리를 맞춘다. */
        this.openButton = null;
        this._vodInfo = null; // init에서 확인한 이 다시보기의 상세(a/view) 응답 data

        this._host = null;
        this._root = null;
        this._open = false;
        this._popupWin = null; // 팝업 창으로 뺐을 때 그 창(window). 페이지에 있으면 null.
        this._popupWatch = null;
        this._pollTimer = null;
        this._renderQueued = false;
        this._drag = null;
        this._toastTimer = null;
        this._geom = { W: 0 };

        /** @type {ReturnType<SoopClipMap['_newData']>|null} 열린 다시보기의 데이터 */
        this._d = null;
        this._ui = {
            view: { s: 0, e: 1 }, ph: 0, hover: null, sort: 'start', axis: 'play',
            kinds: { CLIP: true, CATCH: true }, listOpen: false, // listOpen: 오른쪽 클립·캐치 목록을 펼쳐 두었는가 (기본은 접힘)
            picked: new Set(), lastPick: null, // 목록에서 체크박스로 고른 항목 id (타임라인 복사용)
        };
        this._onKeyDown = (e) => {
            if (this._open && e.key === 'Escape') this.hideClipMapPanel();
        };
        this.log('loaded');
        this.init();
    }

    async init() {
        await this._loadSettings();
        if (!this.enabled) {
            this.log('설정 OFF — 클립 탐색기 건너뜀');
            return;
        }
        // 원본 다시보기에서만 동작한다. 아니면 버튼도 만들지 않는다.
        // (timestamp manager가 같은 요청을 하고 SoopAPI가 캐시하므로 추가 요청이 아니다.)
        let info = null;
        try {
            info = await window.VODSync.soopAPI.GetSoopVodInfo(this.videoId);
        } catch (e) {
            this.warn('다시보기 정보 요청 실패:', e);
        }
        if (!info || info.result !== 1 || !info.data) {
            this.warn('다시보기 정보를 읽지 못해 클립 탐색기를 건너뜀');
            return;
        }
        if (info.data.file_type !== 'REVIEW') {
            this.log(`원본 다시보기가 아니라(${info.data.file_type}) 아무것도 하지 않아요.`);
            return;
        }
        this._vodInfo = info.data;
        this.log(`시작: ${window.location.pathname} — 유저 클립 버튼 옆에 지도 버튼을 붙입니다. 패널을 열기 전에는 클립 검색 요청을 하지 않아요.`);
        this.createOpenClipMapButton();
        this.startButtonMonitoring();
    }

    // ---------- 열기 버튼 ----------

    /** 열기 버튼(button)을 만들어 this.openButton에 둔다. 페이지에 붙이는 건 positioningClipMapButton이다. */
    createOpenClipMapButton() {
        // 크기·배치는 SOOP 목록 CSS(.player_item_list ul li>button 36x36, em 100%)를 그대로 따른다.
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = SoopClipMap.BUTTON_CLASS;
        btn.setAttribute('tip', '클립 탐색기');
        btn.setAttribute('aria-expanded', 'false');
        const em = document.createElement('em');
        const span = document.createElement('span');
        span.textContent = '클립 탐색기';
        btn.append(em, span);
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleClipMapPanel();
        });
        this.openButton = btn;
    }

    /** 열기 버튼이 제자리에 있도록 주기적으로 확인한다. (SOOP이 목록을 다시 그리면 사라지므로) */
    startButtonMonitoring() {
        this.positioningClipMapButton();
        setInterval(() => this.positioningClipMapButton(), SoopClipMap.BUTTON_CHECK_MS);
    }

    /**
     * 열기 버튼을 "유저 클립" 버튼 옆에 붙인다. 주기적으로 불리며 붙일 필요가 없으면 아무것도 하지 않는다.
     * 붙이는 경우: 문서와의 연결이 끊어졌을 때(목록이 다시 그려짐), 또는 보이지 않는 목록에 붙어 있는데 보이는 목록이 따로 있을 때.
     * SOOP은 같은 버튼 목록을 두 곳에 그려서 #vodUserClip이 여러 개이고, 한쪽은 숨겨져(크기 0) 있다.
     */
    positioningClipMapButton() {
        const btn = this.openButton;
        if (!btn) return;
        const isShown = (el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        };
        const anchors = [...document.querySelectorAll('#' + SoopClipMap.ANCHOR_LI_ID)]; // getElementById는 첫 번째만 준다.
        const anchor = anchors.find(isShown) ?? anchors[0];
        if (!anchor) return; // 버튼 목록이 아직 없다. 다음 주기에 다시 시도한다.

        if (!btn.isConnected || (!isShown(btn) && isShown(anchor))) {
            btn.closest('li')?.remove(); // 이전 자리에 남은 li
            const li = document.createElement('li');
            li.className = SoopClipMap.BUTTON_CLASS;
            li.append(btn);
            anchor.after(li);
            const msg = `클립 탐색기 버튼을 붙였어요. (#${SoopClipMap.ANCHOR_LI_ID} 목록 ${anchors.length}개 중 화면에 보이는 목록 ${anchors.filter(isShown).length}개)`;
            if (btn.dataset.vsPlaced) this.debug(msg);
            else this.log(msg);
            btn.dataset.vsPlaced = '1';
        }

        // 아이콘 선 색은 이웃 버튼(유저 클립)을 따라간다. (SOOP이 모드마다 바꾼다) 읽지 못하면 기본 색.
        let color = '#525661';
        try {
            const neighborEm = (btn.closest('li')?.previousElementSibling ?? anchor).querySelector('em');
            const bg = neighborEm ? decodeURIComponent(getComputedStyle(neighborEm).backgroundImage) : '';
            color = bg.match(/stroke=['"](#[0-9a-fA-F]{3,8})['"]/)?.[1] ?? color;
        } catch (e) {
            /* 기본 색 */
        }
        if (btn.dataset.vsColor !== color) {
            btn.dataset.vsColor = color;
            const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36' viewBox='0 0 36 36' fill='none' stroke='${color}' `
                + "stroke-width='2.2' stroke-linecap='round'><path d='M9 11.5h11M13.5 18h13M19 24.5h8'/></svg>";
            const em = btn.querySelector('em');
            if (em) em.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
        }
    }

    // ---------- 패널 ----------

    /** 열기 버튼 클릭: 패널이 없으면 만들어 보여주고, 있으면 보이는 상태에 따라 숨기거나 보인다. */
    toggleClipMapPanel() {
        if (!this._host) {
            this.createClipMapPanel();
            this.showClipMapPanel();
        } else if (this._open) {
            this.hideClipMapPanel();
        } else {
            this.showClipMapPanel();
        }
    }

    /** 패널 뼈대(Shadow DOM)를 만든다. 처음 열 때 한 번만 부르며, 보이게 하는 건 showClipMapPanel이다. */
    createClipMapPanel() {
        const host = document.createElement('div');
        host.id = 'vs-clip-map-host';
        host.hidden = true;
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = `<style>${SoopClipMap.CLIP_MAP_CSS}</style>
<div class="sheet" id="sheet">
  <div class="panel" role="dialog" aria-label="클립 탐색기">
    <div class="ph">
      <div class="ph-l"><h3>클립 탐색기</h3><span class="sub" id="vodMeta"></span></div>
      <div class="ph-r">
        <span class="readout" id="readout"></span>
        <button class="btn" id="btnList" aria-expanded="false">목록 펴기 ◂ (0)</button>
        <button class="btn" id="btnRescan">다시 검색</button>
        <button class="btn" id="btnPopout">⧉ 새 창으로 보기</button>
        <button class="btn" id="btnClose" aria-label="탐색기 닫기">닫기 ✕</button>
      </div>
    </div>
    <div class="body nolist" id="body">
      <div class="main">
        <div class="sumrow">
          <span class="info" id="info"></span>
        </div>
        <div class="scanrow" id="scanrow" hidden></div>
        <div class="toolbar">
          <div class="kinds" role="group" aria-label="보기">
            <button class="chip" id="kAll" data-kind="all" aria-pressed="true">전체 <b id="cAll">0</b></button>
            <button class="chip" id="kClip" data-kind="CLIP" aria-pressed="false"><i class="sw sw-clip"></i>클립 <b id="cClip">0</b></button>
            <button class="chip" id="kCatch" data-kind="CATCH" aria-pressed="false"><i class="sw sw-catch"></i>캐치 <b id="cCatch">0</b></button>
          </div>
          <div class="seg" id="segAxis" role="group" aria-label="시간축">
            <button data-axis="play" aria-pressed="true">재생 시간</button>
            <button data-axis="wall" aria-pressed="false">라이브 시각</button>
          </div>
          <div class="hot" id="hot"></div>
          <div class="sp"></div>
          <span class="hint" id="laneHint" hidden>Alt+휠: 겹친 줄 위아래 스크롤</span>
          <div class="legend" id="legend"></div>
          <div class="zoom" role="group" aria-label="확대·축소">
            <button class="btn" id="zOut" aria-label="축소">−</button>
            <button class="btn" id="zAll">전체</button>
            <button class="btn" id="zIn" aria-label="확대">+</button>
          </div>
        </div>
        <div class="mapwrap" id="mapWrap"><div id="topBox"></div><div class="lanes" id="lanesBox"></div></div>
        <div class="selbar" id="selbar"></div>
      </div>
      <aside class="side">
        <div class="lh">
          <h4 id="listTitle"></h4>
          <div class="seg" id="segSort" role="group" aria-label="정렬">
            <button data-sort="start" aria-pressed="true">구간 시작순</button>
            <button data-sort="views" aria-pressed="false">조회수순</button>
            <button data-sort="likes" aria-pressed="false">추천순</button>
            <button data-sort="len" aria-pressed="false">긴 순</button>
          </div>
        </div>
        <div class="pickbar" id="pickbar">
          <label><input type="checkbox" id="pickAll"> 전체 선택</label>
          <span class="cnt" id="pickCount">선택 0개</span>
          <button class="btn" id="pickClear">선택 해제</button>
          <select id="pickCopy" aria-label="선택한 항목을 댓글 타임라인 형식으로 복사" title="선택한 항목을 댓글 타임라인 형식(HH:MM:SS ~ HH:MM:SS 이름)으로 복사합니다. 옵션을 선택하면 즉시 복사됩니다.">
            <option value="prompt">타임라인 복사(선택하세요)</option>
            <option value="none">이름을 제외하여 복사</option>
            <option value="prefix">이름을 앞에 붙여 복사</option>
            <option value="suffix">이름을 뒤에 붙여 복사</option>
          </select>
        </div>
        <div class="list" id="list"></div>
      </aside>
    </div>
    <div id="msg" hidden></div>
  </div>
  <div class="grip" id="grip" role="separator" aria-orientation="horizontal" aria-label="패널 높이 조절"></div>
  <div class="tip" id="tip" hidden></div>
  <div class="toast" id="toast" hidden></div>
</div>`;
        document.body.appendChild(host);
        this._host = host;
        this._root = root;
        this._$('#legend').innerHTML = '겹침 ' + SoopClipMap.LEGEND_LABELS.map((l, i) =>
            `<span class="lg"><i style="background:var(--h${i + 1})"></i>${l}</span>`).join('');
        this._wireEvents();
        new ResizeObserver(() => { if (this._open && this._d?.vod && (this._d.phase === 'ready' || this._d.scanning)) this._renderMap(); }).observe(this._$('#mapWrap'));

        // 뼈대가 만들어진 직후 클립·캐치 검색을 시작한다. 결과는 addItems로 들어온다.
        this._d = this._newData(this.videoId);
        this._startInitialScan();
    }

    showClipMapPanel() {
        this.log('탐색기 열기');
        this._open = true;
        this._host.hidden = false;
        this.openButton?.setAttribute('aria-expanded', 'true');
        this._applyTheme();
        document.addEventListener('keydown', this._onKeyDown, true);
        this._pollTimer = setInterval(() => this._tick(), SoopClipMap.POLL_MS); // 재생 위치 선 갱신
        this._renderAll();
    }

    hideClipMapPanel() {
        this.log('탐색기 닫기');
        if (this._popupWin) this._dockPanel(); // 새 창으로 나가 있었으면 먼저 페이지로 데려온다
        this._open = false;
        this._host.hidden = true;
        this.openButton?.setAttribute('aria-expanded', 'false');
        document.removeEventListener('keydown', this._onKeyDown, true);
        clearInterval(this._pollTimer);
        this._pollTimer = null;
    }

    /** 패널 안 "새 창으로 보기" 버튼: 나가 있으면 페이지로 되돌리고, 페이지에 있으면 새 창으로 뺀다. */
    _togglePopout() {
        if (this._popupWin && !this._popupWin.closed) this._dockPanel();
        else this._popOutPanel();
    }

    /** 패널 DOM(호스트)을 그대로 새 창으로 옮긴다. 같은 노드를 옮기는 것이라 이벤트·상태가 그대로 이어진다. */
    _popOutPanel() {
        const w = window.open('', 'vodMasterClipMap', 'width=1180,height=820,menubar=no,toolbar=no,location=no,status=no');
        if (!w) {
            this._toast('팝업이 차단되었어요. 주소창의 팝업 차단 표시를 허용한 뒤 다시 시도해 주세요.');
            return;
        }
        w.document.title = '클립 탐색기';
        w.document.body.style.cssText = 'margin:0;min-height:100vh';
        w.document.body.appendChild(this._host); // appendChild가 다른 문서 소속 노드를 그대로 입양한다 (섀도우 루트 포함)
        this._host.hidden = false;
        this._host.classList.add('popped');
        this._popupWin = w;
        w.addEventListener('pagehide', () => this._dockPanel());
        w.addEventListener('keydown', this._onKeyDown, true);
        w.addEventListener('resize', () => { if (this._d?.vod) this._renderMap(); });
        this._popupWatch = setInterval(() => { if (w.closed) this._dockPanel(); }, 400); // 창을 닫아도 이벤트가 안 오는 경우 대비
        this._$('#btnPopout').textContent = '◱ 페이지로 가져오기';
    }

    /** 새 창에 나가 있던 패널을 다시 원래 페이지로 데려온다. */
    _dockPanel() {
        if (!this._popupWin) return;
        const w = this._popupWin;
        this._popupWin = null;
        clearInterval(this._popupWatch);
        this._popupWatch = null;
        this._host.classList.remove('popped');
        document.body.appendChild(this._host);
        this._host.hidden = !this._open;
        if (this._$('#btnPopout')) this._$('#btnPopout').textContent = '⧉ 새 창으로 보기';
        try {
            if (!w.closed) w.close();
        } catch (e) {
            /* 이미 닫히는 중이면 무시 */
        }
        if (this._open) this._renderAll(); // 창 크기가 달라졌을 수 있으니 다시 그린다
    }

    /** 툴팁·손잡이 드래그처럼 화면 크기가 필요한 계산에 쓸 창. 새 창으로 나가 있으면 그 창 기준. */
    _activeWin() {
        return (this._popupWin && !this._popupWin.closed) ? this._popupWin : window;
    }

    // ---------- 클립·캐치 추가 ----------

    /**
     * 구간 확인이 끝난 클립·캐치를 추가한다. 이미 있는 id는 건너뛰고, 추가된 게 있으면 화면 갱신을 요청한다. (한 프레임에 한 번으로 묶인다.)
     * 클립에서 만든 캐치는 부모 클립이 먼저 추가되어 있어야 하므로 한 기간에서는 클립을 먼저 검색한다.
     */
    addItems(items) {
        const d = this._d;
        let added = false;
        for (const it of items) {
            if (d.byId.has(it.id)) continue;
            d.items.push(it);
            d.byId.set(it.id, it);
            added = true;
        }
        if (added) this._requestRender();
    }

    // ---------- 내부 동작 (검색·데이터·렌더링·타임라인 복사) ----------

    async _loadSettings() {
        // TamperMonkey: 설정은 GM 저장소(유저스크립트 메뉴에서 바꾼다).
        if (window.VODSync?.IS_TAMPER_MONKEY_SCRIPT === true) {
            if (typeof GM_getValue === 'function') this.enabled = GM_getValue('enableClipMap', true) !== false;
            return;
        }
        try {
            const response = await chrome.runtime.sendMessage({ action: 'getAllSettings' });
            if (response?.success && response.settings) {
                this.enabled = response.settings.enableClipMap !== false;
            }
        } catch (error) {
            this.warn('설정 로드 실패, 기본값 사용:', error);
        }
    }

    _applyTheme() {
        try {
            const bg = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [255, 255, 255];
            const alpha = bg.length > 3 ? bg[3] : 1;
            const lum = alpha === 0 ? 255 : 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2];
            this._$('#sheet').classList.toggle('dark', lum < 110);
        } catch (e) {
            /* 밝은 테마 유지 */
        }
    }

    _newData(videoId) {
        return {
            videoId,
            phase: 'idle', // idle | loading | ready | error
            error: '', searchError: '', scanning: false, scan: null,
            streamerId: '', vod: null, durationSec: 0,
            items: [], byId: new Map(),
            plan: null,        // 다음에 검색할 기간을 정하는 상태 { cursor, stepIndex }
            windows: [],       // 검색한 기간 기록 { start, end, days, label, done, found }
            searchDone: false, // 오늘까지 검색을 마쳤는가
            paused: false,     // 연결된 항목이 0건인 기간에서 멈춤 (다음 구간 검색을 눌러야 이어진다)
            winLabel: '',      // 지금 검색 중인 기간 문구
            scanned: { CLIP: 0, CATCH: 0 },
            api: { search: 0, view: 0 },
            sel: null,
            cache: {}, // 클립 상세(a/view) 확인 결과. 메모리에만 두므로 새로고침하면 다시 확인한다.
        };
    }

    /** 네트워크 실패는 영어 TypeError("Failed to fetch")로 오므로 사용자용 문구로 바꾼다. */
    _friendlyError(e) {
        if (e instanceof TypeError) return '네트워크에 연결하지 못했어요.';
        return e?.message || '잠시 후 다시 시도해 주세요.';
    }

    /**
     * 진행 문구와 진행률(라이브 시작일~오늘 중 검색을 끝낸 기간의 비율). 검색과 구간 확인이 동시에 진행되므로 각각의 문구를 이어 붙인다.
     * (view=true면 구간 확인 쪽)
     */
    _setScan(label, view = false) {
        const d = this._d;
        if (!d) return;
        const pct = d.plan && d.vod ? Math.round(SoopClipMap.searchProgress(d.vod.startYmd, d.plan.cursor, SoopClipMap.todayYmd()) * 100) : 3;
        const parts = d.scanParts || (d.scanParts = { search: '', view: '' });
        parts[view ? 'view' : 'search'] = label;
        const text = [parts.search, parts.view].filter(Boolean).join(' · ');
        d.scan = { label: d.winLabel ? `${d.winLabel} · ${text}` : text, pct: SoopClipMap.clamp(pct, 3, 100) };
        this._requestRender();
    }

    async _startInitialScan() {
        const d = this._d;
        this.log('검색 시작 — 다시보기 정보를 확인합니다.');
        d.phase = 'loading';
        d.scanning = true;
        this._setScan('다시보기 정보 확인 중');
        this._renderAll();
        try {
            this._loadVodInfo(d);
            await this._searchLoop(d);
            d.phase = 'ready';
            this._pickDefaultSelection(d);
            this.log(`${d.searchDone ? '검색 완료' : '검색 일시 정지'} — 클립 ${d.items.filter((i) => i.kind === 'CLIP').length}개, `
                + `캐치 ${d.items.filter((i) => i.kind === 'CATCH').length}개, ${d.windows.length}개 기간 `
                + `(요청: 검색 ${d.api.search}건, 구간 확인 ${d.api.view}건)`);
        } catch (e) {
            this.error('클립 검색 실패:', e);
            if (d.items.length > 0) {
                // 찾은 결과는 남기고 중단 안내만 띄운다.
                d.phase = 'ready';
                d.searchError = this._friendlyError(e);
                this._pickDefaultSelection(d);
            } else {
                d.phase = 'error';
                d.error = this._friendlyError(e);
            }
        } finally {
            d.scanning = false;
            d.scan = null;
            d.winLabel = '';
            this._renderAll();
        }
    }

    /** init에서 확인한 this._vodInfo로 검색에 필요한 값(라이브 시각, 파일별 시각 매핑, 스트리머)을 만든다. */
    _loadVodInfo(d) {
        const info = this._vodInfo;
        const vod = SoopClipMap.parseWriteTm(info.write_tm);
        const total = Number(info.total_file_duration) / 1000;
        if (!vod || !info.bj_id || !(total > 0)) throw new Error('다시보기 정보가 올바르지 않아요.');
        const wallMap = SoopClipMap.buildWallMap(info.files, { startStamp: vod.startStamp, totalSec: total });
        d.vod = { ...vod, wallMap, gaps: SoopClipMap.wallGaps(wallMap) };
        d.streamerId = String(info.bj_id);
        d.durationSec = total;
        d.plan = SoopClipMap.firstSearchState(vod.startYmd);
        this.log(`다시보기 확인: 스트리머=${d.streamerId}, 길이=${SoopClipMap.formatHms(total)}, 라이브 ${vod.startYmd}~${vod.endYmd}`
            + (d.vod.gaps.length ? `, 빠진 구간 ${d.vod.gaps.length}곳 (라이브 ${d.vod.gaps.map((g) => SoopClipMap.formatDuration(g.skipSec)).join(', ')})` : ''));
        this._ui.view = { s: 0, e: total };
        const t = window.VODSync?.tsManager?.getCurPlaybackTime?.();
        this._ui.ph = typeof t === 'number' && Number.isFinite(t) ? t : 0;
    }

    /**
     * 라이브 시작일부터 오늘까지 기간을 나눠 검색한다. 1주 단위로 시작해, 연결된 항목이 나오는 동안은 같은 단위로 자동으로 이어간다.
     * 0건인 기간이 나오면 단위를 한 단계 키우고(1주 → 1개월 → 6개월 → 1년) 멈춘다. 이어서 하려면 "다음 구간 검색"을 눌러야 한다.
     * 실패로 끝내지 못한 기간이 있으면 그 기간부터 다시 검색한다.
     */
    async _searchLoop(d) {
        d.searchError = '';
        d.searchDone = false;
        d.paused = false;
        for (;;) {
            const win = SoopClipMap.nextSearchWindow(d.plan, SoopClipMap.todayYmd());
            if (!win) {
                d.searchDone = true;
                return;
            }
            // 실패한 기간을 이어서 검색하는 경우 기록을 재사용한다. (found 누적)
            let rec = d.windows[d.windows.length - 1];
            if (!rec || rec.done || rec.start !== win.start) {
                rec = { ...win, done: false, found: 0 };
                d.windows.push(rec);
            }
            const before = d.items.length;
            try {
                await this._scanWindow(d, rec);
            } finally {
                rec.found += d.items.length - before;
            }
            rec.done = true;
            d.plan = SoopClipMap.advanceSearchState(d.plan, win, rec.found);
            this.debug(`검색 ${win.start}~${win.end} (${win.label}): 연결된 항목 ${rec.found}개`);
            if (rec.found === 0) {
                const next = SoopClipMap.nextSearchWindow(d.plan, SoopClipMap.todayYmd());
                if (!next) {
                    d.searchDone = true; // 0건이지만 더 검색할 기간이 없다
                    return;
                }
                d.paused = true;
                this.log(`${win.start}~${win.end}에 연결된 항목이 없어 검색을 멈췄어요. 버튼을 누르면 ${next.label} 단위로 ${next.start}~${next.end}를 검색해요.`);
                return;
            }
        }
    }

    /** 한 기간의 클립을 먼저, 이어서 캐치를 검색한다. (클립에서 만든 캐치는 부모 클립이 먼저 있어야 위치를 계산할 수 있다.) */
    async _scanWindow(d, rec) {
        await this._scanKind(d, 'CLIP', rec);
        await this._scanKind(d, 'CATCH', rec);
    }

    async _scanKind(d, kind, win) {
        const md = (ymd) => ymd.slice(5).replace('-', '/');
        d.winLabel = `${md(win.start)} ~ ${md(win.end)} (${win.label} 단위)`;
        d.scanParts = { search: '', view: '' };
        // 검색 결과 페이지가 도착하는 대로 후보를 구간 확인에 넘겨, 검색이 끝나기 전에도 화면에 나타나게 한다.
        const resolver = this._makeResolver(d, kind);
        let rows;
        try {
            rows = await this._searchAll(d, kind, win, (page) => resolver.add(page));
        } catch (e) {
            resolver.cancel();
            throw e;
        }
        d.scanned[kind] += rows.length;
        await resolver.drain();
        this.debug(`${kind} ${win.start}~${win.end}: 검색 ${rows.length}건 중 연결 후보 ${resolver.total}건 (구간 정보 캐시 ${resolver.cached}건)`);
    }

    /**
     * 한 기간의 검색 결과를 모두 가져온다. 첫 페이지로 총 건수를 알고 나머지는 병렬로 가져온다.
     * onPage가 있으면 페이지마다 (다른 페이지와 겹치지 않는) 행을 넘겨 준다.
     */
    async _searchAll(d, kind, win, onPage) {
        const api = window.VODSync.soopAPI;
        const name = kind === 'CLIP' ? '클립' : '캐치';
        const passed = new Set();
        const emit = (list) => {
            if (!onPage) return;
            const fresh = list.filter((r) => !passed.has(String(r.title_no)));
            fresh.forEach((r) => passed.add(String(r.title_no)));
            if (fresh.length) onPage(fresh);
        };
        this._setScan(`${name} 검색 중`);
        const opts = { fileType: kind, startDate: win.start, endDate: win.end };
        const first = await api.SearchSoopClips(d.streamerId, { ...opts, page: 1 });
        d.api.search++;
        if (!first) throw new Error('클립 검색 서버에 연결하지 못했어요.');
        const pages = Math.ceil((Number(first.TOTAL_CNT) || 0) / SoopClipMap.SEARCH_PAGE_SIZE);
        let rows = first.DATA;
        emit(first.DATA);
        if (pages > 1) {
            let done = 1;
            const nums = Array.from({ length: pages - 1 }, (_, i) => i + 2);
            await SoopClipMap.mapLimit(nums, SoopClipMap.PAGE_CONCURRENCY, async (page) => {
                const r = await api.SearchSoopClips(d.streamerId, { ...opts, page });
                d.api.search++;
                if (!r) throw new Error('클립 검색 서버에 연결하지 못했어요.');
                rows = rows.concat(r.DATA);
                emit(r.DATA);
                done++;
                this._setScan(`${name} 검색 중 (${done}/${pages} 페이지)`);
            });
        }
        this._setScan(`${name} ${rows.length}건 검색 완료`);
        // 페이징 중 새 클립이 등록되면 페이지가 밀려 같은 항목이 두 번 올 수 있다.
        return [...new Map(rows.map((r) => [String(r.title_no), r])).values()];
    }

    _isCandidate(d, kind, row) {
        const id = String(row.title_no);
        const org = String(row.org_title_no ?? ''); // 일부 항목에는 이 필드가 없다.
        if (!org || d.byId.has(id)) return false;
        if (org === d.videoId) return true;
        // 캐치의 부모가 이 다시보기의 클립이면 구간을 합산해 배치한다.
        return kind === 'CATCH' && d.byId.get(org)?.kind === 'CLIP';
    }

    /**
     * 검색 결과 행을 받는 대로 구간 확인(a/view)을 진행하는 작업 큐. add()로 넣고, drain()으로 남은 확인이 끝나길 기다린다.
     * 확인이 끝난 항목은 바로 addItems로 들어간다.
     */
    _makeResolver(d, kind) {
        const queue = [];
        let active = 0;
        let failed = null;
        let idle = null;
        const r = { total: 0, done: 0, cached: 0 };
        const settle = () => { if (!active && (!queue.length || failed) && idle) { idle(); idle = null; } };
        const pump = () => {
            while (!failed && active < SoopClipMap.VIEW_CONCURRENCY && queue.length) {
                const row = queue.shift();
                active++;
                Promise.resolve().then(async () => {
                    const item = await this._buildItem(d, kind, row);
                    r.done++;
                    this._setScan(`구간 확인 ${r.done}/${r.total}`, true);
                    if (item) this.addItems([item]);
                }).catch((e) => { failed = failed || e; }).finally(() => { active--; pump(); settle(); });
            }
        };
        r.add = (rows) => {
            const cands = rows.filter((row) => this._isCandidate(d, kind, row));
            r.total += cands.length;
            r.cached += cands.filter((row) => d.cache[String(row.title_no)]).length;
            queue.push(...cands);
            pump();
        };
        r.cancel = () => { failed = failed || new Error('cancelled'); queue.length = 0; };
        r.drain = async () => {
            if (active || (queue.length && !failed)) await new Promise((res) => { idle = res; });
            if (failed) throw failed;
        };
        return r;
    }

    /** 검색 응답에는 시작 위치가 없어 클립 상세(a/view)를 읽는다. 결과는 바뀌지 않으므로 캐시한다. */
    async _buildItem(d, kind, row) {
        const id = String(row.title_no);
        const org = String(row.org_title_no);
        let ent = d.cache[id];
        if (!ent) {
            const info = await window.VODSync.soopAPI.GetSoopVodInfo(id);
            d.api.view++;
            const scheme = SoopClipMap.parseOriginalClipScheme(info?.data?.original_clip_scheme);
            if (!scheme) {
                this.warn(`구간 정보를 읽지 못해 건너뜀: ${id}`);
                return null;
            }
            ent = [scheme.titleNo, scheme.changeSecond];
            d.cache[id] = ent;
        }
        if (ent[0] !== org) {
            this.warn(`검색 결과와 클립 상세의 원본이 달라 건너뜀: ${id}`);
            return null;
        }
        let s;
        if (org === d.videoId) {
            s = ent[1];
        } else {
            const parent = d.byId.get(org);
            if (!parent || parent.kind !== 'CLIP') return null;
            s = parent.s + ent[1];
        }
        let len = Number(row.vod_duration) / 1000;
        if (!(len > 0) && typeof row.duration === 'string') {
            const p = row.duration.split(':').map(Number);
            len = p.reduce((a, v) => a * 60 + v, 0);
        }
        if (!(len > 0) || !(s < d.durationSec)) return null;
        const e = Math.min(s + len, d.durationSec);
        const thumb = String(row.thumbnail_path || row.mobile_thumbnail_path || '').replace(/^http:\/\//, 'https://');
        return {
            id, kind, s, e, len: e - s, lane: 0,
            title: String(row.title || row.b_title || ''),
            nick: String(row.user_nick || row.user_id || ''),
            views: Number(row.view_cnt) || 0,
            likes: Number(row.recomm_cnt) || 0,
            regDate: String(row.reg_date || ''),
            thumb, hue: Number(id) % 360,
            parent: org === d.videoId ? null : org,
        };
    }

    _pickDefaultSelection(d) {
        const top = d.items.filter((i) => i.kind === 'CLIP').sort((a, b) => b.views - a.views)[0];
        d.sel = top ? top.id : null;
    }

    async _runTask(d, label, fn) {
        if (d.scanning) return;
        d.scanning = true;
        d.winLabel = '';
        this._setScan(label);
        this._renderAll();
        try {
            await fn();
        } catch (e) {
            this.error(`${label} 실패:`, e);
            d.searchError = this._friendlyError(e);
            this._toast(d.searchError);
            return false;
        } finally {
            d.scanning = false;
            d.scan = null;
            d.winLabel = '';
            this._renderAll();
        }
        return true;
    }

    /** 처음부터 다시 검색한다. 이미 구간을 확인한 클립은 캐시를 쓴다. */
    async _rescan() {
        const d = this._d;
        if (!d || d.scanning) return;
        this.log('다시 검색');
        const reset = () => {
            d.items = [];
            d.byId.clear();
            d.scanned = { CLIP: 0, CATCH: 0 };
            d.windows = [];
            d.searchDone = false;
            d.paused = false;
            d.searchError = '';
            d.sel = null;
            this._ui.picked.clear();
            this._ui.lastPick = null;
            d.plan = d.vod ? SoopClipMap.firstSearchState(d.vod.startYmd) : null;
        };
        if (d.phase === 'error' || !d.vod) {
            d.phase = 'idle';
            reset();
            this._startInitialScan();
            return;
        }
        await this._runTask(d, '다시 검색 중', async () => {
            reset();
            await this._searchLoop(d);
            this._pickDefaultSelection(d);
        });
    }

    /** 멈춘 자리(연결된 항목이 0건이었던 기간의 다음, 또는 실패한 기간)부터 이어서 검색한다. */
    async _continueSearch() {
        const d = this._d;
        if (!d || d.scanning || d.searchDone || !d.vod) return;
        this.log('다음 구간 검색');
        await this._runTask(d, '다음 구간 검색 중', async () => {
            await this._searchLoop(d);
            if (!d.byId.has(d.sel)) this._pickDefaultSelection(d);
        });
    }

    /** 보기를 전체/클립만/캐치만 중 하나로 바꾼다. 표시만 바뀌고 검색은 항상 둘 다 한다. */
    _setKinds(mode) {
        this._ui.kinds = { CLIP: mode !== 'CATCH', CATCH: mode !== 'CLIP' };
        this._renderAll();
    }

    _seek(sec) {
        const ts = window.VODSync?.tsManager;
        if (ts?.moveToPlaybackTime) ts.moveToPlaybackTime(sec, false);
        this._ui.ph = sec;
        this._updatePlayhead();
    }

    _select(id) {
        const d = this._d;
        d.sel = id;
        const it = d.byId.get(id);
        if (it) this._ensureVisible(it);
        this._renderMap();
        this._renderSel();
        this._renderList();
    }

    _ensureVisible(it) {
        const v = this._ui.view;
        const span = v.e - v.s;
        if (it.e < v.s || it.s > v.e) {
            const s = SoopClipMap.clamp((it.s + it.e) / 2 - span / 2, 0, this._d.durationSec - span);
            this._ui.view = { s, e: s + span };
        }
    }

    _setView(s, e) {
        const D = this._d.durationSec;
        const span = SoopClipMap.clamp(e - s, Math.min(SoopClipMap.MIN_SPAN_SEC, D), D);
        const ns = SoopClipMap.clamp(s, 0, D - span);
        this._ui.view = { s: ns, e: ns + span };
        this._renderMap();
    }

    _zoomBy(factor, anchor) {
        const { s, e } = this._ui.view;
        const span = e - s;
        const D = this._d.durationSec;
        const ns = SoopClipMap.clamp(span * factor, Math.min(SoopClipMap.MIN_SPAN_SEC, D), D);
        const a = anchor ?? s + span / 2;
        const ratio = (a - s) / span;
        this._setView(a - ratio * ns, a - ratio * ns + ns);
    }

    /** 재생 위치가 바뀌었으면 지도의 재생 위치 선을 갱신한다. */
    _tick() {
        if (!this._open) return;
        const t = window.VODSync?.tsManager?.getCurPlaybackTime?.();
        if (typeof t !== 'number' || !Number.isFinite(t)) return;
        if (Math.abs(t - this._ui.ph) >= 0.25) {
            this._ui.ph = t;
            this._updatePlayhead();
        }
    }

    _$(sel) {
        return this._root.querySelector(sel);
    }

    _requestRender() {
        if (this._renderQueued || !this._open) return;
        this._renderQueued = true;
        requestAnimationFrame(() => {
            this._renderQueued = false;
            if (this._open && this._d) this._renderAll();
        });
    }

    _visible() {
        return this._d ? this._d.items.filter((i) => this._ui.kinds[i.kind]) : [];
    }

    _kindLabel() {
        const k = this._ui.kinds;
        return k.CLIP && k.CATCH ? '클립·캐치' : k.CATCH ? '캐치' : '클립';
    }

    _wireEvents() {
        const $ = (s) => this._$(s);
        const ui = this._ui;
        $('#btnClose').addEventListener('click', () => this.hideClipMapPanel());
        $('#btnList').addEventListener('click', () => this._toggleList());
        $('#btnRescan').addEventListener('click', () => this._rescan());
        $('#btnPopout').addEventListener('click', () => this._togglePopout());
        $('#kAll').addEventListener('click', () => this._setKinds('all'));
        $('#kClip').addEventListener('click', () => this._setKinds('CLIP'));
        $('#kCatch').addEventListener('click', () => this._setKinds('CATCH'));
        $('#zIn').addEventListener('click', () => this._zoomBy(0.6));
        $('#zOut').addEventListener('click', () => this._zoomBy(1.6));
        $('#zAll').addEventListener('click', () => this._setView(0, this._d.durationSec));
        $('#segAxis').addEventListener('click', (e) => {
            const b = e.target.closest('[data-axis]');
            if (!b) return;
            ui.axis = b.dataset.axis;
            [...$('#segAxis').children].forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
            this._renderMap();
        });
        $('#segSort').addEventListener('click', (e) => {
            const b = e.target.closest('[data-sort]');
            if (!b) return;
            ui.sort = b.dataset.sort;
            [...$('#segSort').children].forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
            this._renderList();
        });
        $('#hot').addEventListener('click', (e) => {
            const b = e.target.closest('[data-hs]');
            if (!b || !this._hotspots) return;
            const h = this._hotspots[Number(b.dataset.hs)];
            this._setView(h.s - 150, h.e + 150); // 그 구간을 지도에 보여주기만 하고 영상은 움직이지 않는다.
        });
        $('#selbar').addEventListener('click', (e) => this._onSelbarClick(e));
        $('#msg').addEventListener('click', (e) => {
            const b = e.target.closest('[data-msg]');
            if (!b) return;
            if (b.dataset.msg === 'next') this._continueSearch();
            else this._rescan();
        });
        $('#scanrow').addEventListener('click', (e) => {
            if (e.target.closest('[data-act="next"]')) this._continueSearch();
        });
        const list = $('#list');
        list.addEventListener('click', (e) => {
            // 체크박스는 지도 선택과 별개다. 타임라인 복사 대상만 바꾼다.
            const cb = e.target.closest('input[data-pick]');
            if (cb) { this._onPick(cb.dataset.pick, cb.checked, e.shiftKey); return; }
            if (e.target.closest('.chk')) return;
            const r = e.target.closest('.row[data-id]');
            if (r) this._select(r.dataset.id);
        });
        $('#pickAll').addEventListener('change', (e) => this._pickAll(e.target.checked));
        $('#pickClear').addEventListener('click', () => this._pickAll(false));
        $('#pickCopy').addEventListener('change', (e) => {
            const mode = e.target.value;
            e.target.value = 'prompt'; // 같은 방식을 연속으로 고를 수 있게 되돌린다.
            if (mode !== 'prompt') this._copyTimeline(mode);
        });
        list.addEventListener('pointerover', (e) => this._setHover(e.target.closest('.row[data-id]')?.dataset.id ?? null));
        list.addEventListener('pointerleave', () => this._setHover(null));
        list.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);
        this._wireMapEvents();
        this._wireResizeGrip();
    }

    /** 패널 윗끝의 손잡이를 위아래로 끌어 패널 높이를 바꾼다. (창 크기를 바꾸듯이: 위로 끌면 커지고 아래로 끌면 작아진다.) */
    _wireResizeGrip() {
        const grip = this._$('#grip');
        const panel = this._$('.panel');
        grip.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            const y0 = e.clientY;
            const h0 = panel.getBoundingClientRect().height;
            const move = (ev) => {
                const h = SoopClipMap.clamp(h0 + (y0 - ev.clientY), SoopClipMap.PANEL_MIN_H, this._activeWin().innerHeight - 16);
                panel.style.setProperty('--panel-h', `${Math.round(h)}px`);
                panel.classList.add('sized');
            };
            const end = () => {
                grip.classList.remove('drag');
                grip.removeEventListener('pointermove', move);
                grip.removeEventListener('pointerup', end);
                grip.removeEventListener('pointercancel', end);
            };
            grip.classList.add('drag');
            grip.setPointerCapture(e.pointerId);
            grip.addEventListener('pointermove', move);
            grip.addEventListener('pointerup', end);
            grip.addEventListener('pointercancel', end);
        });
    }

    _onSelbarClick(e) {
        const b = e.target.closest('[data-act]');
        const d = this._d;
        const it = d?.byId.get(d.sel);
        if (!b || !it) return;
        switch (b.dataset.act) {
            case 'go':
                this._ensureVisible(it);
                this._seek(it.s);
                this._renderMap();
                break;
            case 'open':
                window.open(`${window.VODSync?.SoopUrls?.VOD_ORIGIN || 'https://vod.sooplive.com'}/player/${it.id}`, '_blank', 'noopener');
                break;
            default:
                d.sel = null;
                this._renderMap();
                this._renderSel();
                this._renderList();
        }
    }

    _wireMapEvents() {
        const wrap = this._$('#mapWrap');
        const lanes = this._$('#lanesBox');
        const top = this._$('#topBox');
        const xIn = (e) => e.clientX - lanes.getBoundingClientRect().left;
        const inSeekStrip = (e) => {
            const y = e.clientY - top.getBoundingClientRect().top;
            const x = xIn(e);
            return y >= SoopClipMap.SEEK_STRIP_Y && y <= SoopClipMap.SEEK_STRIP_Y + SoopClipMap.SEEK_STRIP_H && x >= 0 && x <= this._geom.W;
        };
        wrap.addEventListener('pointerdown', (e) => {
            const d = this._d;
            if (!d?.vod) return;
            const inOverview = !!e.target.closest('#topBox') && e.clientY - top.getBoundingClientRect().top < 24;
            this._drag = { x0: e.clientX, view: { ...this._ui.view }, moved: false, overview: inOverview, seek: inSeekStrip(e), target: e.target };
            wrap.setPointerCapture(e.pointerId);
            if (inOverview) this._centerAt(xIn(e));
        });
        wrap.addEventListener('pointermove', (e) => {
            const d = this._d;
            if (!d?.vod) return;
            const W = this._geom.W;
            const dr = this._drag;
            wrap.style.cursor = !dr && inSeekStrip(e) ? 'default' : ''; // 이동(seek)되는 밀도 줄 위에서는 일반 화살표
            if (dr) {
                if (dr.overview) { this._centerAt(xIn(e)); return; }
                const dx = e.clientX - dr.x0;
                if (Math.abs(dx) > 4) dr.moved = true;
                if (dr.moved) {
                    const span = dr.view.e - dr.view.s;
                    const s = SoopClipMap.clamp(dr.view.s - (dx / W) * span, 0, d.durationSec - span);
                    this._ui.view = { s, e: s + span };
                    this._renderMap();
                    this._hideTip();
                }
                return;
            }
            const id = e.target.dataset?.id;
            if (id && d.byId.has(id)) {
                this._setHover(id);
                this._showTip(this._clipTip(d.byId.get(id)), e.clientX, e.clientY);
                return;
            }
            this._setHover(null);
            const gi = e.target.dataset?.gap;
            if (gi != null && d.vod.gaps?.[gi]) {
                const g = d.vod.gaps[gi];
                this._showTip(`<b>다시보기에서 빠진 구간</b><span>라이브 ${SoopClipMap.formatDuration(g.skipSec)}이 이 다시보기에 없어요</span>`
                    + `<span class="dim mono">${SoopClipMap.formatClock(g.fromSec)} → ${SoopClipMap.formatClock(g.toSec)}</span><span class="dim">편집으로 잘렸거나 방송이 끊긴 구간이에요</span>`, e.clientX, e.clientY);
                return;
            }
            const x = xIn(e);
            const { s, e: ve } = this._ui.view;
            const t = s + (x / W) * (ve - s);
            if (inSeekStrip(e)) {
                // 누르면 이동할 시점. 시간축(재생 시간/라이브 시각)에 맞춰 시각만 보여준다.
                this._showTip(`<span class="mono">${this._ui.axis === 'wall' ? this._wallLabel(t) : SoopClipMap.formatHms(t)}</span>`, e.clientX, e.clientY, true);
            } else if (e.target.closest('#topBox') && x >= 0 && x <= W) {
                const wallStr = this._wallLabel(t);
                this._showTip(`<b class="mono">${this._ui.axis === 'wall' ? wallStr : SoopClipMap.formatHms(t)}</b><span class="dim">${this._ui.axis === 'wall' ? '재생 ' + SoopClipMap.formatHms(t) : '라이브 ' + wallStr}</span>`, e.clientX, e.clientY);
            } else {
                this._hideTip();
            }
        });
        wrap.addEventListener('pointerup', (e) => {
            const dr = this._drag;
            this._drag = null;
            const d = this._d;
            if (!dr || !d || dr.overview || dr.moved) return;
            const id = dr.target.dataset?.id;
            if (id && d.byId.has(id)) { this._select(id); return; }
            if (!dr.seek) return; // 밀도 줄이 아닌 빈 곳은 이동하지 않는다.
            const { s, e: ve } = this._ui.view;
            this._seek(s + (xIn(e) / this._geom.W) * (ve - s));
        });
        wrap.addEventListener('pointerleave', () => { wrap.style.cursor = ''; this._setHover(null); this._hideTip(); });
        wrap.addEventListener('wheel', (e) => {
            const d = this._d;
            if (!d?.vod) return;
            e.preventDefault();
            if (e.altKey) {
                // Alt+휠: 겹쳐 쌓인 줄을 위아래로 스크롤한다. (그냥 휠은 구간 확대·축소)
                const raw = e.deltaY || e.deltaX; // 환경에 따라 세로 휠이 deltaX로 오기도 한다.
                lanes.scrollTop += e.deltaMode === 1 ? raw * SoopClipMap.LANE_PITCH : e.deltaMode === 2 ? raw * lanes.clientHeight : raw;
                this._hideTip();
                return;
            }
            const { s, e: ve } = this._ui.view;
            const x = SoopClipMap.clamp(xIn(e), 0, this._geom.W);
            this._zoomBy(e.deltaY < 0 ? 0.8 : 1.25, s + (x / this._geom.W) * (ve - s));
        }, { passive: false });
    }

    _centerAt(x) {
        const D = this._d.durationSec;
        const { s, e } = this._ui.view;
        const span = e - s;
        const t = (x / this._geom.W) * D;
        this._setView(t - span / 2, t - span / 2 + span);
    }

    _setHover(id) {
        const ui = this._ui;
        if (ui.hover === id) return;
        ui.hover = id;
        this._root.querySelectorAll('.bar-c,.bar-k').forEach((r) => r.classList.toggle('hov', r.dataset.id === id));
        this._root.querySelectorAll('.row[data-id]').forEach((r) => r.classList.toggle('hov', r.dataset.id === id));
    }

    /** 커서 근처에 툴팁을 띄운다. small이면 커서 위쪽에 작은 한 줄 상자로 보인다. */
    _showTip(html, x, y, small = false) {
        const tip = this._$('#tip');
        tip.innerHTML = html;
        tip.classList.toggle('sm', small);
        tip.hidden = false;
        const w = tip.offsetWidth;
        const h = tip.offsetHeight;
        const aw = this._activeWin();
        tip.style.left = `${SoopClipMap.clamp(x + (small ? 12 : 14), 8, aw.innerWidth - w - 8)}px`;
        if (small) tip.style.top = `${y - h - 8 < 4 ? y + 16 : y - h - 8}px`;
        else tip.style.top = `${y + 18 + h > aw.innerHeight ? y - h - 12 : y + 18}px`;
    }

    _hideTip() {
        this._$('#tip').hidden = true;
    }

    _toast(msg) {
        if (!this._root) return;
        const el = this._$('#toast');
        el.textContent = msg;
        el.hidden = false;
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
    }

    /** 재생 위치(초) → 라이브 당시 시각 "HH:MM[:SS]". 컷 편집으로 건너뛴 구간을 반영한다. */
    _wallLabel(t, withSec = true) {
        return SoopClipMap.formatClock(SoopClipMap.wallSecAt(this._d.vod.wallMap, t), withSec);
    }

    _regText(it) {
        const d = this._d;
        if (!it.regDate || !d?.vod) return '';
        return SoopClipMap.formatRegistration(it.regDate, d.vod, it.e);
    }

    /** 클립·캐치 막대에 커서를 올렸을 때의 툴팁. 구간은 선택한 시간축(재생 시간/라이브 시각)으로 보여주고 다른 축은 흐리게 덧붙인다. */
    _clipTip(it) {
        const play = `${SoopClipMap.formatHms(it.s)} → ${SoopClipMap.formatHms(it.e)}`;
        const range = this._ui.axis === 'wall'
            ? `<span class="mono">${this._wallLabel(it.s)} → ${this._wallLabel(it.e)} (${SoopClipMap.formatDur(it.len)})</span><span class="dim mono">재생 ${play}</span>`
            : `<span class="mono">${play} (${SoopClipMap.formatDur(it.len)})</span>`;
        return `<b>${SoopClipMap.esc(it.title)}</b><span class="dim">${SoopClipMap.esc(it.nick)} · ${it.kind === 'CLIP' ? '클립' : '캐치'}</span>`
            + range
            + `<span>조회 ${SoopClipMap.num(it.views)} · 추천 ${SoopClipMap.num(it.likes)}</span>`
            + `<span class="dim">${SoopClipMap.esc(this._regText(it))}${it.parent ? ' · 부모 클립에서 파생, 구간 합산' : ''}</span>`;
    }

    _renderAll() {
        if (!this._open || !this._d) return;
        this._renderMsg();
        this._renderHeader();
        if (this._d.phase !== 'ready' && !(this._d.scanning && this._d.vod)) return;
        this._renderHead();
        this._renderMap();
        this._renderSel();
        this._renderList();
    }

    _msgState() {
        const d = this._d;
        if (d.phase === 'error') return 'error';
        if (d.phase === 'ready' && d.items.length === 0 && !d.scanning) return 'empty';
        if (d.phase === 'loading' && !d.vod) return 'loading';
        return null;
    }

    _renderMsg() {
        const d = this._d;
        const state = this._msgState();
        const msg = this._$('#msg');
        this._$('#body').hidden = !!state;
        msg.hidden = !state;
        if (!state) { msg.innerHTML = ''; return; }
        // 상태마다 쓰는 데이터가 달라서(예: 로딩 중에는 d.vod가 없다) 필요한 상태의 문구만 만든다.
        switch (state) {
            case 'loading':
                msg.innerHTML = `<div class="msg"><h4>${SoopClipMap.esc(d.scan?.label || '불러오는 중')}</h4><p>이 다시보기에서 만들어진 클립을 찾고 있어요.</p></div>`;
                break;
            case 'error':
                msg.innerHTML = `<div class="msg err" role="alert"><h4>클립을 불러오지 못했어요</h4><p>${SoopClipMap.esc(d.error || '잠시 후 다시 시도해 주세요.')} 계속되면 [VOD Master 설정] &gt; [문의하기]로 알려 주세요.</p><div class="btns"><button class="btn primary" data-msg="retry">다시 시도</button></div></div>`;
                break;
            default: { // empty
                const md = (ymd) => ymd.slice(5).replace('-', '/');
                const lastWin = d.windows.length ? d.windows[d.windows.length - 1] : null;
                const next = d.searchDone ? null : SoopClipMap.nextSearchWindow(d.plan, SoopClipMap.todayYmd());
                const range = `${md(d.vod.startYmd)} ~ ${md(lastWin ? lastWin.end : d.vod.startYmd)}`;
                const btns = (next ? `<button class="btn primary" data-msg="next">다음 구간 검색 (${md(next.start)} ~ ${md(next.end)}, ${next.label} 단위)</button>` : '')
                    + `<button class="btn${next ? '' : ' primary'}" data-msg="retry">처음부터 다시 검색</button>`;
                msg.innerHTML = `<div class="msg"><h4>이 다시보기에서 만든 클립·캐치를 아직 찾지 못했어요</h4>`
                    + `<p>${range} 사이 클립 ${SoopClipMap.num(d.scanned.CLIP)}건·캐치 ${SoopClipMap.num(d.scanned.CATCH)}건을 확인했지만 이 다시보기와 연결된 것이 없어요. `
                    + `${next ? '더 뒤의 기간도 검색해 볼까요?' : '오늘까지 모두 검색했어요.'}</p><div class="btns">${btns}</div></div>`;
            }
        }
    }

    _renderHeader() {
        const d = this._d;
        this._$('#vodMeta').textContent = d.vod
            ? `${SoopClipMap.formatHms(d.durationSec)} · 라이브 시작 ${d.vod.startYmd} ${this._wallLabel(0, false)}`
                + (d.vod.gaps.length ? ` · 빠진 구간 ${d.vod.gaps.length}곳` : '')
            : '';
        this._updateReadout();
        this._$('#btnRescan').disabled = d.scanning || d.phase === 'idle';
        const open = this._ui.listOpen;
        this._$('#body').classList.toggle('nolist', !open);
        const btn = this._$('#btnList');
        btn.textContent = open ? '목록 접기 ▸' : `목록 펴기 ◂ (${this._visible().length})`;
        btn.setAttribute('aria-expanded', String(open));
    }

    /** 오른쪽 클립·캐치 목록을 접거나 편다. 접으면 지도가 그 폭까지 넓어진다. */
    _toggleList() {
        this._ui.listOpen = !this._ui.listOpen;
        this._renderAll();
    }

    _updateReadout() {
        const d = this._d;
        if (!d?.vod) { this._$('#readout').textContent = ''; return; }
        const ph = this._ui.ph;
        this._$('#readout').innerHTML = `<span class="dot"></span>재생 위치 <span class="mono">${SoopClipMap.formatHms(ph)}</span> · 라이브 <span class="mono">${this._wallLabel(ph)}</span>`;
    }

    _renderHead() {
        const d = this._d;
        const vis = this._visible();
        const nClip = d.items.filter((i) => i.kind === 'CLIP').length;
        const nCatch = d.items.filter((i) => i.kind === 'CATCH').length;
        this._$('#cAll').textContent = d.items.length;
        this._$('#cClip').textContent = nClip;
        this._$('#cCatch').textContent = nCatch;
        const k = this._ui.kinds;
        const mode = k.CLIP && k.CATCH ? 'all' : k.CLIP ? 'CLIP' : 'CATCH';
        this._root.querySelectorAll('.kinds .chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === mode)));
        const hs = SoopClipMap.findHotspots(vis, d.durationSec);
        this._hotspots = hs;
        this._$('#hot').innerHTML = hs.length
            ? '<span class="hl">몰린 곳</span>' + hs.map((h, i) =>
                `<button class="hchip" data-hs="${i}" title="겹친 ${h.peak}개 · 누르면 지도에서 그 구간을 보여줘요"><span class="mono">${SoopClipMap.formatHms(h.at)}</span><span class="x">×${h.peak}</span></button>`).join('')
            : '';
        // 검색 줄은 진행 중이거나 사용자가 눌러야 할 때(멈춤·오류)만 보이고, 끝나면 몰린 곳 줄 오른쪽에 검색 기간만 남긴다.
        const sr = this._$('#scanrow');
        const md = (ymd) => ymd.slice(5).replace('-', '/');
        const counts = `클립 ${nClip}개·캐치 ${nCatch}개`;
        const lastWin = d.windows.length ? d.windows[d.windows.length - 1] : null;
        const next = d.searchDone ? null : SoopClipMap.nextSearchWindow(d.plan, SoopClipMap.todayYmd());
        const info = this._$('#info');
        sr.hidden = false;
        info.textContent = '';
        if (d.scanning && d.scan) {
            sr.innerHTML = `<span class="txt"><b>${SoopClipMap.esc(d.scan.label)}</b> · 지금까지 ${counts}</span>`
                + `<span class="bar"><i style="width:${d.scan.pct}%"></i></span>`;
        } else if (d.searchError && next) {
            sr.innerHTML = `<span class="txt"><b style="color:var(--err)">검색이 중단됐어요 (${SoopClipMap.esc(d.searchError)})</b> · ${md(d.vod.startYmd)} ~ ${md(lastWin ? lastWin.end : d.vod.startYmd)}까지 검색했어요</span>`
                + '<button class="btn primary" data-act="next">이어서 검색</button>';
        } else if (d.paused && next && lastWin) {
            sr.innerHTML = `<span class="txt"><b>${md(lastWin.start)} ~ ${md(lastWin.end)}에는 연결된 항목이 없어요.</b> `
                + `다음 ${md(next.start)} ~ ${md(next.end)} (${next.label} 단위)을 검색할까요?</span>`
                + `<button class="btn primary" data-act="next">다음 구간 검색 (${next.label})</button>`;
        } else {
            sr.hidden = true;
            const last = lastWin ? lastWin.end : d.vod.startYmd;
            info.textContent = `${md(d.vod.startYmd)} ~ ${md(last)} ${d.searchDone ? '검색 완료' : '까지 검색'}`;
            info.title = `클립 ${SoopClipMap.num(d.scanned.CLIP)}건·캐치 ${SoopClipMap.num(d.scanned.CATCH)}건을 검색해 이 다시보기와 연결된 ${counts}를 찾았어요`;
        }
    }

    _renderMap() {
        const d = this._d;
        const lanesBox = this._$('#lanesBox');
        const W = lanesBox.clientWidth;
        if (!W || !d?.vod) return;
        this._geom.W = W;
        const D = d.durationSec;
        const ui = this._ui;
        const { s: vs, e: ve } = ui.view;
        const span = ve - vs;
        const X = (t) => ((t - vs) / span) * W;
        const vis = this._visible();
        const runs = (counts, y, h, sx = W / counts.length) => SoopClipMap.densityRuns(counts).map((r) =>
            `<rect x="${(r.from * sx).toFixed(1)}" y="${y}" width="${((r.to - r.from) * sx + 0.6).toFixed(1)}" height="${h}" fill="var(--h${r.cls})"/>`).join('');

        let top = `<svg width="${W}" height="${SoopClipMap.TOP_H}" viewBox="0 0 ${W} ${SoopClipMap.TOP_H}" role="img" aria-label="다시보기 전체 길이 개요, 시간 눈금, 클립 겹침 밀도">`;
        top += `<rect x="0" y="4" width="${W}" height="16" fill="var(--sunken)"/>`;
        top += runs(SoopClipMap.computeDensity(vis, 0, D, Math.round(W / 2)), 4, 16);
        top += `<rect x="${((vs / D) * W).toFixed(1)}" y="3" width="${Math.max(6, (span / D) * W).toFixed(1)}" height="18" rx="3" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
        top += `<line x1="0" x2="${W}" y1="51" y2="51" stroke="var(--line2)"/>`;
        const step = SoopClipMap.niceTickStep(W / span);
        const ticks = ui.axis === 'wall'
            ? SoopClipMap.wallTicks(d.vod.wallMap, vs, ve, step).map((k) => ({ t: k.t, lab: SoopClipMap.formatClock(k.wall, step < 60) }))
            : (() => { const arr = []; for (let t = Math.ceil(vs / step) * step; t <= ve; t += step) arr.push({ t, lab: SoopClipMap.formatHms(t) }); return arr; })();
        let grid = '';
        for (const k of ticks) {
            const x = X(k.t);
            top += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="42" y2="51" stroke="var(--line2)"/>`;
            if (x + 4 + k.lab.length * 6.6 < W) top += `<text class="tk" x="${(x + 4).toFixed(1)}" y="47">${k.lab}</text>`;
            grid += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="0" y2="__H__" stroke="var(--line)" stroke-dasharray="2 3"/>`;
        }
        top += runs(SoopClipMap.computeDensity(vis, vs, ve, Math.round(W / 2)), SoopClipMap.SEEK_STRIP_Y, SoopClipMap.SEEK_STRIP_H);
        // 빠진 구간: 파일이 이어지는 자리에 이중 점선을 그린다.
        (d.vod.gaps || []).forEach((g, i) => {
            const gx = X(g.pos);
            if (gx < -6 || gx > W + 6) return;
            top += `<rect data-gap="${i}" x="${(gx - 6).toFixed(1)}" y="26" width="12" height="${SoopClipMap.TOP_H - 26}" fill="transparent"/>`
                + `<line x1="${(gx - 1.5).toFixed(1)}" x2="${(gx - 1.5).toFixed(1)}" y1="28" y2="${SoopClipMap.TOP_H}" stroke="var(--muted)" stroke-dasharray="3 2" pointer-events="none"/>`
                + `<line x1="${(gx + 1.5).toFixed(1)}" x2="${(gx + 1.5).toFixed(1)}" y1="28" y2="${SoopClipMap.TOP_H}" stroke="var(--muted)" stroke-dasharray="3 2" pointer-events="none"/>`;
            grid += `<line x1="${gx.toFixed(1)}" x2="${gx.toFixed(1)}" y1="0" y2="__H__" stroke="var(--muted)" stroke-dasharray="3 2" pointer-events="none"/>`;
        });
        const sel = d.byId.get(d.sel);
        const selShown = sel && ui.kinds[sel.kind];
        if (selShown) top += `<rect x="${X(sel.s).toFixed(1)}" y="26" width="${Math.max(2, X(sel.e) - X(sel.s)).toFixed(1)}" height="${SoopClipMap.TOP_H - 26}" fill="var(--accent-soft)"/>`;
        top += `<line class="phl" y1="28" y2="${SoopClipMap.TOP_H}" stroke="var(--accent)" stroke-width="2"/><path class="pht" fill="var(--accent)"/></svg>`;
        this._$('#topBox').innerHTML = top;

        // 클립과 캐치를 한 지도에 함께 배치한다. (막대 모양으로 구분: 채워진 사각형은 클립, 빈 사각형은 캐치)
        const laneCount = SoopClipMap.packLanes(vis);
        const y0 = 6;
        let bars = '';
        for (const it of vis) {
            const x1 = X(it.s);
            const x2 = X(it.e);
            if (x2 < 0 || x1 > W) continue;
            const isClip = it.kind === 'CLIP';
            const bx = SoopClipMap.clamp(x1, 0, W);
            const bw = Math.max(3, SoopClipMap.clamp(x2, 0, W) - bx);
            const by = y0 + it.lane * SoopClipMap.LANE_PITCH;
            bars += `<rect class="${isClip ? 'bar-c' : 'bar-k'}${ui.hover === it.id ? ' hov' : ''}" data-id="${it.id}" x="${bx.toFixed(1)}" y="${by}" width="${bw.toFixed(1)}" height="${SoopClipMap.LANE_H}" rx="3"/>`;
            if (bw > 64) {
                const fitted = this._fit(SoopClipMap.stripKindPrefix(it.title), bw);
                if (fitted) bars += `<text class="bt ${isClip ? 'c' : 'k'}" x="${(bx + 5).toFixed(1)}" y="${by + 12}">${SoopClipMap.esc(fitted)}</text>`;
            }
            if (d.sel === it.id) bars += `<rect class="sel-ring" x="${(bx - 1.5).toFixed(1)}" y="${by - 1.5}" width="${(bw + 3).toFixed(1)}" height="${SoopClipMap.LANE_H + 3}" rx="4.5"/>`;
        }
        const y = y0 + laneCount * SoopClipMap.LANE_PITCH + 8;
        const H = Math.max(y, 60);
        const band = selShown ? `<rect x="${X(sel.s).toFixed(1)}" y="0" width="${Math.max(2, X(sel.e) - X(sel.s)).toFixed(1)}" height="${H}" fill="var(--accent-soft)"/>` : '';
        lanesBox.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="클립과 캐치의 구간을 줄별로 나타낸 그래프">`
            + grid.replace(/__H__/g, H) + band + bars
            + `<line class="phl" y1="0" y2="${H}" stroke="var(--accent)" stroke-width="2"/></svg>`;
        // 줄이 넘쳐서 스크롤바가 생긴 경우에만 Alt+휠 사용법을 알려 준다.
        this._$('#laneHint').hidden = !(lanesBox.scrollHeight > lanesBox.clientHeight + 1);
        this._updatePlayhead();
    }

    /** 재생 위치 선만 갱신한다. (주기마다 지도를 통째로 다시 그리지 않으려고 분리) */
    _updatePlayhead() {
        if (!this._root || !this._d?.vod) return;
        this._updateReadout();
        const { s, e } = this._ui.view;
        const W = this._geom.W;
        const x = ((this._ui.ph - s) / (e - s)) * W;
        const visible = x >= 0 && x <= W;
        this._root.querySelectorAll('.phl').forEach((l) => {
            l.setAttribute('x1', x.toFixed(1));
            l.setAttribute('x2', x.toFixed(1));
            l.style.display = visible ? '' : 'none';
        });
        const tri = this._root.querySelector('.pht');
        if (tri) {
            tri.setAttribute('d', `M${(x - 5).toFixed(1)} 24 L${(x + 5).toFixed(1)} 24 L${x.toFixed(1)} 32 Z`);
            tri.style.display = visible ? '' : 'none';
        }
    }

    _fit(str, px) {
        let w = 0;
        let out = '';
        for (const ch of str) {
            const cw = /[ㄱ-힝]/.test(ch) ? 11.2 : 6.2;
            if (w + cw > px - 8) return out.length ? out.slice(0, -1) + '…' : '';
            w += cw;
            out += ch;
        }
        return out;
    }

    _renderSel() {
        const d = this._d;
        const it = d.byId.get(d.sel);
        const el = this._$('#selbar');
        if (!it || !this._ui.kinds[it.kind]) {
            el.className = 'selbar empty';
            el.textContent = '막대나 목록에서 클립을 선택하면 구간과 이동 버튼이 여기에 나와요.';
            return;
        }
        el.className = 'selbar';
        el.innerHTML = `<div class="st"><b>${SoopClipMap.esc(it.title)}</b><span class="mono">${SoopClipMap.formatHms(it.s)} → ${SoopClipMap.formatHms(it.e)}</span>`
            + `<span> · ${SoopClipMap.formatDur(it.len)} · 라이브 ${this._wallLabel(it.s, false)}~${this._wallLabel(it.e, false)} · ${SoopClipMap.esc(it.nick)}</span></div>`
            + `<div class="acts"><button class="btn primary" data-act="go">▶ 이 구간으로 이동</button><button class="btn" data-act="open">${it.kind === 'CLIP' ? '클립' : '캐치'} 열기 ↗</button>`
            + `<button class="btn" data-act="clear">선택 해제</button></div>`;
    }

    _renderList() {
        if (!this._ui.listOpen) return; // 접혀 있는 동안은 그리지 않는다. 펼칠 때 _toggleList → _renderAll이 그린다.
        const d = this._d;
        const cmp = {
            start: (a, b) => a.s - b.s,
            views: (a, b) => b.views - a.views,
            likes: (a, b) => b.likes - a.likes,
            len: (a, b) => b.len - a.len,
        }[this._ui.sort];
        const vis = this._visible().sort(cmp);
        this._$('#listTitle').textContent = `${this._kindLabel()} 목록 (${vis.length})`;
        let rows = vis.map((it) => {
            const g1 = `hsl(${it.hue} 28% 44%)`;
            const g2 = `hsl(${(it.hue + 40) % 360} 32% 24%)`;
            const picked = this._ui.picked.has(it.id);
            const cls = `row${d.sel === it.id ? ' sel' : ''}${picked ? ' chosen' : ''}${this._ui.hover === it.id ? ' hov' : ''}`;
            return `<div class="${cls}" data-id="${it.id}">`
                + `<label class="chk"><input type="checkbox" data-pick="${it.id}"${picked ? ' checked' : ''} aria-label="${SoopClipMap.esc(SoopClipMap.stripKindPrefix(it.title))} 타임라인 복사 대상으로 선택"></label>`
                + `<button class="rbtn" type="button">`
                + `<span class="thumb" style="--g1:${g1};--g2:${g2}">${it.thumb ? `<img src="${SoopClipMap.esc(it.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<i>${SoopClipMap.formatDur(it.len)}</i></span>`
                + `<span class="rmain"><b>${SoopClipMap.esc(it.title)}</b><span class="meta"><span class="badge${it.kind === 'CATCH' ? ' k' : ''}">${it.kind === 'CLIP' ? '클립' : '캐치'}</span>${SoopClipMap.esc(it.nick)}<span>조회 ${SoopClipMap.num(it.views)}</span><span>추천 ${SoopClipMap.num(it.likes)}</span></span></span>`
                + `<span class="rr mono">${SoopClipMap.formatHms(it.s)} → ${SoopClipMap.formatHms(it.e)}<small>${SoopClipMap.esc(this._regText(it))}</small></span></button></div>`;
        }).join('');
        if (d.scanning) {
            rows += '<div class="row skel"><span class="chk"></span><div class="rbtn"><span class="thumb"></span><span class="rmain"><span class="sk"></span><span class="sk s"></span></span><span class="rr">구간 확인 중…</span></div></div>';
        }
        if (!rows) rows = '<div class="row skel"><div class="rbtn" style="grid-template-columns:1fr;padding-left:12px"><span class="rr" style="grid-column:1;text-align:center">표시할 항목이 없어요</span></div></div>';
        this._$('#list').innerHTML = rows;
        this._renderPick();
    }

    /** 고른 항목 중 지금 표시되는 종류(클립·캐치 칩)에 해당하는 것. */
    _pickedItems() {
        return this._visible().filter((i) => this._ui.picked.has(i.id));
    }

    /** 체크박스 하나를 바꾼다. Shift를 누르고 누르면 마지막으로 누른 것과 이번 것 사이를 모두 같은 상태로 바꾼다. */
    _onPick(id, checked, shift) {
        const ui = this._ui;
        const ids = [...this._$('#list').querySelectorAll('input[data-pick]')].map((i) => i.dataset.pick);
        const targets = shift && ui.lastPick && ids.includes(ui.lastPick)
            ? ids.slice(Math.min(ids.indexOf(ui.lastPick), ids.indexOf(id)), Math.max(ids.indexOf(ui.lastPick), ids.indexOf(id)) + 1)
            : [id];
        for (const t of targets) {
            if (checked) ui.picked.add(t);
            else ui.picked.delete(t);
        }
        ui.lastPick = id;
        this._syncPickDom();
    }

    /** 표시 중인 목록 전체를 선택하거나 해제한다. */
    _pickAll(checked) {
        const ui = this._ui;
        for (const it of this._visible()) {
            if (checked) ui.picked.add(it.id);
            else ui.picked.delete(it.id);
        }
        ui.lastPick = null;
        this._syncPickDom();
    }

    /** 목록을 다시 그리지 않고 체크 상태와 행 색만 맞춘다. (스크롤·포커스를 유지) */
    _syncPickDom() {
        this._$('#list').querySelectorAll('.row[data-id]').forEach((row) => {
            const on = this._ui.picked.has(row.dataset.id);
            row.classList.toggle('chosen', on);
            const cb = row.querySelector('input[data-pick]');
            if (cb) cb.checked = on;
        });
        this._renderPick();
    }

    _renderPick() {
        const vis = this._visible();
        const n = vis.filter((i) => this._ui.picked.has(i.id)).length;
        const all = this._$('#pickAll');
        all.checked = vis.length > 0 && n === vis.length;
        all.indeterminate = n > 0 && n < vis.length;
        all.disabled = vis.length === 0;
        this._$('#pickCount').textContent = `선택 ${n}개`;
        this._$('#pickClear').disabled = n === 0;
        this._$('#pickCopy').disabled = n === 0;
    }

    async _copyTimeline(mode) {
        const items = this._pickedItems();
        if (items.length === 0) {
            this._toast('복사할 항목을 먼저 선택해 주세요.');
            return;
        }
        const text = SoopClipMap.buildTimelineText(items.map((i) => ({ s: i.s, e: i.e, name: SoopClipMap.stripKindPrefix(i.title) })), mode);
        const ok = await this._copyText(text);
        this._toast(ok ? `타임라인 ${items.length}줄을 복사했어요.` : '복사하지 못했어요. 브라우저의 클립보드 권한을 확인해 주세요.');
        this.log(`타임라인 복사 ${ok ? '완료' : '실패'}: ${items.length}줄 (${mode})`);
    }

    async _copyText(text) {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (e) {
            this.warn('클립보드 API 복사 실패, 대체 방식으로 시도:', e);
        }
        try {
            // 클립보드 API를 쓸 수 없는 환경(비보안 컨텍스트 등)용. Shadow DOM 밖에 잠깐 만들어 복사한다.
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', 'true');
            ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            return ok;
        } catch (e) {
            this.error('타임라인 복사 실패:', e);
            return false;
        }
    }

    // ---------- 상수 ----------

    static BUTTON_CLASS = 'vs_clip_map'; // 열기 버튼 li·button 클래스

    static ANCHOR_LI_ID = 'vodUserClip'; // 이 항목(유저 클립) 바로 옆에 열기 버튼을 붙인다

    static PAGE_CONCURRENCY = 4;

    static VIEW_CONCURRENCY = 4;

    static MIN_SPAN_SEC = 60;

    static POLL_MS = 300;

    static BUTTON_CHECK_MS = 500; // 열기 버튼 위치 확인 주기

    static TOP_H = 78;

    static LANE_H = 16;

    static LANE_PITCH = 19;

    static SEEK_STRIP_Y = 56; // 확대·축소가 적용된 얇은 밀도 줄의 위치·높이. 이 줄을 눌러야 그 지점으로 이동(seek)한다.
    static SEEK_STRIP_H = 18;
    static PANEL_MIN_H = 133; // 손잡이로 줄일 수 있는 패널 최소 높이(px). 이보다 작으면 내부 스크롤로 감당한다. 최대는 창 높이 - 16px (CSS와 같은 값)

    static LEGEND_LABELS = ['1', '2', '3', '4–5', '6–8', '9+'];

    /** 검색 API 페이지 크기. 캐치 검색은 페이지당 30행만 주므로 30을 넘기면 페이지 사이 행이 누락된다. */
    static SEARCH_PAGE_SIZE = 30;

    /** 검색 기간 단위. 1주로 시작해 연결된 항목이 0건인 기간이 나오면 한 단계씩 키운다. (1개월=30일, 6개월=180일, 1년=365일) */
    static SEARCH_STEPS = [
        { days: 7, label: '1주' },
        { days: 30, label: '1개월' },
        { days: 180, label: '6개월' },
        { days: 365, label: '1년' },
    ];

    /** "빠진 구간"으로 표시하는 최소 길이(초). 파일 조각 경계의 자연스러운 틈(0~47초)은 제외한다. */
    static WALL_GAP_MIN_SEC = 120;

    /** 패널 스타일(Shadow DOM 안에서만 적용). 밝은 테마가 기본이고 .dark 클래스로 어두운 테마. */
    static CLIP_MAP_CSS = `
:host([hidden]){display:none!important}
:host{all:initial;position:fixed;left:0;right:0;bottom:0;z-index:2147483000;pointer-events:none;
  font-family:"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif;font-size:13px;line-height:1.5}
*{box-sizing:border-box}
[hidden]{display:none!important}
.sheet{
  --surface:#fbfcfd;--sunken:#f0f3f7;--ink:#0d1520;--ink2:#465162;--muted:#66707f;--line:#dde3ea;--line2:#c4cdd9;
  --accent:#d9541e;--accent-soft:rgba(217,84,30,.13);--bar:#2a78d6;--bar-hover:#1c5cab;
  --h1:#b7d3f6;--h2:#86b6ef;--h3:#5598e7;--h4:#2a78d6;--h5:#1c5cab;--h6:#0d366b;
  --err:#b42d2d;--err-bg:#fbeeee;--chosen:rgba(42,120,214,.10);
  --mono:ui-monospace,"Cascadia Mono",Consolas,monospace;
  pointer-events:auto;position:relative;margin:0 auto;max-width:1492px;width:100%;
}
.sheet.dark{
  --surface:#141a22;--sunken:#0f141b;--ink:#eef2f8;--ink2:#b3bccb;--muted:#8c97a7;--line:#242c37;--line2:#344050;
  --accent:#ff8a57;--accent-soft:rgba(255,138,87,.16);--bar:#3987e5;--bar-hover:#6da7ec;
  --h1:#104281;--h2:#184f95;--h3:#256abf;--h4:#3987e5;--h5:#6da7ec;--h6:#b7d3f6;
  --err:#ef7f7f;--err-bg:#2a1719;--chosen:rgba(57,135,229,.18);
}
button{font:inherit;color:inherit}
.panel{background:var(--surface);color:var(--ink);border:1px solid var(--line);border-bottom:0;border-radius:10px 10px 0 0;
  padding:12px 16px 14px;display:flex;flex-direction:column;gap:10px;max-height:min(calc(78vh + 100px),90vh,860px);overflow-y:auto;
  box-shadow:0 -10px 32px rgba(0,0,0,.18)}
.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.btn{border:1px solid var(--line2);background:var(--surface);border-radius:6px;padding:4px 10px;cursor:pointer;line-height:1.4}
.btn:hover{background:var(--sunken)}
.btn.primary{background:var(--ink);color:var(--surface);border-color:var(--ink)}
.btn[disabled]{opacity:.5;cursor:default}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.seg{display:inline-flex;border:1px solid var(--line2);border-radius:6px;overflow:hidden;background:var(--surface)}
.seg button{border:0;background:transparent;padding:4px 10px;cursor:pointer;color:var(--ink2);border-inline-start:1px solid var(--line2)}
.seg button:first-child{border-inline-start:0}
.seg button[aria-pressed="true"]{background:var(--ink);color:var(--surface)}
.chip{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line2);background:var(--surface);border-radius:99px;padding:3px 12px 3px 10px;cursor:pointer}
.chip[aria-pressed="true"]{background:var(--ink);color:var(--surface);border-color:var(--ink)}
.chip[aria-pressed="false"]{color:var(--muted);background:transparent}
.kinds{display:flex;gap:8px;flex-wrap:wrap}
.chip b{font-family:var(--mono);font-weight:500}
.sw{display:inline-block;width:14px;height:10px;border-radius:3px}
.sw-clip{background:var(--bar)}
.sw-catch{border:1.5px solid var(--bar);background:var(--surface)}
.ph{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center}
.ph-l{display:flex;align-items:baseline;gap:2px 12px;flex-wrap:wrap}
.ph h3{margin:0;font-size:16px;font-weight:700}
.sub{font-size:12px;color:var(--muted)}
.ph-r{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.readout{font-size:12px;color:var(--ink2);padding-inline-end:6px}
.readout .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);margin-inline-end:6px}
.sumrow{display:flex;flex-wrap:wrap;gap:4px 16px;align-items:center}
.info{margin-inline-start:auto;font-size:12px;color:var(--muted)}
.hot{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.hot .hl{font-size:12px;color:var(--muted)}
.hchip{border:1px solid var(--line2);background:var(--surface);border-radius:6px;padding:1px 8px;cursor:pointer;display:inline-flex;gap:8px;align-items:center}
.hchip:hover{background:var(--sunken)}
.hchip .x{font-size:12px;color:var(--ink2)}
.hchip .x{margin-inline-start:-3px}
.scanrow{display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--ink2);background:var(--sunken);border-radius:6px;padding:6px 10px}
.scanrow .txt{flex:1 1 320px}
.scanrow .bar{flex:0 0 180px;height:6px;border-radius:3px;background:var(--line);overflow:hidden}
.scanrow .bar i{display:block;height:100%;background:var(--accent)}
.toolbar{display:flex;gap:8px 14px;flex-wrap:wrap;align-items:center}
.toolbar .sp{flex:1 1 0}
.zoom{display:inline-flex}
.zoom .btn{border-radius:0}
.zoom .btn:first-child{border-radius:6px 0 0 6px}
.zoom .btn:last-child{border-radius:0 6px 6px 0}
.zoom .btn+.btn{border-inline-start:0}
.hint{font-size:12px;color:var(--muted)}
.legend{display:inline-flex;gap:4px;align-items:center;font-size:12px;color:var(--muted)}
.legend .lg{display:inline-flex;align-items:center;gap:3px;margin-inline-start:4px}
.legend i{display:inline-block;width:12px;height:10px;border-radius:2px}
.mapwrap{border:1px solid var(--line);border-radius:8px;background:var(--surface);overflow:hidden;cursor:grab;touch-action:pan-y;user-select:none}
.mapwrap:active{cursor:grabbing}
.mapwrap svg{display:block}
.mapwrap svg text{font-family:inherit;font-size:11px;fill:var(--muted)}
.mapwrap svg .tk{font-family:var(--mono);fill:var(--ink2)}
.lanes{max-height:260px;overflow-y:auto;scrollbar-gutter:stable;border-top:1px solid var(--line)}
.bar-c{fill:var(--bar);cursor:pointer}
.bar-c:hover,.bar-c.hov{fill:var(--bar-hover)}
.bar-k{fill:var(--surface);stroke:var(--bar);stroke-width:1.5;cursor:pointer}
.bar-k:hover,.bar-k.hov{fill:var(--sunken);stroke:var(--bar-hover);stroke-width:2}
.sel-ring{fill:none;stroke:var(--accent);stroke-width:2.5;pointer-events:none}
.bt{pointer-events:none}
.bt.c{fill:#fff!important}
.bt.k{fill:var(--ink2)!important}
.selbar{display:flex;gap:8px 14px;flex-wrap:wrap;align-items:center;border:1px solid var(--line);border-inline-start:3px solid var(--accent);border-radius:6px;padding:8px 12px;background:var(--surface)}
.selbar .st{flex:1 1 260px;min-width:0}
.selbar .st b{font-weight:700;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.selbar .st span{font-size:12px;color:var(--ink2)}
.selbar .acts{display:flex;gap:8px;flex-wrap:wrap}
.selbar.empty{border-inline-start-color:var(--line2);color:var(--muted)}
.lh{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center}
.lh h4{margin:0;font-size:13px;font-weight:700}
.pickbar{display:flex;gap:8px 14px;flex-wrap:wrap;align-items:center}
.pickbar label{display:inline-flex;gap:6px;align-items:center;cursor:pointer}
.pickbar .cnt{font-size:12px;color:var(--ink2);min-width:4.5em}
.pickbar select{border:1px solid var(--line2);background:var(--surface);color:var(--ink);border-radius:6px;padding:4px 8px;font:inherit;cursor:pointer}
.pickbar select:disabled,.pickbar .btn:disabled{opacity:.5;cursor:default}
.grip{position:absolute;left:12px;right:12px;top:-4px;height:12px;z-index:2;cursor:ns-resize;touch-action:none}
.grip::after{content:"";position:absolute;left:50%;top:6px;width:44px;height:4px;margin-left:-22px;border-radius:2px;background:var(--line2);opacity:.7}
.grip:hover::after,.grip.drag::after{background:var(--accent);opacity:1}
.panel.sized{height:min(var(--panel-h),calc(100vh - 16px));max-height:none}
:host(.popped){position:static;left:auto;right:auto;bottom:auto;height:100vh;width:100%;display:block}
:host(.popped) .sheet{max-width:none;margin:0;height:100vh}
:host(.popped) .panel{max-height:none;height:100vh;border:0;border-radius:0;box-shadow:none}
:host(.popped) .grip{display:none}
.body{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:12px;align-items:stretch}
.main,.side{display:flex;flex-direction:column;gap:8px;min-width:0}
.body.nolist{grid-template-columns:minmax(0,1fr)}
.body.nolist .side{display:none}
.list{display:flex;flex-direction:column;flex:1 1 0;min-height:240px;overflow-y:auto;border:1px solid var(--line);border-radius:8px}
.row{display:flex;align-items:stretch;border-bottom:1px solid var(--line);background:var(--surface);width:100%;color:var(--ink)}
.row:last-child{border-bottom:0}
.row:hover,.row.hov{background:var(--sunken)}
.row.chosen{background:var(--chosen)}
.row.sel{background:var(--accent-soft);box-shadow:inset 3px 0 0 var(--accent)}
.chk{display:flex;align-items:center;justify-content:center;flex:none;width:38px;cursor:pointer}
.chk input,.pickbar input[type=checkbox]{width:16px;height:16px;margin:0;cursor:pointer;accent-color:var(--bar)}
.rbtn{display:grid;grid-template-columns:64px minmax(0,1fr);gap:4px 12px;align-items:center;text-align:start;flex:1;min-width:0;border:0;background:none;color:inherit;font:inherit;padding:6px 12px 6px 0;cursor:pointer}
.thumb{grid-row:1 / span 2;align-self:start;position:relative;width:64px;height:36px;border-radius:4px;background:linear-gradient(135deg,var(--g1),var(--g2));overflow:hidden}
.thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.thumb i{position:absolute;right:2px;bottom:2px;font-style:normal;font-family:var(--mono);font-size:10px;line-height:1;background:rgba(0,0,0,.72);color:#fff;border-radius:2px;padding:2px 3px}
.rmain{min-width:0;display:flex;flex-direction:column;gap:1px}
.rmain b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.meta{font-size:12px;color:var(--ink2);display:flex;gap:2px 8px;flex-wrap:wrap;align-items:center}
.badge{font-size:11px;border-radius:3px;padding:0 5px;border:1px solid var(--line2);color:var(--ink2)}
.badge.k{border-style:dashed}
.rr{grid-column:2;font-size:12px;color:var(--ink2);text-align:start}
.rr small{display:block;color:var(--muted);font-size:11px;font-family:inherit}
.row.skel .rbtn{cursor:default}
.row.skel .chk{cursor:default}
.row.skel .thumb,.row.skel .sk{background:var(--line)}
.row.skel .sk{display:block;height:10px;border-radius:3px;width:60%}
.row.skel .sk.s{width:35%;margin-top:6px}
.msg{border:1px dashed var(--line2);border-radius:8px;padding:28px 18px;text-align:center;display:flex;flex-direction:column;gap:8px;align-items:center;color:var(--ink)}
.msg h4{margin:0;font-size:15px;font-weight:700}
.msg p{margin:0;max-width:52ch;color:var(--ink2)}
.msg.err{border-color:var(--err);background:var(--err-bg)}
.msg.err h4{color:var(--err)}
.msg .btns{display:flex;gap:8px;margin-top:4px}
.tip{position:fixed;z-index:5;pointer-events:none;background:var(--ink);color:var(--surface);border-radius:8px;padding:8px 10px;font-size:12px;max-width:290px;box-shadow:0 6px 24px rgba(0,0,0,.25);line-height:1.45}
.tip b{display:block;font-weight:700;font-size:13px;margin-bottom:2px}
.tip .mono{display:block}
.tip .dim{opacity:.72;display:block}
.tip span{display:block}
.tip.sm{padding:2px 6px;border-radius:4px;white-space:nowrap}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--ink);color:var(--surface);border-radius:8px;padding:8px 14px;z-index:6;box-shadow:0 6px 24px rgba(0,0,0,.25)}
@media (min-width:1301px){
  /* 높이를 직접 조절한 경우: 남는 높이를 지도의 줄 영역과 목록이 나눠 쓴다. */
  .panel.sized .body{flex:1 1 0;min-height:0;grid-template-rows:minmax(0,1fr)}
  .panel.sized .main{min-height:0}
  .panel.sized .mapwrap{flex:1 1 0;min-height:120px;display:flex;flex-direction:column}
  .panel.sized .lanes{flex:1 1 0;min-height:60px;max-height:none}
}
@media (max-width:1300px){
  .body{grid-template-columns:minmax(0,1fr)}
  .list{flex:none;min-height:0;max-height:340px}
}
@media (max-width:640px){
  .rbtn{grid-template-columns:56px minmax(0,1fr)}
  .thumb{width:56px;height:32px}
  .scanrow .bar{flex-basis:100%}
}
`;

    // ---------- 범용 유틸리티 ----------
    // 클립 탐색기와 무관한 헬퍼. 최상위에 두면 TamperMonkey 빌드에서 다른 모듈의 같은 이름(esc, clamp 등)과 충돌하므로 static으로 둔다.

    static esc(s) {
        return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    static clamp(v, a, b) {
        return Math.min(b, Math.max(a, v));
    }

    static num(n) {
        return Number(n).toLocaleString('ko-KR');
    }

    static todayYmd() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    /** 동시에 limit개씩 실행한다. 하나라도 실패하면 새로 시작하지 않고 바로 실패한다. */
    static async mapLimit(list, limit, fn) {
        let next = 0;
        let failed = false;
        const worker = async () => {
            while (!failed && next < list.length) {
                const i = next++;
                try {
                    await fn(list[i], i);
                } catch (e) {
                    failed = true;
                    throw e;
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
    }

    /** 'YYYY-MM-DD'에 일수를 더한다. (UTC로 계산해 시간대 영향이 없다) */
    static addDays(ymd, days) {
        const [y, m, d] = ymd.split('-').map(Number);
        const t = new Date(Date.UTC(y, m - 1, d + days));
        return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
    }

    /** 두 날짜(YYYY-MM-DD) 사이의 일수 (b - a). */
    static daysBetween(a, b) {
        const [ya, ma, da] = a.split('-').map(Number);
        const [yb, mb, db] = b.split('-').map(Number);
        return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
    }

    /** 'YYYY-MM-DD HH:MM:SS' → 초. 시간대와 무관하게 차이만 쓴다. 읽지 못하면 NaN. */
    static stampSeconds(stamp) {
        const m = String(stamp).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
        return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) / 1000 : NaN;
    }

    static p2(n) {
        return String(n).padStart(2, '0');
    }

    // ---------- 도메인 순수 함수 (static, DOM·네트워크 없음) ----------

    /**
     * 클립·캐치 상세의 original_clip_scheme에서 원본(title_no)과 원본 안의 시작 위치(changeSecond)를 읽는다.
     * 예: sooplive://player/video?title_no=106079848&type=REVIEW&changeSecond=28660
     * @returns {{ type: string, titleNo: string, changeSecond: number }|null} 필수 값이 없으면 null
     */
    static parseOriginalClipScheme(scheme) {
        if (typeof scheme !== 'string' || !scheme.includes('?')) return null;
        const params = new URLSearchParams(scheme.split('?')[1]);
        const titleNo = params.get('title_no');
        const rawChange = params.get('changeSecond');
        // Number(null)은 0이라 값이 없는 경우를 "0초에서 시작"으로 읽지 않도록 먼저 거른다.
        if (!titleNo || rawChange === null || rawChange.trim() === '') return null;
        const changeSecond = Number(rawChange);
        if (!Number.isFinite(changeSecond) || changeSecond < 0) return null;
        return { type: params.get('type') || '', titleNo: String(titleNo), changeSecond };
    }

    /**
     * write_tm("2026-09-19 14:00:33 ~ 2026-09-19 16:50:12")을 시작·종료로 나눈다. 시간대 변환 없이 문자열 그대로 읽고,
     * 종료가 없으면(라이브 진행 중 등) 시작과 같다고 본다.
     * @returns {{ startYmd: string, endYmd: string, startStamp: string, endStamp: string }|null} stamp는 "YYYY-MM-DD HH:MM:SS"
     */
    static parseWriteTm(writeTm) {
        if (typeof writeTm !== 'string') return null;
        const re = /(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})/g;
        const found = [...writeTm.matchAll(re)];
        if (found.length === 0) return null;
        const first = found[0];
        const last = found[found.length - 1];
        return {
            startYmd: first[1],
            endYmd: last[1],
            startStamp: `${first[1]} ${first[2]}:${first[3]}:${first[4]}`,
            endStamp: `${last[1]} ${last[2]}:${last[3]}:${last[4]}`,
        };
    }

    /** 검색할 수 있는 마지막 날짜. 서버·클라이언트 시간대 차이를 고려해 오늘 + 1일. */
    static searchCapDate(todayYmd) {
        return SoopClipMap.addDays(todayYmd, 1);
    }

    /** 검색 상태의 시작값: 라이브 시작일부터 1주 단위. */
    static firstSearchState(startYmd) {
        return { cursor: startYmd, stepIndex: 0 };
    }

    /**
     * 다음에 검색할 기간. 오늘까지 모두 검색했으면 null.
     * 예) 시작일 t, 1주 단위: t ~ t+6일, 그다음 t+7일 ~ t+13일 … (서버는 시작일 > 종료일이면 에러라 그런 기간은 만들지 않는다)
     * @returns {{ start: string, end: string, days: number, label: string }|null}
     */
    static nextSearchWindow(state, todayYmd) {
        const cap = SoopClipMap.searchCapDate(todayYmd);
        if (state.cursor > cap) return null;
        const step = SoopClipMap.SEARCH_STEPS[state.stepIndex];
        let end = SoopClipMap.addDays(state.cursor, step.days - 1);
        if (end > cap) end = cap;
        return { start: state.cursor, end, days: step.days, label: step.label };
    }

    /**
     * 한 기간을 검색한 결과로 다음 상태를 만든다. 연결된 항목이 0건이면 검색 단위를 한 단계 키우고(최대 1년), 있으면 그대로 둔다.
     * 키운 단위는 줄이지 않는다.
     * @param {{ end: string }} win 방금 검색한 기간
     * @param {number} matchCount 그 기간에서 찾은 연결 항목 수
     */
    static advanceSearchState(state, win, matchCount) {
        const stepIndex = matchCount === 0 ? Math.min(state.stepIndex + 1, SoopClipMap.SEARCH_STEPS.length - 1) : state.stepIndex;
        return { cursor: SoopClipMap.addDays(win.end, 1), stepIndex };
    }

    /** 검색 진행률(0~1): 라이브 시작일부터 오늘까지 중 cursor 앞까지 끝낸 비율. */
    static searchProgress(startYmd, cursorYmd, todayYmd) {
        const total = SoopClipMap.daysBetween(startYmd, SoopClipMap.searchCapDate(todayYmd)) + 1;
        if (total <= 0) return 1;
        const done = Math.min(Math.max(SoopClipMap.daysBetween(startYmd, cursorYmd), 0), total);
        return done / total;
    }

    /** 초 → "1분 12초", "2일 15시간 38분 57초". 0인 단위는 생략하고 전부 0이면 "0초". */
    static formatDuration(totalSec) {
        let s = Math.max(0, Math.floor(totalSec));
        const d = Math.floor(s / 86400);
        s %= 86400;
        const h = Math.floor(s / 3600);
        s %= 3600;
        const m = Math.floor(s / 60);
        s %= 60;
        const parts = [];
        if (d) parts.push(`${d}일`);
        if (h) parts.push(`${h}시간`);
        if (m) parts.push(`${m}분`);
        if (s || parts.length === 0) parts.push(`${s}초`);
        return parts.join(' ');
    }

    /**
     * 클립·캐치가 올라오기까지 걸린 시간을 표기한다.
     *  - 라이브 종료 전 등록: 클립 끝 지점의 라이브 당시 시각부터 → "사건 발생 1분 12초 후 등록됨"
     *  - 라이브 종료 후 등록: 라이브 종료 시각부터 → "라이브 종료 2일 3시간 15분 8초 후 등록됨"
     * 당시 시각은 wallSecAt으로 구한다. 결과가 음수면(잘려 나간 구간의 클립 등) 시간을 지어내지 않고 "라이브 중 등록됨"으로 표기한다.
     * @param {string} regDate reg_date ("YYYY-MM-DD HH:MM:SS")
     * @param {{ endStamp: string, wallMap: WallSegment[] }} live 라이브 종료 시각과 buildWallMap 결과
     * @param {number} clipEndSec 클립·캐치가 끝나는 재생 위치(초)
     * @returns {string} 계산할 수 없으면 ''
     */
    static formatRegistration(regDate, live, clipEndSec) {
        const regSec = SoopClipMap.stampSeconds(regDate);
        const endSec = SoopClipMap.stampSeconds(live?.endStamp);
        if (!Number.isFinite(regSec) || !Number.isFinite(endSec)) return '';
        if (regSec <= endSec) {
            const delay = regSec - SoopClipMap.wallSecAt(live.wallMap, clipEndSec);
            return Number.isFinite(delay) && delay >= 0 ? `사건 발생 ${SoopClipMap.formatDuration(delay)} 후 등록됨` : '라이브 중 등록됨';
        }
        return `라이브 종료 ${SoopClipMap.formatDuration(regSec - endSec)} 후 등록됨`;
    }

    /**
     * @typedef {{ cum: number, dur: number, wall: number }} WallSegment
     *   cum: 파일이 시작하는 재생 위치(초), dur: 길이(초), wall: 파일이 시작하는 라이브 당시 시각(초)
     */

    /**
     * 다시보기의 파일 목록으로 "재생 위치 → 라이브 당시 시각" 매핑을 만든다.
     * 컷 편집된 다시보기는 잘려 나간 만큼 파일 사이 시각이 건너뛰어 "라이브 시작 + 재생 위치"로는 어긋난다.
     * 출발점은 write_tm의 라이브 시작 시각이고, file_start는 파일 사이의 틈에만 쓴다.
     * (첫 파일의 file_start가 write_tm 시작보다 늦는 다시보기가 있고, 클립 위치는 write_tm 시작 기준이다.)
     * 파일 정보를 읽을 수 없으면 끊김 없이 이어진다고 본다.
     * @param {{ duration?: number, file_start?: string }[]|undefined} files duration은 ms
     * @param {{ startStamp: string, totalSec: number }} fallback startStamp는 write_tm의 라이브 시작 시각
     * @returns {WallSegment[]}
     */
    static buildWallMap(files, fallback) {
        const base = SoopClipMap.stampSeconds(fallback.startStamp);
        const single = () => [{ cum: 0, dur: fallback.totalSec, wall: base }];
        if (!Array.isArray(files) || files.length === 0 || !Number.isFinite(base)) return single();
        const first = SoopClipMap.stampSeconds(files[0]?.file_start);
        const segs = [];
        let cum = 0;
        for (const f of files) {
            const dur = Number(f?.duration) / 1000;
            const fs = SoopClipMap.stampSeconds(f?.file_start);
            if (!(dur > 0) || !Number.isFinite(fs) || !Number.isFinite(first)) return single();
            segs.push({ cum, dur, wall: base + (fs - first) });
            cum += dur;
        }
        return segs;
    }

    /** 재생 위치(초) → 라이브 당시 시각(초). 범위를 벗어나면 가장 가까운 파일에서 이어 계산한다. */
    static wallSecAt(map, pos) {
        let seg = map[0];
        for (const s of map) if (pos >= s.cum) seg = s;
        return seg.wall + (pos - seg.cum);
    }

    /** 라이브 당시 시각(초) → "HH:MM[:SS]" */
    static formatClock(wallSec, withSec = true) {
        const x = ((Math.floor(wallSec) % 86400) + 86400) % 86400;
        const hm = `${String(Math.floor(x / 3600)).padStart(2, '0')}:${String(Math.floor((x % 3600) / 60)).padStart(2, '0')}`;
        return withSec ? `${hm}:${String(x % 60).padStart(2, '0')}` : hm;
    }

    /**
     * 다시보기에서 빠진 라이브 구간(파일 사이에서 라이브 시각이 건너뛰는 곳). 편집으로 잘렸거나 방송이 끊긴 경우다.
     * @returns {{ pos: number, skipSec: number, fromSec: number, toSec: number }[]} pos는 건너뛴 뒤 파일이 시작하는 재생 위치
     */
    static wallGaps(map, minSec = SoopClipMap.WALL_GAP_MIN_SEC) {
        const gaps = [];
        for (let i = 1; i < map.length; i++) {
            const prevEnd = map[i - 1].wall + map[i - 1].dur;
            const skip = map[i].wall - prevEnd;
            if (skip > minSec) gaps.push({ pos: map[i].cum, skipSec: skip, fromSec: prevEnd, toSec: map[i].wall });
        }
        return gaps;
    }

    /**
     * [t0, t1] 재생 위치 범위에서 라이브 당시 시각이 step(초)의 배수인 눈금. 파일마다 따로 계산해 잘려 나간 구간을 건너뛴다.
     * @returns {{ t: number, wall: number }[]} t는 재생 위치
     */
    static wallTicks(map, t0, t1, step) {
        const ticks = [];
        for (const seg of map) {
            const a = Math.max(t0, seg.cum);
            const b = Math.min(t1, seg.cum + seg.dur);
            if (a > b) continue;
            const wa = seg.wall + (a - seg.cum);
            const wb = seg.wall + (b - seg.cum);
            for (let w = Math.ceil(wa / step) * step; w <= wb; w += step) ticks.push({ t: seg.cum + (w - seg.wall), wall: w });
        }
        return ticks;
    }

    /** 1:23:45 */
    static formatHms(sec) {
        const t = Math.max(0, Math.round(sec));
        return `${Math.floor(t / 3600)}:${SoopClipMap.p2(Math.floor((t % 3600) / 60))}:${SoopClipMap.p2(t % 60)}`;
    }

    /** 댓글 타임라인용 HH:MM:SS (소수점 버림). 편집 VOD의 "타임라인 복사"와 같은 형식. */
    static formatTimelineTime(sec) {
        const s = Math.max(0, Math.floor(Number(sec) || 0));
        return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }

    /**
     * 항목들을 댓글 타임라인("HH:MM:SS ~ HH:MM:SS 이름")으로 만든다. 한 줄에 하나, 시작이 빠른 순(같으면 끝이 빠른 순).
     * 편집 VOD(soop_veditor_replacement.js)의 "타임라인 복사"와 같은 형식이다.
     * @param {{ s: number, e: number, name?: string }[]} entries
     * @param {'none'|'prefix'|'suffix'} mode none: 이름 제외, suffix: 이름 뒤, 그 밖(prefix): 이름 앞. 이름이 비면 시각만.
     * @returns {string} 항목이 없으면 ''
     */
    static buildTimelineText(entries, mode = 'prefix') {
        return entries
            .map((x, i) => ({ x, i }))
            .sort((a, b) => a.x.s - b.x.s || a.x.e - b.x.e || a.i - b.i)
            .map(({ x }) => {
                const base = `${SoopClipMap.formatTimelineTime(x.s)} ~ ${SoopClipMap.formatTimelineTime(x.e)}`;
                const name = String(x.name || '').trim();
                if (!name || mode === 'none') return base;
                return mode === 'suffix' ? `${base} ${name}` : `${name} ${base}`;
            })
            .join('\n');
    }

    /** 4:59 */
    static formatDur(sec) {
        const t = Math.round(sec);
        return `${Math.floor(t / 60)}:${SoopClipMap.p2(t % 60)}`;
    }

    /**
     * 겹치는 구간을 서로 다른 줄에 배치한다(탐욕적 구간 색칠). 각 항목에 lane(0부터)을 기록한다.
     * @param {number} [gapSec] 같은 줄에서 앞뒤 구간 사이 최소 간격
     * @returns {number} 필요한 줄 수(최소 1)
     */
    static packLanes(list, gapSec = 20) {
        const ends = [];
        const sorted = list.slice().sort((a, b) => a.s - b.s || (b.e - b.s) - (a.e - a.s));
        for (const it of sorted) {
            let k = 0;
            while (k < ends.length && ends[k] > it.s - gapSec) k++;
            ends[k] = it.e;
            it.lane = k;
        }
        return Math.max(1, ends.length);
    }

    /** [t0, t1]을 bins칸으로 나눠 칸마다 겹치는 구간 수를 센다. (Int16Array) */
    static computeDensity(list, t0, t1, bins) {
        const diff = new Int16Array(bins + 1);
        const span = t1 - t0;
        for (const it of list) {
            if (it.e < t0 || it.s > t1) continue;
            const b0 = Math.max(0, Math.floor(((it.s - t0) / span) * bins));
            const b1 = Math.min(bins - 1, Math.max(b0, Math.ceil(((it.e - t0) / span) * bins) - 1));
            diff[b0]++;
            diff[b1 + 1]--;
        }
        for (let i = 1; i < bins; i++) diff[i] += diff[i - 1];
        return diff.subarray(0, bins);
    }

    /** 겹침 개수 → 색 단계 0~6. (0은 표시 안 함, 1·2·3·4~5·6~8·9 이상) */
    static densityClass(count) {
        if (count <= 0) return 0;
        if (count <= 3) return count;
        if (count <= 5) return 4;
        if (count <= 8) return 5;
        return 6;
    }

    /** 같은 단계가 이어지는 칸을 [from, to) 범위 하나로 합친다. 단계 0은 제외. */
    static densityRuns(counts) {
        const runs = [];
        let i = 0;
        while (i < counts.length) {
            const cls = SoopClipMap.densityClass(counts[i]);
            let j = i + 1;
            while (j < counts.length && SoopClipMap.densityClass(counts[j]) === cls) j++;
            if (cls > 0) runs.push({ from: i, to: j, cls });
            i = j;
        }
        return runs;
    }

    /**
     * 가장 많이 겹치는 곳을 최대 max개 찾는다. 겹침이 2 미만이면 나오지 않고, 한 곳을 고르면 그 주변(폭 + 12칸)은 다음 후보에서 제외한다.
     * @param {number} total 다시보기 전체 길이
     * @returns {{ s: number, e: number, peak: number, at: number }[]}
     */
    static findHotspots(list, total, binSec = 10, max = 3) {
        const nb = Math.max(1, Math.ceil(total / binSec));
        const a = SoopClipMap.computeDensity(list, 0, total, nb);
        const used = new Uint8Array(nb);
        const out = [];
        for (let k = 0; k < max; k++) {
            let bi = -1;
            let bv = 1;
            for (let i = 0; i < nb; i++) {
                if (!used[i] && a[i] > bv) { bv = a[i]; bi = i; }
            }
            if (bi < 0) break;
            const th = Math.max(2, Math.ceil(bv * 0.6));
            let l = bi;
            let r = bi;
            while (l > 0 && a[l - 1] >= th && !used[l - 1]) l--;
            while (r < nb - 1 && a[r + 1] >= th && !used[r + 1]) r++;
            out.push({ s: l * binSec, e: (r + 1) * binSec, peak: bv, at: bi * binSec });
            for (let q = Math.max(0, l - 12); q <= Math.min(nb - 1, r + 12); q++) used[q] = 1;
        }
        return out;
    }

    /** 눈금 사이가 최소 minPx가 되는 가장 촘촘한 눈금 간격(초). */
    static niceTickStep(pxPerSec, minPx = 92) {
        const steps = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
        for (const s of steps) if (s * pxPerSec >= minPx) return s;
        return 7200;
    }

    /** "[클립] 제목", "[캐치] 제목"에서 접두사를 뗀다. */
    static stripKindPrefix(title) {
        return String(title).replace(/^\[(클립|캐치)\]\s*/, '');
    }
}
