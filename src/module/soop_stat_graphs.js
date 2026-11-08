import { IVodSync } from './interface4log.js';

/**
 * 방송 통계 목록의 기본 그래프 버튼(채팅·유저 수·UP)을 우리 기능으로 바꾼다.
 * 버튼을 누르면 재생 바 위에 분당 그래프를 그리고, 기본 SOOP 그래프는 열리지 않게 막는다.
 *
 * - 한 번에 하나만 켠다(재생 바 공간이 하나). 다른 버튼을 누르면 그 그래프로 바뀐다. 같은 버튼을 다시 누르면 끈다.
 * - 켠 종류의 데이터만 받는다. 종류별로 한 번씩만 받고 다시 쓴다.
 */
export class SoopStatGraph extends IVodSync {
    /** 종류별 차이는 여기 표에만 둔다. module=szModule, nIdx=목록 번호, source=SOOP 기본 버튼 글자. */
    static MODES = {
        chat: { module: 'BjChatCnt', nIdx: '3', source: '채팅 수 그래프' },
        viewer: { module: 'BjViewCnt', nIdx: '1', source: '유저 수 그래프' },
        up: { module: 'BjUpCnt', nIdx: '5', source: 'UP 그래프' },
    };
    static REF_VIDEO_H = 746; // 영상 높이 기준: 이 높이일 때 그래프 기본 높이가 REF_GRAPH_H
    static REF_GRAPH_H = 100;
    static MIN_GRAPH_H = 24;
    static INFO_TEXT = 'VOD Master가 이 기능을 개선했습니다.';

    constructor() {
        super();
        this.enabled = true;
        this.videoId = window.location.pathname.match(/\/player\/(\d+)/)?.[1] ?? '';
        this._mode = null;        // 지금 켜진 종류 (없으면 null)
        this._btns = {};          // 종류 → 기본 목록 버튼
        this._dataCache = {};     // 종류 → 데이터 Promise (같은 종류는 한 번만 받는다)
        this._infoPromise = null; // 다시보기 정보 (종류와 무관하게 한 번만)
        this._box = null;         // 재생 바에 붙인 그래프 박스
        this._cnt = null;         // 지금 그래프의 [분, 값] 배열
        this._text = '%s';        // 툴팁 문구 틀 (서버가 준 것)
        this._opacity = 50;       // 그래프 배경 불투명도 (0~100). _loadSettings에서 저장된 값으로 바뀐다.
        this._userHeight = 0;
        this._watchedCtrl = null;
        this.init();
    }

    async init() {
        await this._loadSettings();
        if (!this.enabled || !this.videoId) return;
        this._injectStyle();
        // 플레이어와 통계 목록은 DOM 변화가 잦으므로 한 프레임에 한 번만 확인한다. 옵저버는 하나만 둔다.
        let queued = false;
        new MutationObserver(() => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => { queued = false; this._safeSync(); });
        }).observe(document.body, { childList: true, subtree: true });
        // 가로는 이제 CSS(width:100%)라 맞출 필요가 없고, 세로(%)는 .player_ctrlBox가 통째로 줄어들어도 비율이 그대로라 다시 잴 필요가 없다.
        // 스크롤로 작아지는 미니 플레이어도 보통 .player_ctrlBox의 style/class를 바꾸는 방식이라 _watchControls가 이미 잡는다.
        // 순수 창 크기 변화(resize)만 다른 신호가 없어 따로 듣는다.
        window.addEventListener('resize', () => {
            const bar = this._findBar();
            if (this._box && bar) this._positionBox(bar);
        });
        this._safeSync();
    }

    async _loadSettings() {
        // TamperMonkey: 설정은 GM 저장소(유저스크립트 메뉴에서 바꾼다).
        if (window.VODSync?.IS_TAMPER_MONKEY_SCRIPT === true) {
            if (typeof GM_getValue === 'function') {
                this.enabled = GM_getValue('enableStatGraphs', true) !== false;
                this._opacity = Number(GM_getValue('statGraphOpacity', 50));
            }
            return;
        }
        try {
            const response = await chrome.runtime.sendMessage({ action: 'getAllSettings' });
            if (response?.success && response.settings) {
                this.enabled = response.settings.enableStatGraphs !== false;
                this._opacity = Number(response.settings.statGraphOpacity ?? 50);
            }
        } catch (error) {
            this.warn('설정 로드 실패, 기본값 사용:', error);
        }
    }

    _injectStyle() {
        if (document.getElementById('vs-stat-graph-style')) return;
        const style = document.createElement('style');
        style.id = 'vs-stat-graph-style';
        style.textContent = `
            .vs-cg-bar{position:absolute;z-index:0;pointer-events:auto;color:#4b8bf5;border-radius:4px 4px 0 0}
            .multiple_progress{position:relative;z-index:1}
            .vs-cg-bar.vs-cg-hidden{display:none}
            .vs-cg-canvas{display:block;width:100%;height:100%;cursor:pointer}
            .vs-cg-grip{position:absolute;left:0;right:0;top:-4px;height:8px;cursor:ns-resize;z-index:2;touch-action:none}
            .vs-cg-grip::after{content:'';position:absolute;left:50%;top:3px;width:44px;height:3px;margin-left:-22px;border-radius:2px;background:currentColor;opacity:.6}
            .vs-cg-tip{position:absolute;left:0;bottom:calc(100% + 4px);white-space:nowrap;pointer-events:none;
                background:#222;color:#fff;border-radius:4px;padding:2px 6px;font-size:11px}
            .vs-cg-line{position:absolute;left:0;top:0;bottom:0;width:0;border-left:1px solid currentColor;pointer-events:none;z-index:2}
        `;
        document.head.appendChild(style);
    }

    /** _sync 도중 예외가 나도 다음 호출까지 조용히 멈추지 않게 감싼다. */
    _safeSync() {
        try {
            this._sync();
        } catch (e) {
            this.error('동기화 중 오류', e);
        }
    }

    /** 기본 버튼을 우리 것으로 맞추고, 켜진 종류가 있으면 재생 바에 그래프를 붙인다. */
    _sync() {
        this._decorateSourceButtons();
        this._ensureBarGraph();
    }

    /** SOOP이 목록을 다시 그렸을 수 있으니 세 버튼을 매번 확인하고, 아직 바뀌지 않은 것만 바꾼다. */
    _decorateSourceButtons() {
        // 이미 셋 다 꾸며져 있고 그대로 붙어 있으면, 매번 목록 전체를 다시 훑지 않는다(흔한 경우라 이득이 크다).
        const allDone = Object.keys(SoopStatGraph.MODES)
            .every((m) => this._btns[m]?.isConnected && this._btns[m].querySelector('.vs-cg-info'));
        if (allDone) return;
        const buttons = [...document.querySelectorAll('.statistics_list_contents button')];
        for (const [mode, C] of Object.entries(SoopStatGraph.MODES)) {
            const btn = buttons.find((b) => b.dataset.vsStat === C.module
                || (!b.dataset.vsStat && b.firstChild?.textContent?.trim() === C.source));
            if (!btn || btn.dataset.vsStat === C.module && btn.querySelector('.vs-cg-info')) continue;
            this._decorateButton(btn, mode, C);
        }
    }

    _decorateButton(btn, mode, C) {
        btn.dataset.vsStat = C.module;
        // ⓘ는 글자로 둔다. SVG는 SOOP 목록의 이벤트 핸들러가 className을 잘못 읽어 오류를 낸다.
        btn.insertAdjacentHTML('beforeend',
            `<span class="vs-cg-info" tabindex="0" aria-label="${SoopStatGraph.INFO_TEXT}" style="display:inline-block;margin-left:6px;font-size:1em;line-height:1;vertical-align:middle;position:relative;top:-15%;opacity:.7;cursor:help">ⓘ</span>`);
        // 문구는 목록 패널 밖(body)에 띄운다. 목록 안에 두면 패널 가장자리에서 잘린다.
        const info = btn.querySelector('.vs-cg-info');
        info.addEventListener('pointerenter', () => this._showInfo(info));
        info.addEventListener('pointerleave', () => this._hideInfo());
        // capture 단계에서 막아서 SOOP 기본 그래프가 그려지지 않게 한다.
        btn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            this._setMode(this._mode === mode ? null : mode);
        }, true);
        this._btns[mode] = btn;
        this._paintButton(mode);
    }

    /** 켜짐 표시를 현재 종류에 맞춘다. "on" 클래스는 SOOP 방식대로 버튼이 아니라 li에 붙인다. */
    _paintButton(mode) {
        const btn = this._btns[mode];
        if (!btn?.isConnected) return;
        const on = this._mode === mode;
        btn.setAttribute('aria-pressed', String(on));
        btn.closest('li')?.classList.toggle('on', on);
    }

    /** 아이콘 위쪽(공간이 없으면 아래쪽)에 문구를 띄우고, 화면 밖으로 나가지 않게 가장자리에서 민다. */
    _showInfo(icon) {
        let tip = document.getElementById('vs-cg-info-float');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'vs-cg-info-float';
            tip.textContent = SoopStatGraph.INFO_TEXT;
            tip.style.cssText = 'position:fixed;z-index:2147483647;display:none;white-space:nowrap;pointer-events:none;'
                + 'background:#222;color:#fff;border-radius:4px;padding:4px 8px;font:400 12px/1.4 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3)';
            document.body.appendChild(tip);
        }
        const r = icon.getBoundingClientRect();
        tip.style.display = 'block';
        const w = tip.offsetWidth;
        const h = tip.offsetHeight;
        tip.style.left = `${SoopStatGraph.clamp(r.left + r.width / 2 - w / 2, 8, window.innerWidth - w - 8)}px`;
        tip.style.top = `${r.top - h - 8 >= 4 ? r.top - h - 8 : r.bottom + 8}px`;
    }

    _hideInfo() {
        const tip = document.getElementById('vs-cg-info-float');
        if (tip) tip.style.display = 'none';
    }

    _backgroundColor() {
        return `rgba(17, 21, 27, ${this._opacity / 100})`;
    }

    /** 지금 불투명도를 그래프·닫기/설정 버튼과(열려 있으면) 설정 창에 바로 반영한다(미리보기). */
    _applyOpacity() {
        const c = this._backgroundColor();
        if (this._box) this._box.style.background = c;
        const opacityBtn = this._box?.querySelector('.vs-cg-opacity-btn');
        if (opacityBtn) opacityBtn.style.background = c;
        const close = this._box?.querySelector('.vs-cg-close');
        if (close) close.style.background = c;
        const pop = document.getElementById('vs-cg-opacity-popup');
        if (pop) pop.style.background = c;
    }

    /** 설정에 저장한다. 그래프 패널 쪽에서 바꾼 값도 설정 페이지에 그대로 보이게. */
    _saveOpacity(v) {
        if (window.VODSync?.IS_TAMPER_MONKEY_SCRIPT === true) {
            if (typeof GM_setValue === 'function') GM_setValue('statGraphOpacity', v);
            return;
        }
        chrome.runtime.sendMessage({ action: 'saveSettings', settings: { statGraphOpacity: v } })
            .catch((e) => this.warn('불투명도 저장 실패', e));
    }

    /** 불투명도 조절 작은 창을 열거나(이미 열려 있으면) 닫는다. */
    _toggleOpacityPopup(btn) {
        if (document.getElementById('vs-cg-opacity-popup')) {
            this._hideOpacityPopup();
            return;
        }
        this._showOpacityPopup(btn);
    }

    /**
     * 작은 창은 document.body가 아니라 톱니 버튼이 있는 툴바(그래프 박스 안)에 넣는다. 그래야 이 창
     * 위에 마우스가 있어도 재생 컨트롤 영역의 자손으로 남아서, 컨트롤이 "마우스가 벗어났다"고 보고
     * 내려가 그래프가 사라지는 일이 없다. 위치도 fixed(화면 좌표) 대신 툴바 기준 absolute로 둔다.
     */
    _showOpacityPopup(btn) {
        const pop = document.createElement('div');
        pop.id = 'vs-cg-opacity-popup';
        pop.style.cssText = 'position:absolute;left:0;bottom:100%;margin-bottom:8px;width:180px;color:#fff;'
            + 'border:1px solid #3a3f47;border-radius:8px;padding:10px 12px;font:12px/1.4 sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4)';
        pop.style.background = this._backgroundColor();
        pop.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'
            + `<span>배경 불투명도</span><span id="vs-cg-opacity-value">${this._opacity}%</span></div>`
            + `<input type="range" id="vs-cg-opacity-range" min="0" max="100" value="${this._opacity}" style="width:100%;accent-color:#4b8bf5">`;
        btn.closest('.vs-cg-toolbar').appendChild(pop);
        // 톱니가 화면/영상 오른쪽 끝에 가까우면 left:0 그대로는 창이 밖으로 넘어간다. 화면 전체가 아니라
        // 실제 영상(#video) 영역 기준으로 맞춘다 — 컨트롤 박스는 영상보다 넓을 수 있어서(레터박스 등) 화면
        // 기준으로만 맞추면 영상 밖(검은 여백)으로 나가 버린다. #video를 못 찾으면 화면 기준으로 되돌아간다.
        const pr = pop.getBoundingClientRect();
        const vr = document.querySelector('#video')?.getBoundingClientRect();
        const bound = vr?.width ? { left: vr.left + 8, right: vr.right - 8 } : { left: 8, right: window.innerWidth - 8 };
        const idealLeft = SoopStatGraph.clamp(pr.left, bound.left, Math.max(bound.left, bound.right - pr.width));
        if (idealLeft !== pr.left) pop.style.left = `${idealLeft - pr.left}px`;

        const readout = pop.querySelector('#vs-cg-opacity-value');
        pop.querySelector('#vs-cg-opacity-range').addEventListener('input', (ev) => {
            this._opacity = Number(ev.target.value);
            readout.textContent = `${this._opacity}%`;
            this._applyOpacity();
        });
        pop.querySelector('#vs-cg-opacity-range').addEventListener('change', (ev) => this._saveOpacity(Number(ev.target.value)));

        // 바깥을 누르거나(그래프 쪽 입력은 bubble 전에 가로채야 하므로 capture) Esc를 누르면 닫는다.
        const onOutside = (ev) => { if (!pop.contains(ev.target) && ev.target !== btn) this._hideOpacityPopup(); };
        const onKey = (ev) => { if (ev.key === 'Escape') this._hideOpacityPopup(); };
        document.addEventListener('pointerdown', onOutside, true);
        document.addEventListener('keydown', onKey, true);
        this._opacityPopupCleanup = () => {
            document.removeEventListener('pointerdown', onOutside, true);
            document.removeEventListener('keydown', onKey, true);
        };
    }

    _hideOpacityPopup() {
        document.getElementById('vs-cg-opacity-popup')?.remove();
        this._opacityPopupCleanup?.();
        this._opacityPopupCleanup = null;
    }

    /** 종류를 바꾼다(null이면 끈다). 이전 종류의 그래프는 떼고, 버튼 표시도 맞춘다. */
    _setMode(mode) {
        if (this._mode === mode) return;
        this.log(`모드 전환: ${this._mode ?? '(없음)'} → ${mode ?? '(없음)'}`);
        this._mode = mode;
        this._cnt = null;
        for (const m of Object.keys(SoopStatGraph.MODES)) this._paintButton(m);
        this._ensureBarGraph();
    }

    /**
     * 재생 바 요소를 찾는다. 구간이 여럿인 다시보기는 `.multiple_progress` 안에 조각(.progress)이 여럿 있고,
     * 구간이 하나뿐인 다시보기는 감싸는 `.multiple_progress` 없이 `.progress` 하나만 컨트롤 박스 바로 아래에 있다.
     */
    _findBar() {
        const ctrl = document.querySelector('.player_ctrlBox');
        if (!ctrl) return null;
        return ctrl.querySelector('.multiple_progress') || ctrl.querySelector(':scope > .progress') || ctrl.querySelector('.progress');
    }

    /** 켜져 있으면 재생 바에 그래프를 붙이고, 꺼져 있으면 떼어 낸다. */
    _ensureBarGraph() {
        if (!this._mode) {
            this._box?.remove();
            this._box = null;
            this._hideOpacityPopup();
            return;
        }
        const bar = this._findBar();
        if (!bar) {
            this.warn(`재생 바를 찾지 못해 그래프를 붙이지 못했어요. (mode=${this._mode})`);
            return;
        }
        this._bindHover(bar);
        this._watchControls(bar);
        // 같은 종류의 박스가 이미 붙어 있으면 그대로 둔다. 종류가 바뀌었거나 SOOP이 바를 다시 그렸으면 새로 붙인다.
        if (this._box?.isConnected && this._box.parentElement === bar.parentElement && this._box.dataset.mode === this._mode) {
            this._applyVisibility(bar); // 이미 찾은 bar를 넘겨서, 안에서 또 찾고 또 재는 중복을 없앤다
            return;
        }
        this.log(`그래프 박스 새로 만듦 (mode=${this._mode})`);
        this._hideOpacityPopup(); // 옛 박스를 가리키던 창이면 닫는다
        this._box?.remove();
        // 박스는 재생 바의 형제로 둔다. 재생 바 안에 두면 썸네일 미리보기 영역에 들어가 마우스가 바에 올라간 것으로 잡힌다.
        const box = document.createElement('div');
        box.className = 'vs-cg-bar';
        box.dataset.mode = this._mode;
        box.style.height = `${this._graphHeight()}px`;
        // 배경은 반투명(설정에서 조절). SOOP 스타일이 덮어쓰지 않도록 인라인으로 준다.
        box.style.background = this._backgroundColor();
        bar.parentElement.insertBefore(box, bar);
        this._box = box;
        this._bindHover(box);
        this._applyVisibility(bar); // 숨김 여부 확인과 함께 위치도 맞춘다 (숨겨진 상태가 아니면)
        this._load(box, this._mode);
    }

    /** 바와 그래프 박스의 호버 이벤트. 같은 핸들러를 두 요소에 붙이고, 크기는 진입할 때 읽는다. */
    _bindHover(el) {
        if (el.dataset.vsCgHover) return;
        el.dataset.vsCgHover = '1';
        el.addEventListener('pointerenter', () => { this._hoverIdx = -1; });
        // 툴바(설정·닫기 버튼)는 그래프 박스의 자손이라 이 핸들러를 그대로 타는데, 그래프 그림 위가 아니므로
        // 세로줄·시간 표시는 띄우지 않는다.
        el.addEventListener('pointermove', (ev) => {
            if (ev.target.closest('.vs-cg-toolbar')) { this._hideBarTip(); return; }
            this._queueHover(ev.clientX);
        });
        el.addEventListener('pointerleave', () => this._hideBarTip());
    }

    /**
     * box는 bar(재생 바)의 형제로 붙어 있고, bar.parentElement는 div.player_ctrlBox다.
     * (버튼·시간 표시가 있는 div.ctrlBox는 div.player_ctrlBox의 또 다른 자식일 뿐, box와는 직접 상관없다.)
     */
    _positionBox(bar) {
        const box = this._box;
        const ctrl = bar.parentElement; // div.player_ctrlBox
        if (!box || !ctrl) {
            this.warn('그래프 박스 위치를 맞추지 못했어요. (box=' + !!box + ', ctrl=' + !!ctrl + ')');
            return;
        }
        if (getComputedStyle(ctrl).position === 'static') ctrl.style.position = 'relative';
        // div.ctrlBox(재생·음량·시간 표시 줄)는 div.player_ctrlBox보다 약간 좁다(패딩 등). 그래서 꽉 채우는 대신
        // ctrlBox의 실제 가로 위치·폭에 맞춘다. 픽셀 차이 대신 .player_ctrlBox 기준 비율(%)로 두면, 스크롤로
        // 플레이어가 작아질 때도(변형이 걸려도) 항상 맞는다.
        const cr = ctrl.getBoundingClientRect();
        const br = bar.getBoundingClientRect();
        if (!cr.width || !cr.height) return;
        const controlsRow = ctrl.querySelector(':scope > .ctrlBox') ?? ctrl.querySelector('.ctrlBox');
        const wr = controlsRow ? controlsRow.getBoundingClientRect() : cr;
        box.style.left = `${((wr.left - cr.left) / cr.width) * 100}%`;
        box.style.width = `${(wr.width / cr.width) * 100}%`;
        box.style.bottom = `${((cr.bottom - br.top) / cr.height) * 100}%`;
    }

    /**
     * 마우스 이동은 프레임당 한 번만 화면에 반영한다. 박스 크기는 진입할 때가 아니라 매번(프레임마다) 다시 잰다 —
     * 스크롤로 플레이어가 작아지는 동안은 마우스가 박스를 떠나지 않아도(= pointerenter가 다시 안 와도) 크기가
     * 계속 바뀌기 때문에, 캐시해 두면 점점 더 벌어진다.
     */
    _queueHover(x) {
        this._hoverX = x;
        if (this._hoverQueued) return;
        this._hoverQueued = true;
        requestAnimationFrame(() => {
            this._hoverQueued = false;
            const cnt = this._cnt;
            const box = this._box;
            if (this._hoverX === null || !cnt || !box?.isConnected) return;
            const r = box.getBoundingClientRect();
            if (!r.width) return;
            // 바 위에서 넘어온 마우스 위치일 수도 있으니, 박스 가로 범위 밖이면 가장 가까운 끝으로 붙인다.
            const frac = SoopStatGraph.clamp((this._hoverX - r.left) / r.width, 0, 1);
            const i = Math.round(frac * (cnt.length - 1));
            if (i === this._hoverIdx) return;
            this._hoverIdx = i;
            this._paintHover(box, i);
        });
    }

    /**
     * 툴팁과 세로줄을 시간 위치로 옮긴다. 픽셀(transform:translateX)이 아니라 퍼센트(left)로 둔다.
     * 스크롤로 작아지는 미니 플레이어는 보통 어느 조상 요소에 transform:scale을 걸어 구현한다. px 값은
     * 그 요소 자신의(변형 전) 좌표계 기준이라, scale이 걸린 채로 쓰면 그 배율만큼 한 번 더 깎여 끝으로 갈수록
     * 밀린다. %는 레이아웃 시점에 한 번만 박스 폭(= box.style.width와 같은 기준)에 대해 풀리므로 그런 일이 없다.
     */
    _paintHover(box, i) {
        const tip = box.querySelector('.vs-cg-tip');
        const line = box.querySelector('.vs-cg-line');
        if (!tip || !line) return;
        const pct = (i / (this._cnt.length - 1)) * 100;
        this._fillTip(tip, i);
        tip.style.left = `${pct}%`;
        tip.style.transform = 'translateX(-50%)'; // 이건 툴팁 자기 자신의 폭 기준 중앙 정렬이라 scale과 무관하다
        line.style.left = `${pct}%`;
        line.hidden = false;
    }

    _hideBarTip() {
        this._hoverX = null;
        this._hoverIdx = -1;
        this._box?.querySelector('.vs-cg-tip')?.setAttribute('hidden', '');
        this._box?.querySelector('.vs-cg-line')?.setAttribute('hidden', '');
    }

    /** 툴팁 글자: 재생 시간 + 서버가 준 문구("채팅 %s개" 등)에 값을 넣는다. */
    _fillTip(tip, i) {
        const [minute, v] = this._cnt[i];
        tip.hidden = false;
        tip.textContent = `${SoopStatGraph.formatMinute(minute)} · ${this._text.replace('%s', v)}`;
    }

    /** 플레이어 컨트롤 박스의 style(bottom)이 바뀔 때만 다시 확인한다. 재생 바 진행 표시는 자주 바뀌므로 그 변화에는 반응하지 않는다. */
    _watchControls(bar) {
        const ctrl = bar.closest('.player_ctrlBox');
        if (!ctrl || this._watchedCtrl === ctrl) return;
        this._watchedCtrl = ctrl;
        new MutationObserver(() => this._applyVisibility()).observe(ctrl, { attributes: true, attributeFilter: ['style', 'class'] });
    }

    /** 컨트롤 박스가 숨겨져(bottom이 0이 아닐 때) 있으면 그래프도 함께 숨긴다. */
    _applyVisibility(bar = this._findBar()) {
        const box = this._box;
        if (!box?.isConnected) return;
        const ctrl = box.parentElement;
        const bottom = ctrl ? parseFloat(getComputedStyle(ctrl).bottom) : 0;
        const hidden = !Number.isNaN(bottom) && bottom !== 0;
        box.classList.toggle('vs-cg-hidden', hidden);
        // 컨트롤 박스가 움직였으면 바 위치도 따라간다. bar를 이미 아는 호출(_ensureBarGraph)은 다시 찾지 않는다.
        if (!hidden && bar) this._positionBox(bar);
    }

    /** 다시보기 정보는 한 번만 받는다. 실패하면 다음번에 다시 시도한다. */
    _getInfo() {
        if (!this._infoPromise) {
            this._infoPromise = (async () => {
                const info = await window.VODSync.soopAPI.GetSoopVodInfo(this.videoId);
                if (!info?.data) throw new Error('다시보기 정보를 읽지 못했어요.');
                return info.data;
            })();
            this._infoPromise.catch(() => { this._infoPromise = null; });
        }
        return this._infoPromise;
    }

    /** 종류별 데이터는 한 번만 받는다. 실패하면 다음번에 다시 시도한다. */
    _getData(mode) {
        if (!this._dataCache[mode]) {
            const C = SoopStatGraph.MODES[mode];
            this._dataCache[mode] = (async () => {
                const d = await this._getInfo();
                return window.VODSync.soopAPI.GetSoopVodStat({
                    titleNo: d.title_no ?? this.videoId,
                    stationNo: d.station_no,
                    bbsNo: d.bbs_no,
                    module: C.module,
                    nIdx: C.nIdx,
                });
            })();
            this._dataCache[mode].catch(() => { delete this._dataCache[mode]; });
        }
        return this._dataCache[mode];
    }

    async _load(box, mode) {
        this.log(`데이터 요청: ${SoopStatGraph.MODES[mode].source}`);
        try {
            const stat = await this._getData(mode);
            if (!stat?.cnt) throw new Error('그래프 데이터를 받지 못했어요. (서버 응답에 cnt가 없음)');
            // 받는 사이에 다른 종류로 바뀌었거나 박스가 떼어졌으면 그리지 않는다.
            if (!box.isConnected || this._mode !== mode) {
                this.log(`데이터는 받았지만 그 사이 상태가 바뀌어 그리지 않음 (box연결=${box.isConnected}, 요청당시=${mode}, 지금=${this._mode})`);
                return;
            }
            this._text = stat.text || '%s';
            this._render(box, stat.cnt);
            this.log(`그래프 그림: ${SoopStatGraph.MODES[mode].source} (${stat.cnt.length}개 분)`);
        } catch (e) {
            this.warn(`${SoopStatGraph.MODES[mode].source} 로드 실패:`, e);
            if (box.isConnected) box.remove();
            if (this._box === box) this._box = null;
            // 로드에 실패했는데 버튼·체크 표시만 켜진 채로 남지 않게 끈다.
            if (this._mode === mode) {
                this._mode = null;
                for (const m of Object.keys(SoopStatGraph.MODES)) this._paintButton(m);
            }
        }
    }

    /**
     * 그래프는 canvas로 그린다. SVG 요소는 SOOP 목록의 전역 핸들러가 className을 잘못 읽어 오류를 내기 때문이다.
     */
    _render(box, cnt) {
        this._cnt = cnt;
        const canvas = document.createElement('canvas');
        canvas.className = 'vs-cg-canvas';
        // SOOP의 `#player canvas` 규칙(검은 배경, !important)이 덮어쓰지 않도록 인라인 !important로 맞춘다.
        for (const [k, v] of Object.entries({ position: 'absolute', inset: '0', top: '0', left: '0', right: '0', bottom: '0', width: '100%', height: '100%', 'background-color': 'transparent', padding: '0', margin: '0', 'z-index': 'auto' })) {
            canvas.style.setProperty(k, v, 'important');
        }
        box.innerHTML = '<div class="vs-cg-grip" role="separator" aria-orientation="horizontal" aria-label="그래프 높이 조절"></div>';
        box.appendChild(canvas);
        box.insertAdjacentHTML('beforeend', '<div class="vs-cg-tip" hidden></div><div class="vs-cg-line" hidden></div>'
            + '<div class="vs-cg-toolbar">'
            + '<button type="button" class="vs-cg-opacity-btn" aria-label="그래프 배경 불투명도 조절" title="불투명도">⚙</button>'
            + '<button type="button" class="vs-cg-close" aria-label="그래프 닫기">닫기</button>'
            + '</div>');

        const draw = () => {
            if (!box.isConnected) return;
            const dpr = window.devicePixelRatio || 1;
            const w = box.clientWidth;
            const h = box.clientHeight;
            canvas.width = Math.max(1, Math.round(w * dpr));
            canvas.height = Math.max(1, Math.round(h * dpr));
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);
            const max = Math.max(1, ...cnt.map(([, v]) => v));
            const xOf = (i) => (cnt.length > 1 ? (i / (cnt.length - 1)) * w : 0);
            const yOf = (v) => h - (v / max) * (h - 2);
            ctx.beginPath();
            ctx.moveTo(0, h);
            cnt.forEach(([, v], i) => ctx.lineTo(xOf(i), yOf(v)));
            ctx.lineTo(w, h);
            ctx.closePath();
            ctx.fillStyle = 'rgba(75, 139, 245, 0.22)';
            ctx.fill();
            ctx.beginPath();
            cnt.forEach(([, v], i) => (i ? ctx.lineTo(xOf(i), yOf(v)) : ctx.moveTo(xOf(i), yOf(v))));
            ctx.strokeStyle = '#4b8bf5';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        };
        draw();
        // 높이를 바꾸거나 창 크기가 바뀌면 다시 그린다.
        new ResizeObserver(draw).observe(box);

        // SOOP 재생 바는 누를 때(pointerdown/mousedown) 시점을 옮기므로, 우리 영역에서 일어난 입력은 바 밖으로 내보내지 않는다.
        ['pointerdown', 'mousedown', 'mouseup', 'touchstart', 'click', 'mouseover', 'mouseout', 'mousemove', 'pointerover', 'pointerout']
            .forEach((t) => box.addEventListener(t, (e) => e.stopPropagation()));
        this._wireGrip(box, box.querySelector('.vs-cg-grip'));
        // SOOP 버튼 스타일이 배경을 지우므로 색은 인라인으로 준다. 배경은 그래프와 같은 불투명도를 쓴다(_applyOpacity에서 같이 갱신).
        const toolbar = box.querySelector('.vs-cg-toolbar');
        toolbar.style.cssText = 'position:absolute;right:0;bottom:100%;margin-bottom:4px;z-index:3;display:flex;gap:6px';
        const btnStyle = 'height:22px;padding:0 8px;border:1px solid #8a94a6;border-radius:4px;color:#fff;'
            + 'font:600 12px/20px sans-serif;cursor:pointer';
        const opacityBtn = box.querySelector('.vs-cg-opacity-btn');
        opacityBtn.style.cssText = `${btnStyle}min-width:26px;padding:0;font-size:13px`;
        opacityBtn.style.background = this._backgroundColor();
        opacityBtn.addEventListener('click', () => this._toggleOpacityPopup(opacityBtn));
        const close = box.querySelector('.vs-cg-close');
        close.style.cssText = `${btnStyle}min-width:44px`;
        close.style.background = this._backgroundColor();
        close.addEventListener('click', () => this._setMode(null));
        // 클릭하면 그 분의 시점으로 이동한다.
        canvas.addEventListener('click', (ev) => {
            const r = canvas.getBoundingClientRect();
            const i = SoopStatGraph.clamp(Math.round(((ev.clientX - r.left) / r.width) * (cnt.length - 1)), 0, cnt.length - 1);
            window.VODSync?.tsManager?.moveToPlaybackTime?.(cnt[i][0] * 60, false);
        });
    }

    /** 기본 높이: 영상 높이에 비례한다. 영상 높이 746px일 때 100px. 손잡이로 바꾼 값이 있으면 그 값을 쓴다. */
    _graphHeight() {
        if (this._userHeight) return this._userHeight;
        const video = document.querySelector('#video');
        const vh = video?.clientHeight || SoopStatGraph.REF_VIDEO_H;
        return Math.round((vh * SoopStatGraph.REF_GRAPH_H) / SoopStatGraph.REF_VIDEO_H);
    }

    /** 그래프 윗 가장자리를 끌어 위아래로 높이를 바꾼다. (위로 끌면 커진다) */
    _wireGrip(box, grip) {
        grip.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            const y0 = e.clientY;
            const h0 = box.getBoundingClientRect().height;
            const maxH = Math.round((document.querySelector('#video')?.clientHeight || SoopStatGraph.REF_VIDEO_H) * 0.6);
            const move = (ev) => {
                const h = SoopStatGraph.clamp(h0 + (y0 - ev.clientY), SoopStatGraph.MIN_GRAPH_H, maxH);
                this._userHeight = Math.round(h);
                box.style.height = `${this._userHeight}px`;
            };
            const end = () => {
                grip.removeEventListener('pointermove', move);
                grip.removeEventListener('pointerup', end);
                grip.removeEventListener('pointercancel', end);
            };
            grip.setPointerCapture(e.pointerId);
            grip.addEventListener('pointermove', move);
            grip.addEventListener('pointerup', end);
            grip.addEventListener('pointercancel', end);
        });
    }

    static clamp(v, lo, hi) {
        return Math.min(Math.max(v, lo), hi);
    }

    /** 분 인덱스 → 재생 시간 "H:MM:00". 분 단위 그래프라 초는 0으로 둔다. */
    static formatMinute(minute) {
        const h = Math.floor(minute / 60);
        const m = String(minute % 60).padStart(2, '0');
        return `${h}:${m}:00`;
    }
}
