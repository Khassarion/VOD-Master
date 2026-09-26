// ==UserScript==
// @name         VOD Master (SOOP)
// @namespace    http://tampermonkey.net/
// @version      1.8.0.0
// @description  SOOP 다시보기 타임스탬프 표시 및 다른 스트리머의 다시보기와 동기화
// @author       Khassarion
// @match        https://vod.sooplive.com/*
// @match        https://www.sooplive.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_info
// @run-at       document-end
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // 간소화된 로깅 함수
    function logToExtension(...data) {
        console.debug(`[${new Date().toLocaleString()}]`, ...data);
    }
    function warnToExtension(...data) {
        logToExtension(...data);
    }
    function errorToExtension(...data) {
        logToExtension(...data);
    }
    function debugToExtension(...data) {
        logToExtension(...data);
    }

    // 환경 구분용 전역 변수 (탬퍼몽키 환경)
    window.VODSync = window.VODSync || {};
    window.VODSync.IS_TAMPER_MONKEY_SCRIPT = true;
    const GITHUB_RAW_URL = "https://raw.githubusercontent.com/Khassarion/VOD-Master/main";
    const isIframe = window.top !== window.self;

    // 메인 페이지에서 실행되는 경우 (vod.sooplive.com)
    if (window.location.hostname === 'vod.sooplive.com') {
        class IVodSync {
    constructor(){
        this.vodSyncClassName = this.constructor.name;
        this.debug('constructor() called');
    }
    log(...data){
        logToExtension(`[${this.vodSyncClassName}]`, ...data);
    }
    warn(...data){
        warnToExtension(`[${this.vodSyncClassName}]`, ...data);
    }
    error(...data){
        errorToExtension(`[${this.vodSyncClassName}]`, ...data);
    }
    debug(...data){
        debugToExtension(`[${this.vodSyncClassName}]`, ...data);
    }
}
        /** 요청 캐시 TTL (밀리초). 동일 요청은 이 시간 동안 캐시된 결과 반환 */
const REQUEST_CACHE_TTL_MS = 60 * 1000;

const DEFAULT_SOOP_URLS = {
    VOD_ORIGIN: 'https://vod.sooplive.com',
    WWW_ORIGIN: 'https://www.sooplive.com',
    VEDITOR_ORIGIN: 'https://veditor.sooplive.com',
    STBBS_ORIGIN: 'https://stbbs.sooplive.com',
    AFEVENT2_ORIGIN: 'https://afevent2.sooplive.com',
    LIVE_ORIGIN: 'https://live.sooplive.com',
    API_M_ORIGIN: 'https://api.m.sooplive.com',
    API_CHANNEL_ORIGIN: 'https://api-channel.sooplive.com',
    SCH_ORIGIN: 'https://sch.sooplive.com',
    CHAPI_ORIGIN: 'https://chapi.sooplive.com',
    ST_ORIGIN: 'https://st.sooplive.com',
    RES_ORIGIN: 'https://res.sooplive.com',
    OGQ_STICKER_CDN_ORIGIN: 'https://ogq-sticker-global-cdn-z01.sooplive.com',
    OGQ_MARKET_ORIGIN: 'https://ogqmarket.sooplive.com',
};

class SoopAPI extends IVodSync{
    constructor(){
        super();
        this.SoopUrls = { ...DEFAULT_SOOP_URLS, ...(window.VODSync?.SoopUrls || {}) };
        /** @type {Map<string, { data: any, expiresAt: number }>} */
        this._requestCache = new Map();
        window.VODSync = window.VODSync || {};
        window.VODSync.SoopUrls = this.SoopUrls;
        if (window.VODSync.soopAPI) {
            this.warn('[VODSync] SoopAPI가 이미 존재합니다. 기존 인스턴스를 덮어씁니다.');
        }
        this.log('loaded');
        window.VODSync.soopAPI = this;
    }

    /**
     * @param {string} key 캐시 키
     * @returns {any|null} 캐시된 데이터 또는 null
     */
    _getCached(key) {
        const entry = this._requestCache.get(key);
        if (!entry || Date.now() > entry.expiresAt) return null;
        return entry.data;
    }

    /**
     * @param {string} key 캐시 키
     * @param {any} data 저장할 데이터
     */
    _setCache(key, data) {
        this._requestCache.set(key, { data, expiresAt: Date.now() + REQUEST_CACHE_TTL_MS });
    }

    /**
     * 로그인 사용자 정보 조회(탬퍼몽키 환경에서 loginId 획득용).
     * @returns {Promise<object|null>}
     */
    async GetPrivateInfo() {
        const url = `${this.SoopUrls.AFEVENT2_ORIGIN}/api/get_private_info.php?_=${Date.now()}`;
        const cacheKey = 'GetPrivateInfo';
        const cached = this._getCached(cacheKey);
        if (cached !== null) return cached;
        const res = await fetch(url, {
            headers: {
                accept: 'application/json, text/plain, */*',
            },
            method: 'GET',
            mode: 'cors',
            credentials: 'include',
        });
        if (res.status !== 200) return null;
        const b = await res.json();
        this._setCache(cacheKey, b);
        return b;
    }

    /**
     * 채널 게시판 메뉴 조회.
     * @param {string} loginId
     * @returns {Promise<object|null>}
     */
    async GetStationMenu(loginId) {
        if (!loginId) return null;
        const lid = String(loginId);
        const cacheKey = `GetStationMenu:${lid}`;
        const cached = this._getCached(cacheKey);
        if (cached !== null) return cached;
        const url = `${this.SoopUrls.API_CHANNEL_ORIGIN}/v1.1/channel/${encodeURIComponent(lid)}/menu`;
        const res = await fetch(url, {
            headers: {
                accept: 'application/json, text/plain, */*',
            },
            method: 'GET',
            mode: 'cors',
            credentials: 'include',
        });
        if (res.status !== 200) return null;
        const b = await res.json();
        this._setCache(cacheKey, b);
        return b;
    }

    /**
     * 스트리머 라이브 방송 정보 조회. 방송 중이 아니면 null.
     * @param {string} streamerId 스트리머 userId (예: chebi2)
     * @returns {Promise<object|null>} broadNo·broadTitle 등, 오프라인이면 null
     */
    async GetChannelBroad(streamerId) {
        if (!streamerId) return null;
        const sid = String(streamerId);
        const cacheKey = `GetChannelBroad:${sid}`;
        const cached = this._getCached(cacheKey);
        if (cached !== null) return cached;
        const url = `${this.SoopUrls.API_CHANNEL_ORIGIN}/v1.1/channel/${encodeURIComponent(sid)}/home/section/broad`;
        const res = await fetch(url, {
            headers: {
                accept: 'application/json, text/plain, */*',
            },
            method: 'GET',
            mode: 'cors',
            credentials: 'include',
        });
        if (res.status !== 200) return null;
        const text = await res.text();
        // 오프라인이면 빈 본문
        if (!text || !text.trim()) return null;
        let b;
        try {
            b = JSON.parse(text);
        } catch (_e) {
            return null;
        }
        if (!b || typeof b !== 'object' || b.broadNo == null) return null;
        this._setCache(cacheKey, b);
        return b;
    }

    /**
     * VOD 게시 카테고리 트리 조회.
     * 공식 편집기처럼 페이지에 vod_editor_category.js를 <script>로 로드해 szVodCategory를 읽는다.
     * @returns {Promise<object|null>}
     */
    async GetVodEditorCategory() {
        const cacheKey = 'GetVodEditorCategory:ko_KR';
        const cached = this._getCached(cacheKey);
        if (cached !== null) return cached;
        const parsed = await this._loadSzVodCategoryFromPage();
        if (!parsed || typeof parsed !== 'object') return null;
        this._setCache(cacheKey, parsed);
        return parsed;
    }

    // 페이지 MAIN에 category 스크립트를 넣어 window.szVodCategory를 받는다. (페이지 fetch CORS 회피)
    _loadSzVodCategoryFromPage() {
        const msgType = 'vodSync-vod-editor-category';
        const categoryUrl = `${this.SoopUrls.LIVE_ORIGIN}/script/locale/ko_KR/vod_editor_category.js`;
        const timeoutMs = 20000;

        return new Promise((resolve) => {
            let settled = false;
            const finish = (payload) => {
                if (settled) return;
                settled = true;
                window.removeEventListener('message', onMessage);
                clearTimeout(timer);
                resolve(payload && typeof payload === 'object' ? payload : null);
            };
            const onMessage = (event) => {
                if (event.source !== window) return;
                if (!event.data || event.data.type !== msgType) return;
                finish(event.data.payload);
            };
            window.addEventListener('message', onMessage);
            const timer = setTimeout(() => finish(null), timeoutMs);

            // Tampermonkey: 같은 페이지에 스크립트를 직접 넣고 unsafeWindow에서 읽는다.
            if (window.VODSync?.IS_TAMPER_MONKEY_SCRIPT === true) {
                const s = document.createElement('script');
                s.src = categoryUrl;
                s.onload = () => {
                    try {
                        const w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
                        finish(w.szVodCategory || null);
                    } catch (_e) {
                        finish(null);
                    }
                    s.remove();
                };
                s.onerror = () => finish(null);
                (document.documentElement || document.head || document.body).appendChild(s);
                return;
            }

            // Chrome 확장: CSP 때문에 인라인 스크립트 대신 WAR 로더를 페이지에 주입한다.
            try {
                if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) {
                    finish(null);
                    return;
                }
                const loader = document.createElement('script');
                loader.src = chrome.runtime.getURL('src/module/soop_vod_editor_category_loader.js');
                loader.setAttribute('data-vs-msg-type', msgType);
                loader.setAttribute('data-vs-category-url', categoryUrl);
                loader.onload = () => loader.remove();
                loader.onerror = () => finish(null);
                (document.documentElement || document.head || document.body).appendChild(loader);
            } catch (error) {
                this.warn('카테고리 스크립트 로더 주입 실패:', error);
                finish(null);
            }
        });
    }

    /**
     * @description Get Soop VOD Period
     * @param {number | string} videoId
     * @param {{ referer?: string }} [opts] — `referer` 생략 시 `https://vod.sooplive.com/player/{videoId}`
     * @returns {Promise<object|null>}
     */
    async GetSoopVodInfo(videoId, opts = {}) {
        const referer =
            typeof opts.referer === 'string' && opts.referer.length > 0
                ? opts.referer
                : `${this.SoopUrls.VOD_ORIGIN}/player/${videoId}`;
        const cacheKey = `GetSoopVodInfo:${videoId}`;
        const cached = this._getCached(cacheKey);
        if (cached !== null) return cached;

        const a = await fetch(`${this.SoopUrls.API_M_ORIGIN}/station/video/a/view`, {
            "headers": {
                "accept": "application/json, text/plain, */*",
                "content-type": "application/x-www-form-urlencoded",
                "Referer": referer
            },
            "body": `nTitleNo=${videoId}&nApiLevel=11&nPlaylistIdx=0`,
            "method": "POST",
            "credentials": "include"
        });
        if (a.status !== 200){
            return null;
        }
        const b = await a.json();
        this._setCache(cacheKey, b);
        return b;
    }

    /**
     * stbbs `vodInfo.php?mode=web` VOD 메타 (게시판·언어·다중 파일·총 길이 등).
     * @param {number | string} titleNo — 플레이어 `/player/{titleNo}` 과 동일
     * @param {{ referer?: string }} [opts] — 생략 시 `https://veditor.sooplive.com/web/{titleNo}`
     * @returns {Promise<{ result: number, message?: string, response?: object }|null>}
     */
    async GetSoopVeditorWebVodInfo(titleNo, opts = {}) {
        const tn = String(titleNo);
        const referer =
            typeof opts.referer === 'string' && opts.referer.length > 0
                ? opts.referer
                : `${this.SoopUrls.VEDITOR_ORIGIN || 'https://veditor.sooplive.com'}/web/${tn}`;
        const cacheKey = `GetSoopVeditorWebVodInfo:${tn}`;
        const cached = this._getCached(cacheKey);
        if (cached !== null) return cached;

        const url = new URL(`${this.SoopUrls.STBBS_ORIGIN}/vodeditor/api/vodInfo.php`);
        url.searchParams.set('titleNo', tn);
        url.searchParams.set('mode', 'web');

        const res = await fetch(url.toString(), {
            headers: {
                accept: 'application/json, text/plain, */*',
                Referer: referer,
            },
            method: 'GET',
            credentials: 'include',
            mode: 'cors',
        });
        if (res.status !== 200) {
            return null;
        }
        const b = await res.json();
        this._setCache(cacheKey, b);
        return b;
    }

    async GetStreamerID(nickname){
        const encodedNickname = encodeURI(nickname);
        const url = new URL(`${this.SoopUrls.SCH_ORIGIN}/api.php`);
        url.searchParams.set('m', 'bjSearch');
        url.searchParams.set('v', '3.0');
        url.searchParams.set('szOrder', 'score');
        url.searchParams.set('szKeyword', encodedNickname);
        const cacheKey = `GetStreamerID:${url.toString()}`;
        const cached = this._getCached(cacheKey);
        if (cached !== null) return cached;

        this.log(`GetStreamerID: ${url.toString()}`);
        const res = await fetch(url.toString());
        if (res.status !== 200){
            return null;
        }
        const b = await res.json();
        const userId = b.DATA[0]?.user_id ?? null;
        if (userId !== null) this._setCache(cacheKey, userId);
        return userId;
    }
    /**
     * @description Get Soop VOD List
     * @param {string} streamerId 
     * @param {Date} start_date
     * @param {Date} end_date
     * @returns 
     */
    async GetSoopVOD_List(streamerId, start_date, end_date){
        const start_date_str = start_date.toISOString().slice(0, 10).replace(/-/g, '');
        const end_date_str = end_date.toISOString().slice(0, 10).replace(/-/g, '');
        this.log(`start_date: ${start_date_str}, end_date: ${end_date_str}`);
        const url = new URL(`${this.SoopUrls.CHAPI_ORIGIN}/api/${streamerId}/vods/review`);
        url.searchParams.set("keyword", "");
        url.searchParams.set("orderby", "reg_date");
        url.searchParams.set("page", "1");
        url.searchParams.set("field", "title,contents,user_nick,user_id");
        url.searchParams.set("per_page", "60");
        url.searchParams.set("start_date", start_date_str);
        url.searchParams.set("end_date", end_date_str);
        const cacheKey = `GetSoopVOD_List:${url.toString()}`;
        const cached = this._getCached(cacheKey);
        if (cached !== null) return cached;

        this.log(`GetSoopVOD_List: ${url.toString()}`);
        const res = await fetch(url.toString());
        const b = await res.json();
        this._setCache(cacheKey, b);
        return b;
    }
    /**
     * @description 스트리머의 클립·캐치를 기간으로 검색한다 (통합검색 vodSearch v5.0). 응답 항목의 `org_title_no`가 바로 위 부모(다시보기 또는 클립)의 번호다.
     * 시작 위치(changeSecond)는 응답에 없으므로 필요한 항목만 `GetSoopVodInfo`로 따로 읽는다.
     * 정렬은 최신순만 쓴다(오름차순 없음). 시작일이 종료일보다 늦으면 서버가 에러(result:-1)를 준다.
     * @param {string} streamerId 스트리머 ID (szKeyword + szSearchScope=id)
     * @param {{ fileType?: 'CLIP'|'CATCH', startDate: string, endDate: string, page?: number }} opts 날짜는 YYYY-MM-DD, 양 끝 포함
     * @returns {Promise<{ RESULT: number, TOTAL_CNT: number, HAS_MORE_LIST: boolean, DATA: object[] }|null>} 실패하면 null
     */
    async SearchSoopClips(streamerId, opts = {}) {
        const { fileType = 'CLIP', startDate, endDate, page = 1 } = opts;
        const url = new URL(`${this.SoopUrls.SCH_ORIGIN}/api.php`);
        const params = {
            l: 'DF', m: 'vodSearch', w: 'webk', isMobile: '0', szType: 'json', c: 'UTF-8', v: '5.0',
            szKeyword: streamerId,
            nPageNo: String(page),
            // 캐치 검색은 페이지당 30행만 주므로 30을 넘기면 페이지 사이 행이 누락된다. (soop_clip_map.js SoopClipMap.SEARCH_PAGE_SIZE)
            nListCnt: '30',
            szOrder: 'reg_date',
            szSearchScope: 'id',
            szContentAttr: 'all',
            nIncludeTranslationMatch: '1',
            szFileType: fileType,
            szTerm: 'period_select',
            szStartDate: startDate,
            szEndDate: endDate,
            tab: 'vod', location: 'total_search', isHashSearch: '0',
        };
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
        const cacheKey = `SearchSoopClips:${url.toString()}`;
        const cached = this._getCached(cacheKey);
        if (cached !== null) return cached;

        this.log(`SearchSoopClips: ${fileType} ${startDate}~${endDate} page ${page}`);
        const res = await fetch(url.toString(), {
            headers: { accept: 'application/json, text/plain, */*' },
            method: 'GET',
            mode: 'cors',
            credentials: 'include', // 로그인 상태에서만 보이는 클립(성인 등)까지 포함
        });
        if (res.status !== 200) return null;
        const b = await res.json();
        // 실패 응답은 소문자 result:-1 로 온다. 성공은 RESULT:1 (결과 0건 포함).
        if (!b || b.RESULT !== 1 || !Array.isArray(b.DATA)) return null;
        this._setCache(cacheKey, b);
        return b;
    }
    /**
     * @description playbackTime 구간의 chat 로그 조회. VOD 전체 파일을 chat_duration 단위로 fetch 후 필터링.
     * @param {number | string} vodId
     * @param {number} startTimeSec - 시작 playbackTime (초)
     * @param {number} endTimeSec - 끝 playbackTime (초)
     * @returns {Promise<string|null>} XML 문자열 또는 null
     */
    async GetChatLog(vodId, startTimeSec, endTimeSec){
        const vodInfo = await this.GetSoopVodInfo(vodId);
        if (vodInfo === null){
            this.warn(`GetChatLog: GetSoopVodInfo failed: ${vodId}`);
            return null;
        }
        return this._GetChatLog(vodInfo, startTimeSec, endTimeSec);
    }   
    
    /**
     * @description VOD 전체 파일을 chat_duration 단위로 chat 로그 fetch 후 playbackTime(초) 기준 필터링.
     * GetSoopVodInfo 단위: `files[].duration`(ms), `chat_duration`(초). chat API `startTime`·XML `<t>`는 파일 내 초.
     * chat API chunk 시작점은 파일 내 0부터 chat_duration 간격(0, 300, 600, …)으로만 유효함.
     * @param {Object} vodInfo - VOD 정보
     * @param {number} startTimeSec - 시작 playbackTime (초)
     * @param {number} endTimeSec - 끝 playbackTime (초)
     * @returns {Promise<string|null>} XML 문자열 또는 null
     */
    async _GetChatLog(vodInfo, startTimeSec, endTimeSec){
        if (!vodInfo?.data?.files || vodInfo.data.files.length === 0) {
            this.warn("GetChatLog: files 정보가 없습니다.");
            return null;
        }

        const chatFetchDurationSec = vodInfo.data.chat_duration || 300;
        const chatFetchDurationMs = chatFetchDurationSec * 1000;
        const startTimeMs = startTimeSec * 1000;
        const endTimeMs = endTimeSec * 1000;
        const fetchTasks = [];
        let cumPlaybackMs = 0;

        for (const file of vodInfo.data.files) {
            const fileDurationMs = file.duration > 0 ? file.duration : 0;

            if (file.chat && fileDurationMs > 0 && cumPlaybackMs < endTimeMs) {
                const relativeStartInFileMs = Math.max(0, startTimeMs - cumPlaybackMs);
                const relativeFetchStartBaseMs = Math.floor(relativeStartInFileMs / chatFetchDurationMs) * chatFetchDurationMs;

                for (let relativeFetchStartMs = relativeFetchStartBaseMs; relativeFetchStartMs < fileDurationMs; relativeFetchStartMs += chatFetchDurationMs) {
                    if (cumPlaybackMs + relativeFetchStartMs < endTimeMs) {
                        fetchTasks.push({
                            chatUrl: file.chat,
                            relativeFetchStartSec: relativeFetchStartMs / 1000,
                            fileStartPlaybackSec: Math.floor(cumPlaybackMs / 1000),
                        });
                    }
                }
            }

            cumPlaybackMs += fileDurationMs;
            if (cumPlaybackMs >= endTimeMs) break;
        }

        if (fetchTasks.length === 0) {
            this.warn("GetChatLog: 요청 구간에 해당하는 chat fetch가 없습니다.");
            return null;
        }

        const xmlResults = await Promise.all(
            fetchTasks.map((task) => this._fetchChatLogFromFile(task.chatUrl, task.relativeFetchStartSec))
        );

        let mergedXml = null;
        for (let i = 0; i < fetchTasks.length; i++) {
            const xml = xmlResults[i];
            if (!xml) continue;

            const filtered = this._convertAndFilterChatLogByTimeRange(
                xml, startTimeSec, endTimeSec, fetchTasks[i].fileStartPlaybackSec
            );
            if (!filtered) continue;

            mergedXml = mergedXml ? this._mergeChatLogXml(mergedXml, filtered) : filtered;
        }

        return mergedXml;
    }

    /**
     * @description 특정 파일의 chat URL에서 chat 로그 가져오기
     * @param {string} chatUrl - chat URL
     * @param {number} relativeStartSec - 파일 내 상대 playbackTime (초, chat API startTime 파라미터)
     * @returns {Promise<string|null>} XML 문자열 또는 null
     */
    async _fetchChatLogFromFile(chatUrl, relativeStartSec) {
        try {
            const baseUrl = new URL(chatUrl);
            baseUrl.searchParams.set("startTime", relativeStartSec);
            const url = baseUrl.toString();
            const cacheKey = `_fetchChatLogFromFile:${url}`;
            const cached = this._getCached(cacheKey);
            if (cached !== null) return cached;

            const res = await fetch(url);
            if (res.status !== 200) {
                this.warn(`GetChatLog: HTTP ${res.status} - ${url}`);
                return null;
            }
            
            const xmlText = await res.text();
            this._setCache(cacheKey, xmlText);
            return xmlText;
        } catch (error) {
            this.error("GetChatLog: fetch 오류:", error);
            return null;
        }
    }

    /**
     * @description XML `<t>`(파일 내 초)를 playbackTime(초)으로 변환하고 구간 필터링
     * @param {string} xml - XML 문자열
     * @param {number} startTimeSec - 시작 playbackTime (초)
     * @param {number} endTimeSec - 끝 playbackTime (초)
     * @param {number} fileStartPlaybackSec - 해당 파일의 시작 playbackTime (초)
     * @returns {string} 변환 및 필터링된 XML 문자열
     */
    _convertAndFilterChatLogByTimeRange(xml, startTimeSec, endTimeSec, fileStartPlaybackSec) {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(xml, 'text/xml');

            // 파싱 오류 확인
            const parseError = doc.querySelector('parsererror');
            if (parseError) {
                this.error("GetChatLog: XML 파싱 오류", parseError.textContent);
                return xml; // 원본 반환
            }

            const root = doc.documentElement;
            const chats = root.querySelectorAll('chat, ogq');
            
            // 변환 및 필터링: 각 채팅의 타임스탬프를 playbackTime으로 변환하여 저장하고 범위 확인
            chats.forEach(chat => {
                const tTag = chat.querySelector('t');
                if (!tTag) {
                    // 타임스탬프가 없으면 제거
                    chat.remove();
                    return;
                }

                const relativeTimestampSec = parseFloat(tTag.textContent);
                if (isNaN(relativeTimestampSec)) {
                    // 타임스탬프가 유효하지 않으면 제거
                    chat.remove();
                    return;
                }

                // 파일 내 상대 초 → playbackTime(초)
                const playbackTimeSec = fileStartPlaybackSec + relativeTimestampSec;

                if (playbackTimeSec < startTimeSec || playbackTimeSec > endTimeSec) {
                    chat.remove();
                    return;
                }

                tTag.textContent = playbackTimeSec.toString();
            });

            // XML 문자열로 변환
            const serializer = new XMLSerializer();
            return serializer.serializeToString(doc);
        } catch (error) {
            this.error("GetChatLog: XML 변환 및 필터링 오류:", error);
            // 변환 및 필터링 실패 시 원본 반환
            return xml;
        }
    }

    /**
     * @description 두 XML 문자열을 합치기
     * @param {string} xml1 - 첫 번째 XML
     * @param {string} xml2 - 두 번째 XML
     * @returns {string} 합쳐진 XML
     */
    _mergeChatLogXml(xml1, xml2) {
        try {
            const parser = new DOMParser();
            const doc1 = parser.parseFromString(xml1, 'text/xml');
            const doc2 = parser.parseFromString(xml2, 'text/xml');

            // 파싱 오류 확인
            const parseError1 = doc1.querySelector('parsererror');
            const parseError2 = doc2.querySelector('parsererror');
            if (parseError1 || parseError2) {
                this.error("GetChatLog: XML 파싱 오류", parseError1?.textContent || parseError2?.textContent);
                return xml1; // 첫 번째 XML 반환
            }

            const root1 = doc1.documentElement;
            const root2 = doc2.documentElement;

            // 두 번째 XML의 chat/ogq 태그들을 첫 번째 XML에 추가
            const chats2 = root2.querySelectorAll('chat, ogq');

            chats2.forEach(chat => {
                const importedChat = doc1.importNode(chat, true);
                root1.appendChild(importedChat);
            });

            // XML 문자열로 변환
            const serializer = new XMLSerializer();
            return serializer.serializeToString(doc1);
        } catch (error) {
            this.error("GetChatLog: XML 병합 오류:", error);
            // 병합 실패 시 첫 번째 XML 반환
            return xml1;
        }
    }

    async GetEmoticon(){
        const cacheKey = `GetEmoticon:${this.SoopUrls.ST_ORIGIN}/api/emoticons.php`;
        const cached = this._getCached(cacheKey);
        if (cached !== null) return cached;

        const res = await fetch(`${this.SoopUrls.ST_ORIGIN}/api/emoticons.php`);
        if (res.status !== 200){
            return null;
        }
        const b = await res.json();
        this._setCache(cacheKey, b);
        return b;
    }
    async GetSignitureEmoticon(streamerId){
        const cacheKey = `GetSignitureEmoticon:${streamerId}`;
        const cached = this._getCached(cacheKey);
        if (cached !== null) return cached;

        const res = await fetch(`${this.SoopUrls.LIVE_ORIGIN}/api/signature_emoticon_api.php`, {
            "headers": {
                "accept": "*/*",
                "content-type": "application/x-www-form-urlencoded"
            },
            "body": `work=list&szBjId=${streamerId}&nState=2&v=tier`,
            "method": "POST"
        });
        if (res.status !== 200){
            return null;
        }
        const b = await res.json();
        this._setCache(cacheKey, b);
        return b;
    }

    /**
     * VOD UP 하기. 라이브 중 VOD 시청 알려주기에 사용.
     * @param {object} opts
     * @param {string|number} opts.stationNo
     * @param {string|number} opts.titleNo nPKno
     * @param {string|number} [opts.boardType=105]
     * @param {string} [opts.referer] 생략 시 플레이어 URL
     * @returns {Promise<object|null>}
     */
    async LikeVodTitle(opts = {}) {
        const {
            stationNo,
            titleNo,
            boardType = 105,
            referer: refererOpt,
        } = opts;
        if (stationNo == null || titleNo == null) {
            this.error('LikeVodTitle: stationNo, titleNo 필수');
            return null;
        }
        const tn = String(titleNo);
        const referer =
            typeof refererOpt === 'string' && refererOpt.length > 0
                ? refererOpt
                : `${this.SoopUrls.VOD_ORIGIN}/player/${tn}`;
        const url = new URL(`${this.SoopUrls.STBBS_ORIGIN}/api/like_action.php`);
        url.searchParams.set('szType', 'addTitle');
        url.searchParams.set('nStationNo', String(stationNo));
        url.searchParams.set('nPKno', tn);
        url.searchParams.set('nBoardType', String(boardType));

        const res = await fetch(url.toString(), {
            headers: {
                accept: 'application/json, text/plain, */*',
                Referer: referer,
            },
            method: 'GET',
            mode: 'cors',
            credentials: 'include',
        });
        if (res.status !== 200) {
            this.error('LikeVodTitle HTTP', res.status);
            return null;
        }
        let b;
        try {
            b = await res.json();
        } catch (_e) {
            this.warn('LikeVodTitle: JSON 파싱 실패');
            return null;
        }
        // result/RESULT === 1(또는 true)만 성공으로 본다.
        const likeOk = b && typeof b === 'object'
            && [b.result, b.RESULT, b.CHANNEL?.RESULT, b.CHANNEL?.result]
                .some((v) => v === 1 || v === true || String(v) === '1');
        if (!likeOk) {
            this.warn('LikeVodTitle 실패 응답:', b);
            return null;
        }
        return b;
    }

    /**
     * VOD 댓글 등록 (클립·캐치·편집·업로드 등). 라이브 중 VOD 시청 알려주기에 사용.
     * @param {object} opts
     * @param {string|number} opts.stationNo
     * @param {string|number} opts.bbsNo
     * @param {string|number} opts.titleNo
     * @param {string} opts.bjId
     * @param {string} opts.content 댓글 본문
     * @param {string} opts.fileType CLIP|CATCH|EDITOR|NORMAL|REVIEW 등
     * @param {string|number} [opts.boardType=105]
     * @param {string|number} [opts.parentCommentNo=0]
     * @param {string|number} [opts.commentPhotoType=1]
     * @param {string} [opts.commentPhoto='']
     * @param {string} [opts.referer] 생략 시 플레이어 URL
     * @returns {Promise<object|null>}
     */
    async WriteVodComment(opts = {}) {
        const {
            stationNo,
            bbsNo,
            titleNo,
            bjId,
            content,
            fileType,
            boardType = 105,
            parentCommentNo = 0,
            commentPhotoType = 1,
            commentPhoto = '',
            referer: refererOpt,
        } = opts;
        if (stationNo == null || bbsNo == null || titleNo == null || !bjId || !fileType) {
            this.error('WriteVodComment: stationNo, bbsNo, titleNo, bjId, fileType 필수');
            return null;
        }
        if (typeof content !== 'string' || !content.trim()) {
            this.error('WriteVodComment: content 필수');
            return null;
        }
        const tn = String(titleNo);
        const referer =
            typeof refererOpt === 'string' && refererOpt.length > 0
                ? refererOpt
                : `${this.SoopUrls.VOD_ORIGIN}/player/${tn}`;
        const body = new URLSearchParams({
            nStationNo: String(stationNo),
            nBbsNo: String(bbsNo),
            nTitleNo: tn,
            bj_id: String(bjId),
            nBoardType: String(boardType),
            szContent: content,
            szAction: 'write',
            nParentCommentNo: String(parentCommentNo),
            nCommentPhotoType: String(commentPhotoType),
            szCommentPhoto: String(commentPhoto ?? ''),
            szFileType: String(fileType),
        });
        const res = await fetch(`${this.SoopUrls.STBBS_ORIGIN}/api/bbs_memo_action.php`, {
            headers: {
                accept: 'application/json, text/plain, */*',
                'content-type': 'application/x-www-form-urlencoded',
                Referer: referer,
            },
            body: body.toString(),
            method: 'POST',
            mode: 'cors',
            credentials: 'include',
        });
        if (res.status !== 200) {
            this.error('WriteVodComment HTTP', res.status);
            return null;
        }
        let b;
        try {
            b = await res.json();
        } catch (_e) {
            this.warn('WriteVodComment: JSON 파싱 실패');
            return null;
        }
        // result/RESULT === 1(또는 true)만 성공으로 본다.
        const commentOk = b && typeof b === 'object'
            && [b.result, b.RESULT, b.CHANNEL?.RESULT, b.CHANNEL?.result]
                .some((v) => v === 1 || v === true || String(v) === '1');
        if (!commentOk) {
            this.warn('WriteVodComment 실패 응답:', b);
            return null;
        }
        return b;
    }

    /**
     * VOD 댓글 목록 조회 (bbs_memo_action szAction=get).
     * stationNo/bbsNo/bjId가 없으면 GetSoopVodInfo로 채운다.
     * @param {string|number} videoId titleNo
     * @param {string} [streamerId] bj_id (생략 시 VOD 정보의 bj_id 사용)
     * @param {object} [opts]
     * @param {string|number} [opts.stationNo]
     * @param {string|number} [opts.bbsNo]
     * @param {string|number} [opts.boardType]
     * @param {number} [opts.pageNo=1]
     * @param {number} [opts.orderNo=1] 1: 등록순 등으로 추정
     * @param {number} [opts.lastNo=0] 페이지네이션 커서
     * @param {string|number} [opts.changeSecond] Referer용 재생 시점
     * @returns {Promise<object|null>}
     */
    async GetSoopCommentInVod(videoId, streamerId, opts = {}) {
        const {
            stationNo,
            bbsNo,
            boardType,
            pageNo = 1,
            orderNo = 1,
            lastNo = 0,
            changeSecond,
        } = opts;

        let resolvedStationNo = stationNo;
        let resolvedBbsNo = bbsNo;
        let resolvedBjId = streamerId;
        let resolvedBoardType = boardType ?? 105;

        if (resolvedStationNo == null || resolvedBbsNo == null || !resolvedBjId) {
            const vodInfo = await this.GetSoopVodInfo(videoId);
            const data = vodInfo?.data;
            if (!data || vodInfo?.result !== 1) {
                this.error('GetSoopCommentInVod: VOD 정보 조회 실패', videoId, data?.message || vodInfo?.message);
                return null;
            }
            resolvedStationNo = resolvedStationNo ?? data.station_no;
            resolvedBbsNo = resolvedBbsNo ?? data.bbs_no;
            resolvedBjId = resolvedBjId || data.bj_id;
            if (boardType == null && data.board_type != null) {
                resolvedBoardType = data.board_type;
            }
        }

        if (resolvedStationNo == null || resolvedBbsNo == null || !resolvedBjId) {
            this.error('GetSoopCommentInVod: stationNo/bbsNo/bj_id 부족', {
                videoId,
                resolvedStationNo,
                resolvedBbsNo,
                resolvedBjId,
            });
            return null;
        }

        const tn = String(videoId);
        const referer = changeSecond != null && changeSecond !== ''
            ? `${this.SoopUrls.VOD_ORIGIN}/player/${tn}?change_second=${changeSecond}`
            : `${this.SoopUrls.VOD_ORIGIN}/player/${tn}`;
        const body = new URLSearchParams({
            nStationNo: String(resolvedStationNo),
            nBbsNo: String(resolvedBbsNo),
            nTitleNo: tn,
            bj_id: String(resolvedBjId),
            nPageNo: String(pageNo),
            nOrderNo: String(orderNo),
            nBoardType: String(resolvedBoardType),
            szAction: 'get',
            nVod: '1',
            nLastNo: String(lastNo),
        });

        const res = await fetch(`${this.SoopUrls.STBBS_ORIGIN}/api/bbs_memo_action.php`, {
            headers: {
                accept: 'application/json, text/plain, */*',
                'accept-language': 'ko',
                'content-type': 'application/x-www-form-urlencoded',
                Referer: referer,
            },
            body: body.toString(),
            method: 'POST',
            mode: 'cors',
            credentials: 'include',
        });
        if (res.status !== 200) {
            this.error('GetSoopCommentInVod HTTP', res.status);
            return null;
        }
        try {
            return await res.json();
        } catch (_e) {
            this.warn('GetSoopCommentInVod: JSON 파싱 실패');
            return null;
        }
    }

    /**
     * VOD 부모 댓글 전체를 페이지네이션으로 모아 반환. (대댓글 본문은 포함되지 않음)
     * @param {string|number} videoId titleNo
     * @returns {Promise<object[]|null>} list_data 항목 배열. 실패 시 null
     */
    async GetSoopParentCommentsInVod(videoId) {
        if (videoId == null || videoId === '') {
            this.error('GetSoopParentCommentsInVod: videoId 필수');
            return null;
        }

        const vodInfo = await this.GetSoopVodInfo(videoId);
        const data = vodInfo?.data;
        if (!data || vodInfo?.result !== 1) {
            this.error(
                'GetSoopParentCommentsInVod: VOD 정보 조회 실패',
                videoId,
                data?.message || vodInfo?.message
            );
            return null;
        }

        const stationNo = data.station_no;
        const bbsNo = data.bbs_no;
        const bjId = data.bj_id;
        const boardType = data.board_type ?? 105;
        if (stationNo == null || bbsNo == null || !bjId) {
            this.error('GetSoopParentCommentsInVod: stationNo/bbsNo/bj_id 부족', {
                videoId,
                stationNo,
                bbsNo,
                bjId,
            });
            return null;
        }

        const all = [];
        let pageNo = 1;
        let lastNo = 0;
        const maxPages = 100;

        for (let i = 0; i < maxPages; i++) {
            const page = await this.GetSoopCommentInVod(videoId, bjId, {
                stationNo,
                bbsNo,
                boardType,
                pageNo,
                lastNo,
            });
            const channel = page?.CHANNEL;
            const pageOk = channel
                && [channel.RESULT, channel.result]
                    .some((v) => v === 1 || v === true || String(v) === '1');
            if (!pageOk) {
                if (i === 0) {
                    this.error('GetSoopParentCommentsInVod: 댓글 조회 실패', videoId);
                    return null;
                }
                this.warn('GetSoopParentCommentsInVod: 중간 페이지 실패, 수집분 반환', videoId, pageNo);
                break;
            }

            const list = Array.isArray(channel.DATA?.list_data) ? channel.DATA.list_data : [];
            all.push(...list);

            if (channel.DATA?.has_more !== true || list.length === 0) {
                break;
            }

            const nextLast = Number(list[list.length - 1]?.p_comment_no);
            if (!Number.isFinite(nextLast) || nextLast === lastNo) {
                break;
            }
            lastNo = nextLast;
            pageNo += 1;
        }

        return all;
    }

    /**
     * 다시보기 편집 VOD 생성 (setWebEditorJob).
     * @param {object} [opts]
     * @param {string} [opts.titleNo]
     * @param {string} [opts.broadNo]
     * @param {string} [opts.bbsNo]
     * @param {string} [opts.category]
     * @param {string} [opts.vodCategory]
     * @param {string} [opts.title]
     * @param {string} [opts.contents]
     * @param {string} [opts.hotissue]
     * @param {string} [opts.strmLangType]
     * @param {string|number} [opts.editType]
     * @param {Array} [opts.editJobInfo] edit_job_info 배열
     * @param {string} [opts.referer] HTTP Referer (생략 시 VOD 플레이어 페이지)
     * @returns {Promise<object|null>}
     */
    async SetWebEditorJob(opts = {}) {
        const {
            titleNo,
            broadNo,
            bbsNo,
            referer: refererOpt,
            category = '00210000',
            vodCategory = '00820000',
            title = '',
            contents = '',
            hotissue = 'N',
            strmLangType = 'ko_KR',
            editType = '1',
            editJobInfo = [],
        } = opts;
        const referer =
            typeof refererOpt === 'string' && refererOpt.length > 0
                ? refererOpt
                : `${this.SoopUrls.VOD_ORIGIN}/player/${String(titleNo)}`;
        if (!titleNo || !broadNo || !bbsNo) {
            this.error('SetWebEditorJob: titleNo, broadNo, bbsNo 필수');
            return null;
        }

        const form = new FormData();
        form.append('edit_job_info', JSON.stringify(editJobInfo));
        form.append('edit_type', String(editType));
        form.append('title_no', String(titleNo));
        form.append('broad_no', String(broadNo));
        form.append('bbsNo', String(bbsNo));
        form.append('category', category);
        form.append('vod_category', vodCategory);
        form.append('title', title);
        form.append('contents', contents);
        form.append('hotissue', hotissue);
        form.append('strmLangType', strmLangType);

        const debugFormEntries = [];
        for (const [k, v] of form.entries()) {
            debugFormEntries.push([k, typeof v === 'string' ? v : '[binary]']);
        }
        const debugPayload = {
            url: `${this.SoopUrls.STBBS_ORIGIN}/vodeditor/api/setWebEditorJob.php`,
            method: 'POST',
            credentials: 'include',
            headers: {
                Accept: 'application/json, text/plain, */*',
                Referer: referer,
            },
            formData: debugFormEntries,
        };
        console.debug('[VODSync][SetWebEditorJob] request preview', debugPayload);
        if (false) {
            this.warn('SetWebEditorJob: debug-only 모드로 실제 전송하지 않았습니다.');
            return {
                debugOnly: true,
                ...debugPayload,
            };
        }

        const res = await fetch(`${this.SoopUrls.STBBS_ORIGIN}/vodeditor/api/setWebEditorJob.php`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                Accept: 'application/json, text/plain, */*',
                Referer: referer,
            },
            body: form,
        });
        if (res.status !== 200) {
            this.error('SetWebEditorJob HTTP', res.status);
            return null;
        }
        return res.json();
    }
}
        class TimestampManagerBase extends IVodSync {
    constructor() {
        super();
        this.videoTag = null;
        this.timeStampDiv = null;
        this.isEditing = false;
        this.request_vod_ts = null;
        this.request_real_ts = null;
        this.isControllableState = false;
        this.lastMouseMoveTime = Date.now();
        this.isVisible = true;
        this.isHideCompletly = false; // 툴팁 숨기기 상태
        
        // VODSync 네임스페이스에 자동 등록
        window.VODSync = window.VODSync || {};
        if (window.VODSync.tsManager) {
            this.warn('[VODSync] TimestampManager가 이미 존재합니다. 기존 인스턴스를 덮어씁니다.');
        }
        window.VODSync.tsManager = this;
        
        this.createTooltip();
        this.observeDOMChanges();
        this.setupMouseTracking();
        this.listenBroadcastSyncEvent();
        setInterval(() => {
            this.update();
        }, 200);
    }
    createTooltip() {
        if (!this.tooltipContainer) {
            // 툴팁을 담는 컨테이너 생성
            this.tooltipContainer = document.createElement("div");
            this.tooltipContainer.style.position = "fixed";
            this.tooltipContainer.style.bottom = "20px";
            this.tooltipContainer.style.right = "20px";
            this.tooltipContainer.style.display = "flex";
            this.tooltipContainer.style.alignItems = "center";
            this.tooltipContainer.style.gap = "5px";
            this.tooltipContainer.style.zIndex = "1000";
            
            // Sync 버튼 생성
            this.syncButton = document.createElement("button");
            this.syncButton.title = "열려있는 다른 vod를 이 시간대로 동기화";
            this.syncButton.style.background = "none";
            this.syncButton.style.border = "none";
            this.syncButton.style.cursor = "pointer";
            this.syncButton.style.width = "32px";
            this.syncButton.style.height = "32px";
            this.syncButton.style.padding = "0";
            this.syncButton.style.opacity = "1";
            this.syncButton.style.borderRadius = "8px";
            this.syncButton.style.overflow = "hidden";
            
            // 아이콘 이미지 추가
            const iconImage = document.createElement("img");
            if (window.VODSync?.IS_TAMPER_MONKEY_SCRIPT !== true){
                iconImage.src = chrome.runtime.getURL("res/img/broadcastSync.png");
            }
            else{
                iconImage.src = "https://raw.githubusercontent.com/Khassarion/VOD-Master/main/res/img/broadcastSync.png";
            }
            iconImage.style.width = "100%";
            iconImage.style.height = "100%";
            iconImage.style.objectFit = "fill";
            iconImage.style.borderRadius = "8px";
            this.syncButton.appendChild(iconImage);            
            this.syncButton.addEventListener('click', this.handleBroadcastSyncButtonClick.bind(this));
            
            // 툴팁 div 생성
            this.timeStampDiv = document.createElement("div");
            this.timeStampDiv.style.background = "black";
            this.timeStampDiv.style.color = "white";
            this.timeStampDiv.style.padding = "8px 12px";
            this.timeStampDiv.style.borderRadius = "5px";
            this.timeStampDiv.style.fontSize = "14px";
            this.timeStampDiv.style.whiteSpace = "nowrap";
            this.timeStampDiv.style.display = "block";
            this.timeStampDiv.style.opacity = "1";
            this.timeStampDiv.contentEditable = "false";
            this.timeStampDiv.title = "더블클릭하여 수정, 수정 후 Enter 키 누르면 적용";
            
            // 컨테이너에 버튼과 툴팁 추가
            this.tooltipContainer.appendChild(this.syncButton);
            this.tooltipContainer.appendChild(this.timeStampDiv);
            document.body.appendChild(this.tooltipContainer);

            this.timeStampDiv.addEventListener("dblclick", () => {
                this.timeStampDiv.contentEditable = "true";
                this.timeStampDiv.focus();
                this.isEditing = true;
                this.timeStampDiv.style.outline = "2px solid red"; 
                this.timeStampDiv.style.boxShadow = "0 0 10px red";
                // 편집 중일 때는 투명화 방지
                this.showTooltip();
            });
            this.timeStampDiv.addEventListener("mouseup", (event) => {
                event.stopPropagation(); // 치지직의 경우 다른 요소의 이 이벤트가 blur를 호출하게하므로 차단
            });

            this.timeStampDiv.addEventListener("blur", () => {
                this.timeStampDiv.contentEditable = "false";
                this.isEditing = false;
                this.timeStampDiv.style.outline = "none";
                this.timeStampDiv.style.boxShadow = "none";
            });

            this.timeStampDiv.addEventListener("keydown", (event) => {
                // 편집 모드일 때만 이벤트 차단
                if (this.isEditing) {
                    // 숫자 키 (0-9) - 영상 점프 기능만 차단하고 텍스트 입력은 허용
                    if (/^[0-9]$/.test(event.key)) {
                        // 영상 플레이어의 키보드 이벤트만 차단
                        event.stopPropagation();
                        return;
                    }

                    // 방향키 - 영상 앞으로/뒤로 이동 기능 차단
                    if (event.key === "ArrowUp" || event.key === "ArrowDown" || 
                        event.key === "ArrowLeft" || event.key === "ArrowRight") {
                        event.stopPropagation();
                        return;
                    }
                }

                // Enter 키 처리
                if (event.key === "Enter") {
                    event.preventDefault();
                    this.processTimestampInput(this.timeStampDiv.innerText.trim());
                    this.timeStampDiv.contentEditable = "false";
                    this.timeStampDiv.blur();
                    this.isEditing = false;
                    return;
                }
            });

            // 복사 이벤트 처리 - 텍스트만 복사되도록
            this.timeStampDiv.addEventListener("copy", (event) => {
                const selectedText = window.getSelection().toString();
                if (selectedText) {
                    event.clipboardData.setData("text/plain", selectedText);
                    event.preventDefault();
                }
            });
        }
    }
    update(){
        if (!this.tooltipContainer){
            this.log('timestamp 컨테이너가 없어 재생성합니다');
            this.createTooltip();
        }
        this.updateTooltip();
        this.checkMouseState();
        if (this.tooltipContainer.parentElement === document.body || !this.tooltipContainer.isConnected){
            this.debug('timestamp 컨테이너가 분리되어 재배치합니다');
            if (this.moveTooltipToCtrlBox())
                this.debug('timestamp 컨테이너 재배치 성공');
            else
                this.debug('timestamp 컨테이너 재배치 실패');
        }
        
    }

    // request_real_ts 가 null이면 request_vod_ts로 동기화하고 null이 아니면 동기화시도하는 시점과 request_real_ts와의 차이를 request_vod_ts와 더하여 동기화합니다.
    // 즉, 페이지가 로딩되는 동안의 시차를 적용할지 안할지 결정합니다.
    RequestGlobalTSAsync(request_vod_ts, request_real_ts = null){
        this.request_vod_ts = request_vod_ts;
        this.request_real_ts = request_real_ts;
    }

    RequestLocalTSAsync(request_local_ts){
        this.request_local_ts = request_local_ts;
    }

    listenBroadcastSyncEvent() {
        if (window.VODSync?.IS_TAMPER_MONKEY_SCRIPT !== true){
            chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
                if (message.action === 'broadCastSync') {
                    this.moveToGlobalTS(message.request_vod_ts, false);
                    sendResponse({ success: true });
                }
                return true;
            });
        }
        else{
            this.channel = new BroadcastChannel('vod-master');
            this.channel.onmessage = (event) => {
                if (event.data.action === 'broadCastSync') {
                    this.moveToGlobalTS(event.data.request_vod_ts, false);
                }
            }
        }
    }

    setupMouseTracking() {
        // 마우스 움직임 감지 - 시간만 업데이트
        document.addEventListener('mousemove', () => {
            if (this.isHideCompletly) return;
            this.lastMouseMoveTime = Date.now();
            this.showTooltip();
        });

        // 마우스가 페이지 밖으로 나갈 때 툴팁 숨기기
        document.addEventListener('mouseleave', () => {
            this.hideTooltip();
        });
    }

    showTooltip() {
        if (this.timeStampDiv) {
            this.timeStampDiv.style.transition = 'opacity 0.3s ease-in-out';
            this.timeStampDiv.style.opacity = '1';
            this.isVisible = true;
        }
        if (this.syncButton) {
            this.syncButton.style.transition = 'opacity 0.3s ease-in-out';
            this.syncButton.style.opacity = '1';
        }
    }

    hideTooltip() {
        if (this.timeStampDiv && !this.isEditing) {
            this.timeStampDiv.style.transition = 'opacity 0.5s ease-in-out';
            this.timeStampDiv.style.opacity = '0';
            this.isVisible = false;
        }
        if (this.syncButton) {
            this.syncButton.style.transition = 'opacity 0.5s ease-in-out';
            this.syncButton.style.opacity = '0';
        }
    }

    handleBroadcastSyncButtonClick(e) {
        const request_vod_ts = this.getCurDateTime();
        if (!request_vod_ts) {
            this.warn("현재 재생 중인 VOD의 라이브 당시 시간을 가져올 수 없습니다. 전역 동기화 실패.");
            return;
        }
        e.stopPropagation();

        if (window.VODSync?.IS_TAMPER_MONKEY_SCRIPT !== true){
            try{
                chrome.runtime.sendMessage({action: 'broadCastSync', request_vod_ts: request_vod_ts.getTime()});
            } catch (error) {
                console.warn('[VOD Master] 전역 동기화 요청 실패. 확장프로그램이 리로드되었거나 비활성화된 것 같습니다. 페이지를 새로고침하십시오.', error);
            }
        }
        else{
            this.channel.postMessage({action: 'broadCastSync', request_vod_ts: request_vod_ts.getTime()});
        }
    }
    updateTooltip() {
        if (!this.timeStampDiv || this.isEditing) return;
        
        const dateTime = this.getCurDateTime();
        
        if (dateTime) {
            this.isControllableState = true;
            this.timeStampDiv.innerText = dateTime.toLocaleString("ko-KR");
        }
        if (this.isPlaying() === true)
        { 
            // 전역 시간 동기화 요청 체크
            if (this.request_vod_ts != null){
                const streamPeriod = this.getStreamPeriod();
                if (streamPeriod){
                    if (this.request_real_ts == null){
                        this.log("시차 적용하지않고 동기화 시도");
                        if (!this.moveToGlobalTS(this.request_vod_ts, false)){
                            window.close();
                        }
                    }
                    else{
                        const currentSystemTime = Date.now();
                        const timeDifference = currentSystemTime - this.request_real_ts;
                        this.log("시차 적용하여 동기화 시도. 시차: " + timeDifference);
                        const adjustedGlobalTS = this.request_vod_ts + timeDifference; 
                        if (!this.moveToGlobalTS(adjustedGlobalTS, false)){
                            window.close();
                        }
                    }
                    this.request_vod_ts = null;
                    this.request_real_ts = null;
                }
            }
            // 로컬 시간 동기화 요청 체크
            if (this.request_local_ts != null){
                this.log("playback time으로 동기화 시도");
                if (!this.moveToPlaybackTime(this.request_local_ts, false)){
                    this.log('동기화 실패. 창을 닫습니다.');
                    window.close();
                }
                this.request_local_ts = null;
            }
        }
    }

    checkMouseState(){
        if (this.isHideCompletly) return;
        const currentTime = Date.now();
        const timeSinceLastMove = currentTime - this.lastMouseMoveTime;
        
        // 2초 이상 마우스가 움직이지 않았고, 편집 중이 아니면 툴팁 숨기기
        if (timeSinceLastMove >= 2000 && !this.isEditing && this.isVisible) {
            this.hideTooltip();
        }
    }
    // 활성화/비활성화 메서드
    enable() {
        this.isHideCompletly = false;
        if (this.tooltipContainer) {
            this.tooltipContainer.style.display = 'flex';
        }
        this.log('툴팁 나타남');
    }

    disable() {
        this.isHideCompletly = true;
        if (this.tooltipContainer) {
            this.tooltipContainer.style.display = 'none';
        }
        this.log('툴팁 숨김');
    }

    processTimestampInput(input) {
        const match = input.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(오전|오후)\s*(\d{1,2}):(\d{2}):(\d{2})/);
        
        if (!match) {
            alert("유효한 타임스탬프 형식을 입력하세요. (예: 2024. 10. 22. 오전 5:52:55)");
            return;
        }
    
        let [_, year, month, day, period, hour, minute, second] = match;
        year = parseInt(year);
        month = parseInt(month) - 1; // JavaScript의 Date는 0부터 시작하는 월을 사용
        day = parseInt(day);
        hour = parseInt(hour);
        minute = parseInt(minute);
        second = parseInt(second);
    
        // 오전/오후 변환
        if (period === "오후" && hour !== 12) {
            hour += 12;
        } else if (period === "오전" && hour === 12) {
            hour = 0;
        }
    
        const globalDateTime = new Date(year, month, day, hour, minute, second);
        
        if (isNaN(globalDateTime.getTime())) {
            alert("유효한 날짜로 변환할 수 없습니다.");
            return;
        }
    
        this.moveToGlobalTS(globalDateTime.getTime());
    }

    /**
     * @description 전역 시간으로 영상 시간 맞춤
     * @param {number} globalTS
     * @param {boolean} doAlert 
     * @returns 
     */
    moveToGlobalTS(globalTS, doAlert = true) {
        const streamPeriod = this.getStreamPeriod();
        if (!streamPeriod) {
            if (doAlert) {
                alert("VOD 정보를 가져올 수 없습니다.");
            }
            return false;
        }
        
        const [streamStartDateTime, streamEndDateTime] = streamPeriod;
        const globalDateTime = new Date(parseInt(globalTS));

        if (streamStartDateTime > globalDateTime || globalDateTime > streamEndDateTime) {
            if (doAlert) {
                alert("입력한 타임스탬프가 방송 기간 밖입니다.");
            }
            return false;
        }
        
        const playbackTime = Math.floor((globalDateTime.getTime() - streamStartDateTime.getTime()) / 1000);
        return this.moveToPlaybackTime(playbackTime, doAlert);
    }

    // 플랫폼별로 구현해야 하는 추상 메서드들
    observeDOMChanges() {
        throw new Error("observeDOMChanges must be implemented by subclass");
    }
    getCurDateTime() {
        throw new Error("getCurDateTime must be implemented by subclass");
    }
    getStreamPeriod() {
        throw new Error("getStreamPeriod must be implemented by subclass");
    }
    /**
     * @description 재생 시점(초)을 전역 시각(global time)으로 변환. 파생 클래스에서 구현.
     * @param {number} totalPlaybackSec VOD 재생 시점(초)
     * @returns {Date|null} 전역 시각 또는 변환 불가 시 null
     */
    playbackTimeToGlobalTS(totalPlaybackSec) {
        throw new Error("playbackTimeToGlobalTS must be implemented by subclass");
    }
    // 현재 재생 중인지 여부를 반환하는 추상 메서드
    isPlaying() {
        throw new Error("isPlaying must be implemented by subclass");
    }
    /**
     * 전역 타임스탬프(ms) → 재생 시각(초) 변환이 가능한지 여부.
     * 타임라인 동기화 미리보기 등에서 변환 준비가 됐을 때만 사용. 서브클래스에서 오버라이드.
     * @returns {boolean}
     */
    canConvertGlobalTSToPlaybackTime() {
        throw new Error("canConvertGlobalTSToPlaybackTime must be implemented by subclass");
    }
    /**
     * @description 영상 시간을 설정
     * @param {number} playbackTime 
     * @param {boolean} doAlert 
     */
    moveToPlaybackTime(playbackTime, doAlert = true) {
        throw new Error("moveToPlaybackTime must be implemented by subclass");
    }
    moveTooltipToCtrlBox(){
        throw new Error("moveTooltipToCtrlBox must be implemented by subclass");
    }
}
        // TamperMonkey 환경은 페이지와 같은 월드이므로 실제 vodCore를 그대로 반환한다.
        window.VODSync.getVodCore = () => {
            if (typeof unsafeWindow === 'undefined') return null;
            const vc = unsafeWindow.vodCore;
            return vc && typeof vc === 'object' ? vc : null;
        };
        const MAX_DURATION_DIFF = 30*1000;
        class SoopTimestampManager extends TimestampManagerBase {
    constructor() {
        super();
        this.vodInfo = null;
        this.playTimeTag = null;
        this.isEditedVod = false; // 다시보기의 일부분이 편집된 상태인가
        
        this.timeLink = null;
        /** @type {ReturnType<typeof setInterval>|null} ghost 없을 때 time_link 폴백용 */
        this._timeLinkJumpIntervalId = null;
        this.debug('loaded');

        this.reloadingAll = false; // 현재 VOD 정보와 태그를 업데이트 중인가
        this.loop_playing = false;
    }

    /**
     * vodCore 페이지 브리지 ghost (`#__vs_vodcore_ghost`). 브리지 미주입 시 null.
     * @returns {HTMLElement|null}
     */
    _getVodCoreGhost() {
        return window.VODSync?.vodCoreBridge?.getGhost?.() ?? null;
    }

    update(){
        super.update();
        this.simpleLoopSettingUpdate();

        // VOD 변경 감지
        const url = new URL(window.location.href);
        const match = url.pathname.match(/\/player\/(\d+)/);
        if (!match || match.length < 2)
        {
            this.warn('VOD ID를 가져오지 못했습니다. URL 파싱 실패 (' + url.pathname + ')');
            return;
        }
        const curVideoId = match[1];
        if (this.vodInfo === null || curVideoId !== this.vodInfo.id){
            this.log('VOD 변경 감지됨! 요소 업데이트 중...');
            this.reloadAll(curVideoId);
        }
    }
    
    moveTooltipToCtrlBox(){
        const ctrlBox = document.querySelector('.ctrlBox');
        const rightCtrl = document.querySelector('.right_ctrl');
        if (ctrlBox && rightCtrl && this.tooltipContainer) { 
            ctrlBox.insertBefore(this.tooltipContainer, rightCtrl);
            this.tooltipContainer.style.position = '';
            this.tooltipContainer.style.bottom = '';
            this.tooltipContainer.style.right = '';
            return true;
        }
        return false;
    }

    simpleLoopSettingUpdate(){
        const LABEL_TEXT = '반복 재생';
        const EM_TEXT_IDLE = '(added by VOD Master)';

        // 반복재생 설정이 켜져있고 비디오 태그를 찾은 경우
        if (this.videoTag !== null && this.loop_playing){
            // 현재 재생 시간이 영상 전체 재생 시간과 같은 경우 처음으로 이동
            if (this.getCurPlaybackTime() === Math.floor(this.vodInfo.total_file_duration / 1000)){
                this.moveToPlaybackTime(0);
                // 비디오 태그가 일시정지 상태인 경우 재생
                if (this.videoTag.paused){
                    this.videoTag.play();
                }
            }
        }

        //반복 재생 설정 메뉴 추가 로직
        const settingList = document.querySelector('.setting_list');
        if (!settingList) return; // 설정 창을 열지 않음.
        if (settingList.classList.contains('subLayer_on')) return; // 서브 레이어가 열려있으면 추가하지 않음.
        const ul = settingList.childNodes[0];
        const _exists = ul.querySelector('#VODSync');
        if (_exists) return; // 이미 추가되어 있음.
        
        const li = document.createElement('li');
        li.className = 'switchBtn_wrap loop_playing';
        li.id = 'VODSync';
        const label = document.createElement('label');
        label.for = 'loop_playing';
        label.innerText = LABEL_TEXT;
        const em = document.createElement('em');
        em.innerText = EM_TEXT_IDLE;
        em.style.color = '#c7cad1';
        // em.style.fontSize = '12px';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = 'loop_playing';
        input.checked = this.loop_playing;
        input.addEventListener('change',()=> {
            const a = document.querySelector('#VODSync input');
            this.loop_playing = a.checked;
            if (this.loop_playing){
                const autoPlayInput = document.querySelector('#autoplayChk');
                if (autoPlayInput && autoPlayInput.checked){
                    autoPlayInput.click();
                }
            }
            this.debug('loop_playing: ', this.loop_playing);
        });
        const span = document.createElement('span');
        label.appendChild(em);
        label.appendChild(input);
        label.appendChild(span);
        li.appendChild(label);
        ul.appendChild(li);
        
    }

    async loadVodInfo(videoId){
        const vodInfo = await window.VODSync.soopAPI.GetSoopVodInfo(videoId);
        if (!vodInfo || !vodInfo.data || vodInfo.result !== 1) return;
        this.vodInfo = {
            id: videoId,
            type: vodInfo.data.file_type,
            files: vodInfo.data.files,
            total_file_duration: vodInfo.data.total_file_duration,
            originVodInfo: null, // 원본 다시보기의 정보
            view_cnt: vodInfo.data.view_cnt,
            live_total_view: vodInfo.data.live_total_view,
        }
        if (vodInfo.data.write_tm){
            const splitres = vodInfo.data.write_tm.split(' ~ ');
            this.vodInfo.startDate = new Date(splitres[0]);
            this.vodInfo.endDate = splitres[1] ? new Date(splitres[1]) : null;
        }
        // 클립은 라이브나 다시보기에서 생성될 수 있고 캐치는 클립에서도 생성될 수 있음.
        // 현재 페이지가 클립이거나 캐치인 경우 원본 VOD의 정보를 읽음
        if (this.vodInfo.type === 'NORMAL'){
            return;
        }
        else if (this.vodInfo.type === 'CLIP' || this.vodInfo.type === 'CATCH'){
            if (vodInfo.data.original_clip_scheme){
                const searchParamsStr = vodInfo.data.original_clip_scheme.split('?')[1];
                const params = new URLSearchParams(searchParamsStr);
                const originVodType = params.get('type');
                const originVodId = params.get('title_no');
                const originVodChangeSecond = parseInt(params.get('changeSecond'));
                const originVodInfo = await window.VODSync.soopAPI.GetSoopVodInfo(originVodId);
                if (originVodInfo && originVodInfo.data){
                    const splitres = originVodInfo.data.write_tm.split(' ~ ');
                    // 원본 VOD가 다시보기인 경우 원본 VOD의 정보를 읽음
                    if (originVodType === 'REVIEW'){
                        this.vodInfo.originVodInfo = {
                            type: originVodInfo.data.file_type,
                            startDate: new Date(splitres[0]),
                            endDate: new Date(splitres[1]),
                            files: originVodInfo.data.files,
                            total_file_duration: originVodInfo.data.total_file_duration,
                            originVodChangeSecond: originVodChangeSecond, // 원본 다시보기에서 현재 vod의 시작 시점의 시작 시간
                        }
                        this.vodInfo.startDate = new Date(this.vodInfo.originVodInfo.startDate.getTime() + originVodChangeSecond * 1000);
                        this.vodInfo.endDate = new Date(this.vodInfo.startDate.getTime() + this.vodInfo.total_file_duration);
                    }
                    // 원본 VOD가 클립인 경우 클립의 원본 VOD(다시보기) 정보를 읽음
                    else if (originVodType === 'CLIP'){
                        if (originVodInfo.data.original_clip_scheme){
                            const searchParamsStr = originVodInfo.data.original_clip_scheme.split('?')[1];
                            const params = new URLSearchParams(searchParamsStr);
                            const originOriginVodType = params.get('type');
                            if (originOriginVodType === 'REVIEW'){
                                const originOriginVodId = params.get('title_no');
                                const originOriginVodChangeSecond = parseInt(params.get('changeSecond'));
                                const originOriginVodInfo = await window.VODSync.soopAPI.GetSoopVodInfo(originOriginVodId);
                                if (originOriginVodInfo && originOriginVodInfo.data){
                                    const splitres = originOriginVodInfo.data.write_tm.split(' ~ ');
                                    this.vodInfo.originVodInfo = {
                                        type: originOriginVodInfo.data.file_type,
                                        startDate: new Date(splitres[0]),
                                        endDate: new Date(splitres[1]),
                                        files: originOriginVodInfo.data.files,
                                        total_file_duration: originOriginVodInfo.data.total_file_duration,
                                        originVodChangeSecond: originVodChangeSecond + originOriginVodChangeSecond, // 원본 다시보기에서 현재 vod의 시작 시점의 시작 시간
                                    };
                                    this.vodInfo.startDate = new Date(this.vodInfo.originVodInfo.startDate.getTime() + (originVodChangeSecond+originOriginVodChangeSecond) * 1000);
                                    this.vodInfo.endDate = new Date(this.vodInfo.startDate.getTime() + this.vodInfo.total_file_duration);
                                }
                            }
                            else{
                                this.warn(`${this.videoId}를 제보해주시기 바랍니다.\n[VOD Master 설정] > [문의하기]`);
                            }
                        }
                    }
                }
            }
            else{
                this.vodInfo.startDate = null;
                this.vodInfo.endDate = null;
                this.log('원본 다시보기와 연결되어 있지 않은 VOD입니다.');
                return;
            }
        }
        else if (this.vodInfo.type === 'EDITOR'){
            this.vodInfo.startDate = null;
            this.vodInfo.endDate = null;
            this.log('편집된 VOD입니다.');
            return;
        }
        const calcedTotalDuration = this.vodInfo.endDate.getTime() - this.vodInfo.startDate.getTime();
        const durationDiff = Math.abs(calcedTotalDuration - this.vodInfo.total_file_duration);
        this.debug('오차: ', durationDiff);
        if (durationDiff < MAX_DURATION_DIFF){
            this.isEditedVod = false;
        }
        else{
            this.isEditedVod = true;
            this.log('영상 전체 재생 시간과 계산된 재생 시간이 다릅니다.');
        }
        this.log('영상 정보 로드 완료');
    }

    async reloadAll(videoId){
        if (this.reloadingAll) return;
        this.reloadingAll = true;
        try {
            const time = this.vodInfo == null ? 0 : 1000;
            await new Promise(r => setTimeout(r, time));
            await this.loadVodInfo(videoId);
            this.reloadVideoTag();
            this.moveTooltipToCtrlBox();
        } finally {
            this.reloadingAll = false;
        }
    }
    reloadVideoTag(){
        this.playTimeTag = document.querySelector('span.time-current');
        this.videoTag = document.querySelector('#video');
        
        if (this.vodInfo && this.vodInfo.type === "REVIEW"){ // 다시보기인 경우 순수 조회수 표시
            const vodViewCountTag = document.querySelector('div.cnt_info li:nth-child(1) strong');
            const realViewCount = this.vodInfo.view_cnt - this.vodInfo.live_total_view ;
            if (vodViewCountTag){
                if (realViewCount != NaN)
                    vodViewCountTag.setAttribute('tip', `순 조회수 ${realViewCount}회`);
                else
                    vodViewCountTag.setAttribute('tip', `순 조회수 불러오기 실패`);
            }
        }
        if (this.videoTag === null)
            this.videoTag = document.querySelector('#video_p');
        
        if (this.playTimeTag === null)
            setTimeout(()=>{this.reloadVideoTag()}, 500);
        else if (this.videoTag === null){
            this.log('playTimeTag 갱신됨', this.playTimeTag);
            setTimeout(()=>{this.reloadVideoTag()}, 500);
        }
        else{
            this.log('videoTag 갱신됨', this.videoTag);
        }
    }
    /* override methods */
    observeDOMChanges() {
        // const targetNode = document.body;
        // const config = { childList: true, subtree: true };

        // this.observer = new MutationObserver(() => {
        //     this.reloadAll();
        // });

        // this.observer.observe(targetNode, config);
    }
    getStreamPeriod(){
        if (!this.vodInfo || this.vodInfo.type === 'NORMAL') return null;
        const startDate = this.vodInfo.originVodInfo === null ? this.vodInfo.startDate : this.vodInfo.originVodInfo.startDate;
        const endDate = this.vodInfo.originVodInfo === null ? this.vodInfo.endDate : this.vodInfo.originVodInfo.endDate;
        return [startDate, endDate];
    }
    playbackTimeToGlobalTS(totalPlaybackSec){
        if (!this.vodInfo) return null;

        // 최대한 다시보기의 정보를 참고해야한다. 다시보기의 일부분이 잘렸을 수 있기 때문에
        let reviewDataFiles = null;
        let deltaTimeSec = 0;
        if (this.vodInfo.type === 'REVIEW'){
            reviewDataFiles = this.vodInfo.files;
        }
        else if (this.vodInfo.originVodInfo !== null && this.vodInfo.originVodInfo.files.length > 0)
        {
            reviewDataFiles = this.vodInfo.originVodInfo.files;
            deltaTimeSec = this.vodInfo.originVodInfo.originVodChangeSecond;
        }
        else{ // 다시보기(originVodInfo) 정보가 없거나 파일이 없는 경우 (원본 영상이 구플이라서 접근이 안되는 경우 등)
            return new Date(this.vodInfo.startDate.getTime() + totalPlaybackSec * 1000);
        }

        if (this.isEditedVod && reviewDataFiles.length > 1 && this.vodInfo.type !== 'REVIEW'){
            this.warn(`${this.videoId}를 제보해주시기 바랍니다.\n[VOD Master 설정] > [문의하기]`);
            return null;
        }
        
        let cumulativeTime = 0
        for (let i = 0; i < reviewDataFiles.length; ++i){
            const file = reviewDataFiles[i];
            const localPlaybackTime = totalPlaybackSec*1000 + deltaTimeSec*1000- cumulativeTime;
            // const hour = Math.floor(localPlaybackTime / 3600000);
            // const minute = Math.floor((localPlaybackTime % 3600000) / 60000);
            // const second = Math.floor((localPlaybackTime % 60000) / 1000);
            // this.log(`localPlaybackTime: ${hour}:${minute}:${second}`);    
            if (localPlaybackTime > file.duration){
                cumulativeTime += file.duration;
                continue;
            }
            const startTime = new Date(file.file_start);
            return new Date(startTime.getTime() + localPlaybackTime);
        }
        return null;
    }
    /// globalTS: milliseconds
    globalTSToPlaybackTime(globalTS){
        if (!this.vodInfo || !this.videoTag) return null;       

        // 최대한 다시보기의 정보를 참고해야한다. 다시보기의 일부분이 잘렸을 수 있기 때문에
        let reviewDataFiles = null;
        let deltaTimeSec = 0;
        if (this.vodInfo.type === 'REVIEW'){
            reviewDataFiles = this.vodInfo.files;
        }
        else if (this.vodInfo.originVodInfo !== null && this.vodInfo.originVodInfo.files.length > 0)
        {
            reviewDataFiles = this.vodInfo.originVodInfo.files;
            deltaTimeSec = this.vodInfo.originVodInfo.originVodChangeSecond;
        }
        else{ // 다시보기(originVodInfo) 정보가 없거나 파일이 없는 경우 (원본 영상이 구플이라서 접근이 안되는 경우 등)
            return Math.floor((globalTS - this.vodInfo.startDate.getTime()) / 1000);
        }

        if (this.isEditedVod && reviewDataFiles.length > 1 && this.vodInfo.type !== 'REVIEW'){
            this.warn(`${this.videoId}를 제보해주시기 바랍니다.\n[VOD Master 설정] > [문의하기]`);
            return null;
        }

        let cumulativeTime = 0;
        for (let i = 0; i < reviewDataFiles.length; ++i){
            const file = reviewDataFiles[i];
            const fileStartDate = new Date(file.file_start);
            const fileEndDate = new Date(fileStartDate.getTime() + file.duration);
            if (fileStartDate.getTime() <= globalTS && globalTS <= fileEndDate.getTime()){
                return Math.floor((globalTS - fileStartDate.getTime() + cumulativeTime) / 1000);
            }
            cumulativeTime += file.duration;
        }
        return null;
    }

    /** @override 전역 타임스탬프 → 재생 시각 변환 가능 여부 (vodInfo, videoTag 준비 시 true) */
    canConvertGlobalTSToPlaybackTime() {
        return this.vodInfo != null;
    }

    /**
     * @override
     * @description 현재 영상이 스트리밍된 당시 시간을 반환
     * @returns {Date} 현재 영상이 스트리밍된 당시 시간
     * @returns {null} 영상 정보를 가져올 수 없음. 의도치않은 상황 발생
     * @returns {string} 당시 시간을 계산하지 못한 오류 메시지.
     */
    getCurDateTime(){
        if (this.vodInfo == null) return null;
        const totalPlaybackSec = this.getCurPlaybackTime();
        if (totalPlaybackSec === null) return null;

        if (this.vodInfo.type === 'NORMAL')
            return '업로드 VOD는 지원하지 않습니다.';
        else if (this.vodInfo.type === "EDITOR")
            return '편집된 VOD는 지원하지 않습니다.';
        if (this.vodInfo.startDate === null && 
            this.vodInfo.endDate === null && 
            this.vodInfo.originVodInfo === null) {
                return '원본 다시보기와 연결되어 있지 않은 VOD입니다.';
        }

        const globalTS = this.playbackTimeToGlobalTS(totalPlaybackSec);
        return globalTS;
    }

    /** 다시보기·클립 등 API `files` 출처 (playbackTimeToGlobalTS와 동일). */
    _reviewDataFilesForPlayback() {
        if (!this.vodInfo) return null;
        const files = this.vodInfo.originVodInfo === null ? this.vodInfo.files : this.vodInfo.originVodInfo.files;
        if (!Array.isArray(files) || files.length === 0) return null;
        return files;
    }

    /** 재생 표시 태그 정수 초 (HH:MM:SS / MM:SS). 다중 파일일 때 어느 file인지 골 때·비디오 없을 때 폴백. */
    _parsePlayTimeTagToIntegerSec() {
        if (!this.playTimeTag) return null;
        const totalPlaybackTimeStr = this.playTimeTag.innerText.trim();
        const splitres = totalPlaybackTimeStr.split(':');
        let totalPlaybackSec = 0;
        if (splitres.length === 3) {
            totalPlaybackSec = parseInt(splitres[0], 10) * 3600 + parseInt(splitres[1], 10) * 60 + parseInt(splitres[2], 10);
        } else if (splitres.length === 2) {
            totalPlaybackSec = parseInt(splitres[0], 10) * 60 + parseInt(splitres[1], 10);
        } else {
            this.warn(`${this.videoId}를 제보해주시기 바랍니다.\n[VOD Master 설정] > [문의하기]`);
            return null;
        }
        return Number.isFinite(totalPlaybackSec) ? totalPlaybackSec : null;
    }

    /**
     * @description 현재 재생 시간을 초 단위로 반환 (전역 타임라인). `VODSync.getVodCore().playerController.playingTime` 우선.
     * `files[].duration`(ms)는 앞선 파일 길이만 ms로 누적 후 초로 바꾸고, **현재 파일 안**의 재생 위치는 항상 `videoTag.currentTime`만 쓴다.
     * 재생 표시 태그(`playTimeTag`)는 **몇 번째 파일인지** 고를 때만 쓰고, 재생 초의 소수·누적에는 섞지 않는다. 비디오를 읽을 수 없을 때만 태그 정수 초를 쓴다.
     * @returns {number} 현재 재생 시간(초)
     * @returns {null} 재생 시간을 계산할 수 없음. 의도치않은 상황 발생
     */
    getCurPlaybackTime() {
        const pa = window.VODSync?.getVodCore?.();
        const pt = pa?.playerController?.playingTime;
        if (typeof pt === 'number' && Number.isFinite(pt)) return Math.max(0, pt);

        const v = this.videoTag;
        const maxSec = this.getTotalFileDurationSec();
        const ct = v && Number.isFinite(v.currentTime) ? Math.max(0, v.currentTime) : null;
        const files = this._reviewDataFilesForPlayback();

        if (files && files.length > 0 && ct != null) {
            if (files.length === 1) {
                const maxSec = this.getTotalFileDurationSec();
                if (maxSec != null) return Math.min(maxSec, ct);
                return ct;
            }
            // playTimeTag를 사용하여 몇 번째 파일인지 판별, 이전 파일들의 duration을 누적
            const T = this._parsePlayTimeTagToIntegerSec();
            if (T === null) return null;
            const tagMs = T * 1000;
            let cumMs = 0;
            for (let i = 0; i < files.length; i++) {
                const durMs = files[i].duration;
                const endMs = cumMs + durMs;
                const isLast = i === files.length - 1;
                if (tagMs < endMs - 1e-6 || isLast) {
                    let total = Math.floor(cumMs / 1000) + ct; // 무슨 이유에선지 SOOP의 플레이어에선 앞의 파일들의 합에서 소수점을 버림
                    const maxSec = this.getTotalFileDurationSec();
                    if (maxSec != null) total = Math.max(0, Math.min(maxSec, total));
                    else total = Math.max(0, total);
                    return total;
                }
                cumMs = endMs;
            }
        }

        if (ct != null) {
            let total = ct;
            if (maxSec != null) total = Math.min(maxSec, total);
            return Math.max(0, total);
        }

        const tagSec = this._parsePlayTimeTagToIntegerSec();
        if (tagSec === null) return null;
        let totalPlaybackSec = tagSec;
        if (maxSec != null) totalPlaybackSec = Math.max(0, Math.min(maxSec, totalPlaybackSec));
        return totalPlaybackSec;
    }

    /**
     * GetSoopVodInfo 기반 전체 재생 길이(초). vodCore ghost·편집 패널 타임라인 스케일에 쓸 때 TamperMonkey 등에서 `<video>.duration` 대신 사용.
     * @returns {number|null} 로드 전·비정상이면 null
     */
    getTotalFileDurationSec() {
        if (!this.vodInfo || !Number.isFinite(this.vodInfo.total_file_duration)) return null;
        const ms = this.vodInfo.total_file_duration;
        if (ms <= 0) return null;
        return ms / 1000;
    }

    /**
     * @override
     * @description 영상 시간을 설정
     * @param {number} globalTS (milliseconds)
     * @param {boolean} doAlert 
     * @returns {boolean} 성공 여부
     */
    async moveToGlobalTS(globalTS, doAlert = true) {
        const playbackTime = await this.globalTSToPlaybackTime(globalTS);
        if (playbackTime === null) return false;
        const maxPlaybackTime = Math.floor(this.vodInfo.total_file_duration / 1000);
        if (playbackTime < 0 || playbackTime > maxPlaybackTime){
            const errorMessage = `재생 시간 범위를 벗어납니다. (${playbackTime < 0 ? playbackTime : playbackTime - maxPlaybackTime}초 초과됨)`;
            if (doAlert) 
                alert(errorMessage);
            this.warn(errorMessage);
            return false;
        }
        return this.moveToPlaybackTime(playbackTime, doAlert);
    }
    moveToPlaybackTime(playbackTime, doAlert = true) {
        if (this._timeLinkJumpIntervalId != null) {
            clearInterval(this._timeLinkJumpIntervalId);
            this._timeLinkJumpIntervalId = null;
        }

        const url = new URL(window.location.href);
        const secNum = Math.max(0, Number(playbackTime));
        const changeSec = Number.isFinite(secNum) ? Math.floor(secNum * 100) / 100 : 0;
        url.searchParams.set('change_second', String(changeSec));
        window.history.replaceState({}, '', url.toString());

        const pa = window.VODSync?.getVodCore?.();
        if (pa && typeof pa.seek === 'function') {
            const sec = Math.max(0, Number(playbackTime));
            try {
                pa.seek(Number.isFinite(sec) ? sec : 0);
                this.debug('playback seek via adapter', sec);
                return true;
            } catch (e) {
                /* ignore */
            }
        }

        /// soop 댓글 타임라인 기능 (adapter·시크 불가 시 폴백)
        const targetSec = playbackTime;
        this._timeLinkJumpIntervalId = setInterval(() => {
            if (Math.abs(this.getCurPlaybackTime() - targetSec) <= 1) {
                if (this._timeLinkJumpIntervalId != null) {
                    clearInterval(this._timeLinkJumpIntervalId);
                    this._timeLinkJumpIntervalId = null;
                }
                return;
            }
            if (this.timeLink === null) {
                this.timeLink = document.createElement('a');
                document.body.appendChild(this.timeLink);
            }
            this.timeLink.className = 'time_link';
            this.timeLink.setAttribute('data-time', targetSec.toString());
            this.timeLink.click();
            this.debug('timeLink 클릭됨');
        }, 500);
        return true;
    }
    // 현재 재생 중인지 여부 반환
    isPlaying() {
        if (this.videoTag) {
            return !this.videoTag.paused;
        }
        return false;
    }
}
        class VODLinkerBase extends IVodSync{
    constructor(isInIframe = false){
        super();
        this.BTN_TEXT_IDLE = "Sync VOD";
        this.SYNC_BUTTON_CLASSNAME = 'vodSync-sync-btn';
        if (isInIframe){
            const searchParams = new URLSearchParams(window.location.search);
            if (searchParams.get('only_search') === '1'){
                this.setupSearchAreaOnlyMode();
            }
            window.addEventListener('message', this.handleWindowMessage.bind(this));
            this.getRequestVodDate = () => {return new Date(this.request_vod_ts);}
            this.getRequestRealTS = () => {
                if (this.request_real_ts){
                    return this.request_real_ts;
                }
                return null;
            }
        }
        else{
            this.getRequestVodDate = () => {return window.VODSync?.tsManager?.getCurDateTime();}
            this.getRequestRealTS = () => {
                if (window.VODSync?.tsManager?.isPlaying()){ // 재생 중인경우 페이지 로딩 시간을 보간하기위해 탭 연 시점을 전달
                    return Date.now();
                }
                return null;
            }
        }
        this.startSyncButtonManagement();
        this.setupSearchInputKeyboardHandler();
    }
    // 주기적으로 동기화 버튼 생성 및 업데이트
    startSyncButtonManagement() {
        setInterval(() => {
            const requestDate = this.getRequestVodDate();
            // 타임스탬프 매니저가 vod 정보를 불러오지 못한 경우 동기화 버튼 생성 안함
            if (!this.isValidDate(requestDate)) return;

            const targets = this.getTargetsForCreateSyncButton();
            if (!targets) return;

            targets.forEach(element => {
                if (element.querySelector(`.${this.SYNC_BUTTON_CLASSNAME}`)) return; // 이미 동기화 버튼이 있음
                const button = this.createSyncButton();
                button.addEventListener('click', (e) => this.handleFindVODButtonClick(e, button));
                element.appendChild(button);
            });
        }, 500);
    }
    // 동기화 버튼 onclick 핸들러
    async handleFindVODButtonClick(e, button){
        e.preventDefault();       // a 태그의 기본 이동 동작 막기
        e.stopPropagation();      // 이벤트 버블링 차단

        // 스트리머 ID 검색
        const streamerName = this.getStreamerName(button);
        if (!streamerName) {
            alert("검색어를 찾을 수 없습니다.");
            button.innerText = this.BTN_TEXT_IDLE;
            return;
        }
        button.innerText = `${streamerName}로 ID 검색 중`;
        const streamerId = await this.getStreamerId(streamerName);
        if (!streamerId) {
            alert(`${streamerName}의 스트리머 ID를 찾지 못했습니다.`);
            button.innerText = this.BTN_TEXT_IDLE;
            return;
        }
        this.debug(`스트리머 ID: ${streamerId}`);

        const requestDate = this.getRequestVodDate();
        const request_real_ts = this.getRequestRealTS();
        
        if (!this.isValidDate(requestDate)){
            this.warn("타임스탬프 정보를 받지 못했습니다.");
            button.innerText = this.BTN_TEXT_IDLE;
            return;
        }
        if (typeof requestDate === 'string'){
            this.warn(requestDate);
            button.innerText = this.BTN_TEXT_IDLE;
            alert(requestDate);
            return;
        }

        button.innerText = `${streamerName}의 VOD 검색 중...`;
        const vodInfo = await this.findVodByDatetime(button, streamerId, streamerName, requestDate);
        if (!vodInfo){
            alert("동기화할 다시보기를 찾지 못했습니다.");
            button.innerText = this.BTN_TEXT_IDLE;
            return;
        }
        this.log(`다시보기 정보: ${vodInfo.vodLink}, ${vodInfo.startDate}, ${vodInfo.endDate}`);
        const url = new URL(vodInfo.vodLink);
        const change_second = Math.round((requestDate.getTime() - vodInfo.startDate.getTime()) / 1000);
        url.searchParams.set('change_second', change_second);
        url.searchParams.set('request_vod_ts', requestDate.getTime());
        if (request_real_ts){
            url.searchParams.set('request_real_ts', request_real_ts);
        }
        // 타임라인 댓글 동기화 요청 처리
        const timelinePayload = (window.VODSync?.timelineCommentProcessor?.getTimelineSyncPayload?.() ?? []);
        if (timelinePayload.length > 0) {
            url.searchParams.set('timeline_sync', '1');
            try {
                localStorage.setItem('vodSync_timeline', JSON.stringify(timelinePayload));
            } catch (_) { /* quota or disabled */ }
        }
        window.open(url, "_blank");
        this.log(`VOD 링크: ${url.toString()}`);
        button.innerText = this.BTN_TEXT_IDLE;
        this.getSearchInputElement()?.blur();
        this.closeSearchArea();
    }
    isValidDate(date){
        return date instanceof Date && !isNaN(date.getTime());
    }
    // 상위 페이지에서 타임스탬프 정보를 받음 (other sync panel에서 iframe으로 열릴 때 사용)
    handleWindowMessage(e){
        if (e.data.response === "SET_REQUEST_VOD_TS"){
            this.request_vod_ts = e.data.request_vod_ts;
            this.request_real_ts = e.data.request_real_ts;
            // this.log("REQUEST_VOD_TS 받음:", e.data.request_vod_ts, e.data.request_real_ts);
        }
    }
    /**
     * @description 검색 결과 페이지에서 검색 영역만 남기게 함. (other sync panel에서 iframe으로 열릴 때 사용)
     */
    setupSearchAreaOnlyMode() {
        document.documentElement.style.overflow = "hidden";
        // 파생 클래스들이 오버라이드하여 구현하되 super.setupSearchAreaOnlyMode()를 호출해야함
        
    }
    /**
     * @description 동기화 버튼을 생성할 요소를 반환
     * @returns {NodeList} 동기화 버튼을 생성할 요소들
     */
    getTargetsForCreateSyncButton(){
        // 파생 클래스들이 오버라이드하여 구현해야함
        throw new Error("Not implemented");
    }
    /**
     * @description 동기화 버튼을 생성
     * @returns {HTMLButtonElement} 동기화 버튼
     */
    createSyncButton(){
        // 파생 클래스들이 오버라이드하여 구현해야함
        throw new Error("Not implemented");
    }
    /**
     * @description 스트리머 이름을 반환
     * @param {HTMLButtonElement} button 동기화 버튼
     * @returns {string} 스트리머 이름
     */
    getStreamerName(button){
        // 파생 클래스들이 오버라이드하여 구현해야함
        throw new Error("Not implemented");
    }
    /**
     * @description 스트리머 ID를 반환
     * @param {string} searchWord 검색어
     * @returns {string} 스트리머 ID
     */
    async getStreamerId(searchWord){
        // 파생 클래스들이 오버라이드하여 구현해야함
        throw new Error("Not implemented");
    }
    /**
     * @description 다시보기를 찾음
     * @param {HTMLButtonElement} button 동기화 버튼
     * @param {string} streamerId 스트리머 ID
     * @param {string} streamerName 스트리머 이름
     * @param {Date} requestDate 요청 시간
     * @returns {Object} {vodLink: string, startDate: Date, endDate: Date} or null
     */
    async findVodByDatetime(button, streamerId, streamerName, requestDate) {
        // 파생 클래스들이 오버라이드하여 구현해야함
        throw new Error("Not implemented");
    }
    /**
     * @description 색어를 제거하고 검색결과미리보기 영역을 닫음
     */
    closeSearchArea(){
        // 파생 클래스들이 오버라이드하여 구현해야함
        throw new Error("Not implemented");
    }
    /**
     * @description 검색창 요소를 반환
     * @returns {HTMLInputElement|null} 검색창 input 요소
     */
    getSearchInputElement(){
        // 파생 클래스들이 오버라이드하여 구현해야함
        return null;
    }
    /**
     * @description 검색창에 키보드 이벤트 핸들러 설정 (Ctrl+Shift+Enter로 SyncVOD 버튼 클릭)
     */
    setupSearchInputKeyboardHandler() {
        // 검색창이 동적으로 생성될 수 있으므로 주기적으로 확인
        setInterval(() => {
            const searchInput = this.getSearchInputElement();
            if (!searchInput) return;
            
            // 이미 이벤트 리스너가 추가되어 있는지 확인
            if (searchInput.dataset.vodSyncHandlerAdded === 'true') return;
            
            searchInput.addEventListener('keydown', (e) => {
                // Ctrl+Shift+Enter 감지
                if (e.key === 'Enter' && e.ctrlKey && e.shiftKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    const syncButton = document.querySelector(`.${this.SYNC_BUTTON_CLASSNAME}`);
                    if (syncButton) {
                        syncButton.click();
                    }
                }
            });
            
            // 이벤트 리스너가 추가되었음을 표시
            searchInput.dataset.vodSyncHandlerAdded = 'true';
        }, 500);
    }
}
        class SoopVODLinker extends VODLinkerBase{
    /**
     * @description 검색 결과 페이지에서 검색 결과 영역만 남기고 나머지는 숨기게 함. (other sync panel에서 iframe으로 열릴 때 사용)
     * @override
     */
    setupSearchAreaOnlyMode() {
        super.setupSearchAreaOnlyMode();
        this.waitForGnbAndSearchArea();
    }
    
    async waitForGnbAndSearchArea() {
        let allDone = true;
        const gnb = document.querySelector('#soop-gnb');
        const searchArea = document.querySelector('.topSearchArea');
        const backBtn = document.querySelector('#topSearchArea > div > div > button');
        const searchButton = document.querySelector('.btn-search');
        if (gnb && searchArea && backBtn && searchButton)
        {
            // await new Promise(resolve => setTimeout(resolve, 1000));
            Array.from(gnb.parentNode.children).forEach(sibling => {
                if (sibling !== gnb) sibling.style.display = 'none';
            });
            searchArea.style.display = "flow";
            Array.from(searchArea.parentNode.children).forEach(sibling => {
                if (sibling !== searchArea) sibling.remove();
            });
            backBtn.style.display = "none";
            document.body.style.background = 'white';
            searchButton.click();
        }
        else
            allDone = false;

        if (!allDone) setTimeout(() => this.waitForGnbAndSearchArea(), 200);
    }
    getTargetsForCreateSyncButton(){
        const targets = document.querySelectorAll('#areaSuggest > ul > li > a');
        const filteredTargets = [];
        for(const target of targets){
            if (target.querySelector('em')) continue;
            filteredTargets.push(target);
        }
        return filteredTargets;
    }
    createSyncButton(){
        const button = document.createElement("button");
        button.className = this.SYNC_BUTTON_CLASSNAME;
        button.innerText = this.BTN_TEXT_IDLE;
        button.style.background = "gray";
        button.style.fontSize = "12px";
        button.style.color = "white";
        button.style.marginLeft = "20px";
        button.style.padding = "5px";
        button.style.verticalAlign = 'middle';
        return button;
    }
    getStreamerName(button){
        const nicknameSpan = button.parentElement.querySelector('span');
        if (!nicknameSpan) return null;
        return nicknameSpan.innerText;
    }
    // 검색어를 제거하고 검색결과미리보기 영역을 닫음
    closeSearchArea(){
        const searchPreviewCloseButton = document.querySelector('.srh_back'); // SOOP 검색 결과 영역 닫기 버튼
        if (searchPreviewCloseButton) {
            searchPreviewCloseButton.click();
        }
        const delSearcButton = document.querySelector('.del_text');
        if (delSearcButton){
            delSearcButton.click();
        }
    }
    async getStreamerId(searchWord){
        const streamerId = await window.VODSync.soopAPI.GetStreamerID(searchWord);
        return streamerId;
    }
    /**
     * @description 다시보기를 찾음
     * @param {HTMLButtonElement} button 동기화 버튼
     * @param {string} streamerId 스트리머 ID
     * @param {string} streamerName 스트리머 이름
     * @param {Date} requestDate 
     * @returns {Object} {vodLink: string, startDate: Date, endDate: Date} or null
     * @override
     */
    async findVodByDatetime(button, streamerId, streamerName, requestDate) {
        const search_range_hours = 24*3;// +- 3일 동안 검색
        const search_start_date = new Date(requestDate.getTime() - search_range_hours * 60 * 60 * 1000);
        const search_end_date = new Date(requestDate.getTime() + search_range_hours * 60 * 60 * 1000);
        const vodList = await window.VODSync.soopAPI.GetSoopVOD_List(streamerId, search_start_date, search_end_date);
        const totalVodCount = vodList.data.length;
        for(let i = 0; i < totalVodCount; ++i){
            const vod = vodList.data[i];
            button.innerText = `${streamerName}의 VOD 검색 중 (${i+1}/${totalVodCount})`;
            const vodInfo = await window.VODSync.soopAPI.GetSoopVodInfo(vod.title_no);
            if (vodInfo === null){
                continue;
            }
            const period = vodInfo.data.write_tm;
            const splitres = period.split(' ~ ');
            const startDate = new Date(splitres[0]);
            const endDate = new Date(splitres[1]);
            if (startDate <= requestDate && requestDate <= endDate){
                const vodOrigin = window.VODSync?.SoopUrls?.VOD_ORIGIN || 'https://vod.sooplive.com';
                return{
                    vodLink: `${vodOrigin}/player/${vod.title_no}`,
                    startDate: startDate,
                    endDate: endDate
                };
            }
        }
    }
    /**
     * @description 검색창 요소를 반환
     * @returns {HTMLInputElement|null} 검색창 input 요소
     * @override
     */
    getSearchInputElement(){
        // SOOP 검색창 선택자 (검색 결과 페이지의 검색창)
        const searchInput = document.querySelector('#search-inp');
        return searchInput || null;
    }
}
        /**
 * 다시보기 페이지의 타임라인 댓글을 인식하고, VOD linker가 동기화 시 참조할 수 있는 형태로 가공해 두는 클래스의 베이스.
 * 댓글 컨테이너를 찾은 뒤 주기적으로 댓글 요소를 찾아 타임라인 댓글이면 변환 체크박스를 붙이고,
 * 체크/해제 시 멤버 배열에 댓글 요소를 저장/제거해 두었다가 VOD linker 요청 시 가공해 전달한다.
 */

class TimelineCommentProcessorBase extends IVodSync {
    static CHECKBOX_CLASS = 'vodSync-timeline-sync-cb';
    static CHECKBOX_WRAP_CLASS = 'vodSync-timeline-sync-wrap';
    /** 더보기 레이어(_moreDot_layer) 안에 넣는 편집 버튼 식별용 */
    static EDIT_IN_MORE_CLASS = 'vodSync-timeline-edit-in-more';
    static BTN_INSERT_CURRENT_TIME_CLASS = 'vodSync-timeline-insert-current-time';
    static BTN_INSERT_CURRENT_TIME_LABEL = '현재 시간 삽입';

    // ---- 문자열 리소스 (UI 노출용) ----
    static LABEL_SYNC_TOOLTIP = '다른 스트리머의 다시보기가 동기화될 때 이 타임라인 댓글이 동기화된 다시보기에 맞춰 변환됩니다';
    static LABEL_SYNC_CHECKBOX = '동기화할 때 이 타임라인을 변환';
    static BTN_EDIT_IN_MORE = '타임라인 편집';
    static BTN_EDIT_IN_MORE_TOOLTIP = '이 타임라인 댓글을 편집기에서 편집·복사합니다';
    static PANEL_HEADER = '타임라인 편집기';
    static BTN_COLLAPSE = '접기';
    static BTN_EXPAND = '펴기';
    static BTN_COPY = '전체 복사';
    static BTN_COPIED = '복사됨';
    static BTN_COPY_FAILED = '복사 실패';
    static BTN_CLOSE = '닫기';
    static TIME_PLACEHOLDER = '--:--';
    static BTN_TIME_MINUS = '-';
    static BTN_TIME_PLUS = '+';

    /**
     * 자식 클래스에서 설정할 selector 변수들.
     * - containerSelector: string — 컨테이너를 찾을 CSS 선택자
     * - containerCondition: () => boolean — 컨테이너 탐색 전 조건(예: pathname). 기본은 항상 true
     * - commentRowSelector: string — 컨테이너 안 댓글 한 줄(행) 요소 선택자
     * - commentTextSelector: string — 댓글 한 줄에서 텍스트를 꺼낼 하위 요소 선택자
     * - checkboxSlotSelector: string — 댓글 한 줄에서 체크박스를 넣을 슬롯 요소 선택자(없으면 해당 행 사용)
     * - commentInputSelector: string — 댓글 작성란 입력 요소 선택자(동기화된 타임라인 자동 기입 시 사용, 자식에서 설정)
     * - commentInputCurrentTimeButtonSlotSelector: string — 댓글 작성란 입력 요소 안에 현재 시간 삽입 버튼을 넣을 슬롯 요소 선택자
     * - commentInputTextareaSelector: string — 댓글 작성란 입력 요소 안에 텍스트 입력 요소 선택자
     */
    constructor() {
        super();
        this._started = false;
        /** 전달받은 타임라인 동기화 페이로드 (receive 시 저장) */
        this._incomingTimelineSyncPayload = null;
        /** timeline_sync fill 시도/대기 debug 1회 로그용 */
        this._loggedTimelineSyncFillAttempt = false;
        this._loggedTimelineSyncWaitingConvert = false;
        /** 미리보기 창 뼈대 (receive 시 생성). listWrap은 뼈대의 내용 영역 참조용. */
        this._timelinePreviewWrap = null;
        this._timelinePreviewListWrap = null;
        /** 채워넣은 행 데이터 (복사 버튼에서 사용) */
        this._timelinePreviewRows = null;
        /** 찾아둔 댓글 컨테이너. document에 연결되어 있으면 재탐색 생략 */
        this._cachedCommentContainer = null;
        /** 변환 체크가 된 댓글 한 줄 요소들. 체크 시 추가·해제 시 제거. */
        this._selectedCommentRows = [];
        /** 체크박스 스타일 객체. 자식 클래스에서 키 추가·값 수정 가능. (예: this.checkboxWrapStyle.right = '30px') */
        this.checkboxWrapStyle = { position: 'absolute', top: '2px', right: '2px', zIndex: 1, fontSize: '13px', padding: '2px 6px', borderRadius: '4px', transition: 'background-color .15s ease' };
        this.checkboxLabelStyle = { cursor: 'pointer', position: 'relative', display: 'inline-block' };
        this.checkboxInputStyle = { position: 'absolute', inset: 0, width: '100%', height: '100%', margin: 0, opacity: 0, cursor: 'pointer' };
        this.checkboxWrapCheckedStyle = { backgroundColor: '#a8d8ea', color: '#1a1a1a' };
        this.checkboxWrapUncheckedStyle = { backgroundColor: 'rgba(0,0,0,0.06)', color: '#888' };
        const GITHUB_RAW_URL = "https://raw.githubusercontent.com/Khassarion/VOD-Master/main";
        /** 현재 시간 삽입 버튼 스타일. backgroundImage는 런타임 URL 사용 */
        this.insertCurrentTimeButtonStyle = {
            backgroundImage:
                window.VODSync?.IS_TAMPER_MONKEY_SCRIPT !== true
                    ? `url(${chrome.runtime.getURL('res/img/AddCurrentTime.png')})`
                    : `url(${GITHUB_RAW_URL}/res/img/AddCurrentTime.png)`,
            backgroundSize: '100% 100%',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            width: '32px',
            height: '32px',
            verticalAlign: 'middle',
            borderRadius: '8px'
        };
        this.insertCurrentTimeButtonHoverStyle = { backgroundColor: 'rgb(232,232,232)' };
        window.VODSync = window.VODSync || {};
        window.VODSync.timelineCommentProcessor = this;

        this.startWatching();
    }

    /**
     * 타임라인 댓글 감시 시작. 주기적으로 컨테이너를 찾고, 있으면 해당 컨테이너에서 댓글을 찾아 체크박스를 붙인다.
     * 수신 페이로드가 있으면 미리보기 목록 영역에 내용 채움.
     */
    startWatching() {
        if (this._started) return;
        this._started = true;
        setInterval(() => {
            // 댓글 컨테이너 찾기
            let container = this._cachedCommentContainer;
            if (!container || !container.isConnected) {
                container = this._getContainer();
                this._cachedCommentContainer = container;
            }

            // 타임라인 댓글에 동기화시 변환 버튼 추가하기
            this.scanAndAttachCheckboxes(container);
            // 타임라인 댓글의 더보기를 눌렀을 때 편집 버튼 추가하기
            this._injectEditButtonIntoMoreLayers(container);
            // 댓글 작성 입력창에 타임라인 입력 버튼 추가하기
            this._injectTinelineInsertButton(container);

            // 수신 페이로드가 있으면 미리보기 목록 영역에 내용 채움
            if (this._incomingTimelineSyncPayload) {
                if (!this._loggedTimelineSyncFillAttempt) {
                    this._loggedTimelineSyncFillAttempt = true;
                    this.debug('timeline_sync: 미리보기 채우기 시도 (tsManager 준비 대기 가능)', {
                        payloadLen: this._incomingTimelineSyncPayload.length,
                        hasTsManager: !!window.VODSync?.tsManager,
                        canConvert: !!window.VODSync?.tsManager?.canConvertGlobalTSToPlaybackTime?.(),
                    });
                }
                this.fillTimelinePreviewContent(this._incomingTimelineSyncPayload);
            }
        }, 500);
    }

    // 댓글 컨테이너에서 댓글들을 찾아, 타임라인 댓글이면 변환 체크박스를 추가한다.
    scanAndAttachCheckboxes(container) {
        if (!container) return;
        const comments = this._getComments(container);
        for (const comment of comments) {
            if (comment.querySelector(`.${this.constructor.CHECKBOX_CLASS}`)) continue;
            const text = this._extractTextContent(comment);
            const sec = this.parsePlaybackSecondsFromText(text);
            if (sec == null) continue;
            this.appendSyncCheckboxToRow(comment);
        }
    }

    /** selector로 컨테이너 안 댓글 행 목록 반환 */
    _getComments(container) {
        if (!container) return [];
        const sel = this.commentRowSelector;
        if (!sel) return [];
        return Array.from(container.querySelectorAll(sel));
    }

    /** selector로 댓글 한 줄에서 표시용 텍스트 추출 */
    _extractTextContent(rowEl) {
        const sel = this.commentTextSelector;
        if (!sel) return rowEl?.textContent || '';
        const el = rowEl.querySelector(sel);
        return (el ? el.textContent : rowEl.textContent) || '';
    }

    /** style 객체를 요소에 적용. camelCase 키를 element.style에 그대로 대입. */
    _applyStyle(el, styleObj) {
        if (!styleObj) return;
        for (const [k, v] of Object.entries(styleObj)) {
            if (v != null && v !== '') el.style[k] = v;
        }
    }

    /** selector로 댓글 컨테이너 반환 (containerCondition 적용 후 containerSelector로 querySelector) */
    _getContainer() {
        if (this.containerCondition && !this.containerCondition()) return null;
        const sel = this.containerSelector;
        return sel ? document.querySelector(sel) || null : null;
    }

    /** HH:MM:SS / MM:SS 패턴으로 재생 시각(초) 파싱. 서브클래스에서 오버라이드 가능. */
    parsePlaybackSecondsFromText(text) {
        if (!text || typeof text !== 'string') return null;
        const t = text.trim();
        const withSec = t.match(/(?:^|[\s\[(])(\d{1,2}):(\d{2}):(\d{2})(?:\s|]|\)|$)/);
        if (withSec) return parseInt(withSec[1], 10) * 3600 + parseInt(withSec[2], 10) * 60 + parseInt(withSec[3], 10);
        const minSec = t.match(/(?:^|[\s\[(])(\d{1,2}):(\d{2})(?:\s|]|\)|$)(?!\d)/);
        if (minSec) return parseInt(minSec[1], 10) * 60 + parseInt(minSec[2], 10);
        return null;
    }

    // 특정 댓글 한 줄 요소에 변환 체크박스를 추가. 체크/해제 시 _selectedCommentRows에 반영·배경색 시각화.
    // '타임라인 댓글 편집하기' 버튼은 댓글 더보기 레이어(_moreDot_layer) 안에 주기적으로 주입됨.
    appendSyncCheckboxToRow(rowEl) {
        const slot = this._getCheckboxInsertSlot(rowEl);
        if (!slot) return false;
        const toggleWrap = document.createElement('span');
        toggleWrap.className = this.constructor.CHECKBOX_WRAP_CLASS;
        this._applyStyle(toggleWrap, this.checkboxWrapStyle);
        const label = document.createElement('label');
        label.title = this.constructor.LABEL_SYNC_TOOLTIP;
        this._applyStyle(label, this.checkboxLabelStyle);
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = this.constructor.CHECKBOX_CLASS;
        this._applyStyle(cb, this.checkboxInputStyle);
        const updateWrapStyle = () => {
            this._applyStyle(toggleWrap, cb.checked ? this.checkboxWrapCheckedStyle : this.checkboxWrapUncheckedStyle);
        };
        cb.addEventListener('change', () => {
            updateWrapStyle();
            if (cb.checked) {
                if (!this._selectedCommentRows.includes(rowEl)) this._selectedCommentRows.push(rowEl);
            } else {
                this._selectedCommentRows = this._selectedCommentRows.filter(r => r !== rowEl);
            }
        });
        updateWrapStyle();
        label.appendChild(cb);
        label.appendChild(document.createTextNode(this.constructor.LABEL_SYNC_CHECKBOX));
        toggleWrap.appendChild(label);

        const pos = window.getComputedStyle(slot).position;
        if (!pos || pos === 'static') slot.style.position = 'relative';
        slot.appendChild(toggleWrap);
        return true;
    }

    // 댓글 더보기 레이어(._moreDot_layer)가 보일 때, 타임라인 댓글인 경우에만 편집 버튼을 넣음. SOOP 전용 등은 `_injectClipImportButtonIntoMoreLayer` 오버라이드.
    _injectEditButtonIntoMoreLayers(container) {
        if (!container?.isConnected) return;
        const layers = container.querySelectorAll('._moreDot_layer');
        for (const layer of layers) {
            const rowEl = layer.closest(this.commentRowSelector);
            if (!rowEl || !rowEl.querySelector(`.${this.constructor.CHECKBOX_CLASS}`)) continue;
            const closeMore = () => {
                if (layer.parentNode?.parentNode?.childNodes[0]) layer.parentNode.parentNode.childNodes[0].click();
            };
            if (!layer.querySelector(`.${this.constructor.EDIT_IN_MORE_CLASS}`)) {
                const editBtn = document.createElement('button');
                editBtn.type = 'button';
                editBtn.className = this.constructor.EDIT_IN_MORE_CLASS;
                editBtn.textContent = this.constructor.BTN_EDIT_IN_MORE;
                editBtn.title = this.constructor.BTN_EDIT_IN_MORE_TOOLTIP;
                editBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openPreviewWithCurrentPageTimelineComments(rowEl);
                    closeMore();
                });
                layer.appendChild(editBtn);
            }
            this._injectClipImportButtonIntoMoreLayer(layer, rowEl, closeMore);
        }
    }

    /** 플랫폼별: 더보기 레이어에 편집 구간 가져오기 등 추가 버튼 (기본 없음). */
    _injectClipImportButtonIntoMoreLayer(layer, rowEl, closeMore) {}

    /** selector로 체크박스를 넣을 슬롯 반환 (없으면 rowEl) */
    _getCheckboxInsertSlot(rowEl) {
        const sel = this.checkboxSlotSelector;
        if (!sel) return rowEl;
        return rowEl.querySelector(sel) || rowEl;
    }

    /** VOD linker가 호출. 변환 체크된 댓글 요소들을 모아 가공한 페이로드 반환. (storage/동기화와 동일한 형식: (string|number)[]) */
    getTimelineSyncPayload() {
        // _selectedCommentRows에서 연결된(실제 DOM에 남아있는) row만 추림
        this._selectedCommentRows = this._selectedCommentRows.filter(row => row.isConnected);
        return this._buildPayloadFromComments(this._selectedCommentRows);
    }

    /**
     * 댓글 행 목록으로부터 storage/동기화와 동일한 페이로드 형식 생성.
     * 미리보기(편집하기)와 변환 결과 모두 이 형식으로 fillTimelinePreviewContent에 넘긴다.
     * @param {HTMLElement[]} rowEls 체크박스가 붙은 댓글 행 요소 배열
     * @returns {(string|number)[]}
     */
    _buildPayloadFromComments(rowEls) {
        if (!Array.isArray(rowEls)) return [];
        const segs = this.buildSegmentsFromComments(rowEls);
        if (!Array.isArray(segs)) return [];
        return segs;
    }

    /**
     * 한 개 이상의 댓글에서 미리보기용 세그먼트 생성. 파생 클래스에서 오버라이드.
     * @param {HTMLElement[]} commentEls 댓글 요소 배열
     * @returns {(string|number)[]}
     */
    buildSegmentsFromComments(commentEls) {
        throw this.error('buildSegmentsFromComments is not implemented');
    }

    /**
     * 미리보기 창을 열고 행 데이터로 채움. 변환 결과·현재 페이지 수집 모두 이 진입점 사용.
     * @param {Array<Array<{type:'string',value:string}|{type:'timeline',playbackSec:number|null}>>} rows
     */
    openTimelinePreview(rows) {
        if (!Array.isArray(rows) || rows.length === 0) {
            this.debug('timeline_sync: openTimelinePreview 거부 (빈 rows)');
            return;
        }
        this.debug('timeline_sync: openTimelinePreview', {
            rowCount: rows.length,
            fragCounts: rows.map((r) => r?.length ?? 0),
        });
        if (!this._timelinePreviewWrap?.isConnected) {
            this.debug('timeline_sync: open 시 미리보기 뼈대 생성');
            this._createTimelinePreviewSkeleton();
        }
        this._incomingTimelineSyncPayload = null;
        this._timelinePreviewRows = rows;
        this._renderPreviewRows(rows);
    }

    /**
     * 타임라인 편집하기 버튼이 클릭되면 이 함수가 호출됨.
     * 해당 댓글 내용을 미리보기에 채우고 미리보기 창을 엽니다.
     * @param {HTMLElement} commentEl 편집하기 버튼이 속한 댓글 요소
     */
    openPreviewWithCurrentPageTimelineComments(commentEl) {
        if (!commentEl?.isConnected) return;
        const payload = this._buildPayloadFromComments([commentEl]);
        if (payload.length === 0) return;
        this.fillTimelinePreviewContent(payload);
    }

    /**
     * 타임라인 동기화 페이로드를 전달받음. 뼈대가 없으면 미리보기 창 뼈대만 생성하고, 내용 채움은 인터벌에서 주기적으로 시도.
     * @param {(string|number)[]} payload
     */
    receiveTimelineSyncPayload(payload) {
        if (!Array.isArray(payload) || payload.length === 0) {
            this.debug('timeline_sync: receive 거부 (빈 페이로드)', {
                isArray: Array.isArray(payload),
                length: payload?.length,
            });
            return;
        }
        const numberCount = payload.filter((item) => typeof item === 'number' && !isNaN(item)).length;
        const stringCount = payload.filter((item) => typeof item === 'string').length;
        this.debug('timeline_sync: receive 수신', {
            length: payload.length,
            numberCount,
            stringCount,
            sample: payload.slice(0, 8),
        });
        this._incomingTimelineSyncPayload = payload;
        this._loggedTimelineSyncFillAttempt = false;
        this._loggedTimelineSyncWaitingConvert = false;
        if (!this._timelinePreviewWrap?.isConnected) {
            this.debug('timeline_sync: 미리보기 뼈대 생성');
            this._createTimelinePreviewSkeleton();
        } else {
            this.debug('timeline_sync: 미리보기 뼈대 이미 존재');
        }
    }
    
    // 미리보기 창 뼈대만 생성 (헤더·빈 목록 영역·푸터). 내용은 fillTimelinePreviewContent()에서 채움.
    _createTimelinePreviewSkeleton() {
        const wrap = document.createElement('div');
        wrap.className = 'vodSync-timeline-preview-wrap';
        wrap.style.cssText = 'position:fixed;right:16px;bottom:16px;width:420px;max-width:90vw;max-height:80vh;z-index:99999;display:flex;flex-direction:column;box-shadow:0 4px 20px rgba(0,0,0,0.2);border-radius:8px;overflow:hidden;background:#fff;';
        const panel = document.createElement('div');
        panel.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;';

        const header = document.createElement('div');
        header.style.cssText = 'padding:10px 12px;border-bottom:1px solid #eee;font-weight:bold;font-size:14px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:8px;';
        header.textContent = this.constructor.PANEL_HEADER;
        const collapseBtn = document.createElement('button');
        collapseBtn.type = 'button';
        collapseBtn.textContent = this.constructor.BTN_COLLAPSE;
        collapseBtn.style.cssText = 'padding:4px 10px;font-size:12px;cursor:pointer;';
        const bodyArea = document.createElement('div');
        bodyArea.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;';
        const listWrap = document.createElement('div');
        listWrap.style.cssText = 'overflow:auto;flex:1;min-height:120px;padding:8px;';
        const footer = document.createElement('div');
        footer.style.cssText = 'padding:10px 12px;border-top:1px solid #eee;display:flex;gap:8px;justify-content:flex-end;flex-shrink:0;';

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.textContent = this.constructor.BTN_COPY;
        copyBtn.style.cssText = 'padding:6px 12px;cursor:pointer;background:#1a73e8;color:#fff;border:none;border-radius:4px;font-size:12px;';
        copyBtn.addEventListener('click', () => {
            const rows = this._timelinePreviewRows;
            if (!rows || rows.length === 0) return;
            const text = rows.map(rowFrags =>
                rowFrags.map(f => f.type === 'string' ? f.value : (f.playbackSec != null ? this.formatPlaybackTimeAsComment(f.playbackSec).trim() : this.constructor.TIME_PLACEHOLDER + ' ')).join('')
            ).join('\n');
            if (text) navigator.clipboard.writeText(text).then(() => { copyBtn.textContent = this.constructor.BTN_COPIED; setTimeout(() => { copyBtn.textContent = this.constructor.BTN_COPY; }, 1500); }).catch(() => { copyBtn.textContent = this.constructor.BTN_COPY_FAILED; });
        });
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = this.constructor.BTN_CLOSE;
        closeBtn.style.cssText = 'padding:6px 12px;cursor:pointer;background:#666;color:#fff;border:none;border-radius:4px;font-size:12px;';
        closeBtn.addEventListener('click', () => {
            wrap.remove();
            this._timelinePreviewWrap = null;
            this._timelinePreviewListWrap = null;
            this._timelinePreviewRows = null;
        });

        collapseBtn.addEventListener('click', () => {
            const collapsed = bodyArea.style.display === 'none';
            bodyArea.style.display = collapsed ? 'flex' : 'none';
            collapseBtn.textContent = collapsed ? this.constructor.BTN_COLLAPSE : this.constructor.BTN_EXPAND;
        });

        header.appendChild(collapseBtn);
        footer.appendChild(copyBtn);
        footer.appendChild(closeBtn);
        bodyArea.appendChild(listWrap);
        bodyArea.appendChild(footer);
        panel.appendChild(header);
        panel.appendChild(bodyArea);
        wrap.appendChild(panel);
        document.body.appendChild(wrap);

        this._timelinePreviewWrap = wrap;
        this._timelinePreviewListWrap = listWrap;
    }

    // 수신한 페이로드로부터 변환된 타임라인 댓글 미리보기 목록 영역에 내용 채움. 내부에서 openTimelinePreview(rows) 호출.
    fillTimelinePreviewContent(payload) {
        if (!Array.isArray(payload) || payload.length === 0) {
            this.debug('timeline_sync: fill 거부 (빈 페이로드)');
            return;
        }
        const tsManager = window.VODSync?.tsManager;
        if (!tsManager?.canConvertGlobalTSToPlaybackTime()) {
            // 인터벌 재시도 중이므로 대기 로그는 1회만
            if (!this._loggedTimelineSyncWaitingConvert) {
                this._loggedTimelineSyncWaitingConvert = true;
                this.debug('timeline_sync: fill 대기 — canConvertGlobalTSToPlaybackTime=false', {
                    hasTsManager: !!tsManager,
                    hasVodInfo: tsManager?.vodInfo != null,
                });
            }
            return;
        }
        const globalTSToPlaybackTime = tsManager.globalTSToPlaybackTime;
        if (!globalTSToPlaybackTime) {
            this.debug('timeline_sync: fill 거부 — globalTSToPlaybackTime 없음');
            return;
        }
        this.debug('timeline_sync: fill 시작 (변환 가능)', { payloadLen: payload.length });

        // 페이로드 → 순서 유지 fragments (string | timeline), \n 기준으로 행 분리
        const fragments = [];
        let convertedOk = 0;
        let convertedNull = 0;
        let stringItems = 0;
        for (const item of payload) {
            const asGlobalMs = typeof item === 'number' && !isNaN(item)
                ? item
                : (typeof item === 'string' && /^\d{10,15}$/.test(String(item).trim())
                    ? parseInt(item, 10)
                    : NaN);
            if (!isNaN(asGlobalMs)) {
                const sec = globalTSToPlaybackTime.call(tsManager, asGlobalMs);
                if (sec != null) {
                    convertedOk++;
                    fragments.push({ type: 'timeline', playbackSec: Math.max(0, Math.floor(sec)) });
                } else {
                    convertedNull++;
                    fragments.push({ type: 'timeline', playbackSec: null });
                }
            } else if (typeof item === 'string') {
                stringItems++;
                fragments.push({ type: 'string', value: item });
            }
        }
        this.debug('timeline_sync: 페이로드 변환 결과', {
            fragments: fragments.length,
            convertedOk,
            convertedNull,
            stringItems,
            sampleTimeline: fragments.filter((f) => f.type === 'timeline').slice(0, 5),
        });

        const rows = [];
        let currentRow = [];
        for (const frag of fragments) {
            if (frag.type === 'string') {
                const parts = frag.value.split('\n');
                for (let i = 0; i < parts.length; i++) {
                    if (i > 0) {
                        rows.push(currentRow);
                        currentRow = [];
                    }
                    if (parts[i].length > 0) currentRow.push({ type: 'string', value: parts[i] });
                }
            } else {
                currentRow.push(frag);
            }
        }
        if (currentRow.length > 0) rows.push(currentRow);
        if (rows.length === 0) {
            this.debug('timeline_sync: fill 중단 — 행으로 분리된 결과 없음');
            return;
        }
        this.debug('timeline_sync: fill 완료 → openTimelinePreview', { rowCount: rows.length });

        this.openTimelinePreview(rows);
    }

    /** 미리보기 목록 영역에 행 데이터를 DOM으로 채움. openTimelinePreview → fillTimelinePreviewContent / openPreviewWithCurrentPageTimelineComments 에서 사용. */
    _renderPreviewRows(rows) {
        if (!this._timelinePreviewListWrap?.isConnected || !Array.isArray(rows) || rows.length === 0) {
            this.debug('timeline_sync: _renderPreviewRows 거부', {
                listConnected: !!this._timelinePreviewListWrap?.isConnected,
                isArray: Array.isArray(rows),
                length: rows?.length,
            });
            return;
        }
        const listWrap = this._timelinePreviewListWrap;
        listWrap.textContent = '';
        this.debug('timeline_sync: _renderPreviewRows 렌더', { rowCount: rows.length });

        rows.forEach((rowFragments) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;padding:6px 8px;border-radius:4px;margin-bottom:4px;border:1px solid #eee;font-size:13px;';
            for (const frag of rowFragments) {
                if (frag.type === 'string') {
                    const textSpan = document.createElement('span');
                    textSpan.style.whiteSpace = 'pre-wrap';
                    textSpan.textContent = frag.value;
                    row.appendChild(textSpan);
                } else {
                    if (frag.playbackSec == null) {
                        const placeholder = document.createElement('span');
                        placeholder.textContent = this.constructor.TIME_PLACEHOLDER;
                        placeholder.style.cssText = 'font-family:monospace;color:#999;';
                        // TODO: 치지직에서도 간단하게 element 구성만으로 이동이 가능하다면 굳이 이걸 타임라인부분에 이벤트리스너를 추가할 필요가 없음.
                        // timeEl.addEventListener('click', (e) => { e.stopPropagation(); if (moveToPlaybackTime) moveToPlaybackTime(frag.playbackSec, false); });
                        row.appendChild(placeholder);
                    } else {
                        const timeEl = this.createTimelineDisplayElement(frag.playbackSec);
                        const timeBtnStyle = 'min-width:24px;padding:4px 8px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid #ccc;border-radius:4px;background:#f5f5f5;color:#333;line-height:1;';
                        const btnMinus = document.createElement('button');
                        btnMinus.type = 'button';
                        btnMinus.textContent = this.constructor.BTN_TIME_MINUS;
                        btnMinus.style.cssText = timeBtnStyle;
                        btnMinus.title = '쉬프트를 누른 상태로 클릭하면 10초씩 감소';
                        const btnPlus = document.createElement('button');
                        btnPlus.type = 'button';
                        btnPlus.textContent = this.constructor.BTN_TIME_PLUS;
                        btnPlus.style.cssText = timeBtnStyle;
                        btnPlus.title = '쉬프트를 누른 상태로 클릭하면 10초씩 증가';
                        const setTimeBtnHover = (btn, hover) => {
                            btn.style.background = hover ? '#e0e0e0' : '#f5f5f5';
                            btn.style.borderColor = hover ? '#999' : '#ccc';
                        };
                        btnMinus.addEventListener('mouseenter', () => setTimeBtnHover(btnMinus, true));
                        btnMinus.addEventListener('mouseleave', () => setTimeBtnHover(btnMinus, false));
                        btnPlus.addEventListener('mouseenter', () => setTimeBtnHover(btnPlus, true));
                        btnPlus.addEventListener('mouseleave', () => setTimeBtnHover(btnPlus, false));
                        btnMinus.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const delta = e.shiftKey ? 10 : 1;
                            frag.playbackSec = Math.max(0, frag.playbackSec - delta);
                            if (timeEl._vodSyncUpdateTime) timeEl._vodSyncUpdateTime(frag.playbackSec);
                            else timeEl.textContent = this.getTimelineDisplayText(frag.playbackSec);
                        });
                        btnPlus.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const delta = e.shiftKey ? 10 : 1;
                            frag.playbackSec += delta;
                            if (timeEl._vodSyncUpdateTime) timeEl._vodSyncUpdateTime(frag.playbackSec);
                            else timeEl.textContent = this.getTimelineDisplayText(frag.playbackSec);
                        });
                        row.appendChild(timeEl);
                        row.appendChild(btnMinus);
                        row.appendChild(btnPlus);
                    }
                }
            }
            listWrap.appendChild(row);
        });
    }

    // 재생 시각(초)을 댓글용 시간 문자열로 포맷. 자식 클래스에서 오버라이드 가능.
    formatPlaybackTimeAsComment(playbackSec) {
        if (typeof playbackSec !== 'number' || playbackSec < 0 || !isFinite(playbackSec)) return '';
        const h = Math.floor(playbackSec / 3600);
        const m = Math.floor((playbackSec % 3600) / 60);
        const s = Math.floor(playbackSec % 60);
        if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} `;
        return `${m}:${String(s).padStart(2, '0')} `;
    }

    /**
     * 미리보기 패널에서 타임라인 한 칸에 표시할 문자열 (H:MM:SS 또는 M:SS). 자식에서 오버라이드 가능.
     * @param {number} playbackSec
     * @returns {string}
     */
    getTimelineDisplayText(playbackSec) {
        if (typeof playbackSec !== 'number' || playbackSec < 0 || !isFinite(playbackSec)) return this.constructor.TIME_PLACEHOLDER;
        const h = Math.floor(playbackSec / 3600);
        const m = Math.floor((playbackSec % 3600) / 60);
        const s = Math.floor(playbackSec % 60);
        if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    /**
     * 미리보기/댓글에 넣을 타임라인 한 칸 DOM 요소 생성. 플랫폼별로 오버라이드.
     * @param {number} playbackSec 재생 시각(초)
     * @returns {HTMLElement}
     */
    createTimelineDisplayElement(playbackSec) {
        const span = document.createElement('span');
        span.className = 'vodSync-timeline-preview-time';
        span.textContent = this.getTimelineDisplayText(playbackSec);
        span.style.cssText = 'font-family:monospace;font-size:13px;cursor:pointer;text-decoration:underline;';
        span._vodSyncUpdateTime = (sec) => { span.textContent = this.getTimelineDisplayText(sec); };
        return span;
    }

    _injectTinelineInsertButton() {
        const inputList = document.querySelectorAll(this.commentInputSelector);
        if (!inputList || inputList.length === 0) return;
        for (const input of inputList) {
            const existingButton = input.querySelector(`.${this.constructor.BTN_INSERT_CURRENT_TIME_CLASS}`);
            if (existingButton) continue;
            const buttonParent = input.querySelector(this.commentInputCurrentTimeButtonSlotSelector);
            if (!buttonParent) continue;
            const textarea = input.querySelector(this.commentInputTextareaSelector);
            if (!textarea)  continue;
            
            const button = document.createElement('button');
            button.type = 'button';
            button.className = this.constructor.BTN_INSERT_CURRENT_TIME_CLASS;
            this._applyStyle(button, this.insertCurrentTimeButtonStyle);
            button.addEventListener('mouseenter', () => this._applyStyle(button, this.insertCurrentTimeButtonHoverStyle));
            button.addEventListener('mouseleave', () => { button.style.backgroundColor = ''; });
            button.title = this.constructor.BTN_INSERT_CURRENT_TIME_LABEL;
            const span = document.createElement('span');
            span.textContent = this.constructor.BTN_INSERT_CURRENT_TIME_LABEL;
            span.style.font = '0/0 a';
            button.appendChild(span);
            const doInsert = () => {
                const tsManager = window.VODSync?.tsManager;
                if (!tsManager?.getCurPlaybackTime()) return;
                const currentTime = tsManager.getCurPlaybackTime();
                const currentTimeText = this.formatPlaybackTimeAsComment(currentTime);
                const selection = window.getSelection();
                const range = selection.rangeCount ? selection.getRangeAt(0) : null;
                if (range && textarea.contains(range.startContainer))
                    this.insertTimeTextAtRange(textarea, range, currentTimeText);
                else
                    this.insertTimeTextAtEnd(textarea, currentTimeText);
            };
            button.addEventListener('click', doInsert);
            input.addEventListener('keydown', (e) => {
                if (!e.altKey || e.key !== 't') return;
                if (textarea !== document.activeElement && !textarea.contains(document.activeElement)) return;
                e.preventDefault();
                doInsert();
            });
            buttonParent.appendChild(button);
        }
    }

    /** Range 위치에 현재 시간 텍스트를 삽입하고, 캐럿을 삽입된 텍스트 끝으로 둔다 */
    insertTimeTextAtRange(textarea, range, currentTimeText) {
        if (!textarea.contains(range.startContainer) || !textarea.contains(range.endContainer))
            return;

        range.deleteContents();
        const newTextNode = document.createTextNode(currentTimeText);
        range.insertNode(newTextNode);
        this._setCaretAfterNodeAndFocus(textarea, newTextNode);
    }

    /** textarea 끝에 현재 시간 텍스트를 붙이고, 캐럿을 삽입된 텍스트 끝으로 둔다 */
    insertTimeTextAtEnd(textarea, currentTimeText) {
        const newTextNode = document.createTextNode(currentTimeText);
        textarea.appendChild(newTextNode);
        this._setCaretAfterNodeAndFocus(textarea, newTextNode);
    }

    /** 텍스트 노드 끝에 캐럿을 두고 textarea에 포커스한다. */
    _setCaretAfterNodeAndFocus(textarea, node) {
        const range = document.createRange();
        range.setStart(node, node.length);
        range.setEnd(node, node.length);
        const sel = window.getSelection();
        if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
        }
        setTimeout(() => textarea.focus(), 0);
    }
}
        class SoopTimelineCommentProcessor extends TimelineCommentProcessorBase {
    /** 더보기 레이어 안 편집 구간 가져오기 버튼(SOOP 전용) */
    static CLIP_IMPORT_IN_MORE_CLASS = 'vodSync-timeline-clip-import-in-more';
    static BTN_CLIP_IMPORT_IN_MORE = '편집 구간으로 가져오기';
    static BTN_CLIP_IMPORT_IN_MORE_TOOLTIP = '본문에서 시간 ~ 시간 구간을 찾아 VOD 편집 구간으로 추가합니다';

    constructor() {
        super();
        // Selector override
        this.containerSelector = '#commentHighlight';
        this.commentRowSelector = 'li';
        this.commentTextSelector = '.cmmt-txt';
        this.checkboxSlotSelector = '.cmmt-header';
        this.commentInputSelector = 'section.cmmt_inp'; // 댓글 작성란 입력 요소
        this.commentInputCurrentTimeButtonSlotSelector = 'div.grid-start'; // 댓글 작성란 입력 요소 내부의 현재 시간 삽입 버튼 추가 슬롯
        this.commentInputTextareaSelector = 'div.write-inp'; // 댓글 작성란 입력 요소 내부의 텍스트 입력 요소

        // Style override
        this.checkboxWrapStyle.right = '30px';
    }

    /**
     * 한 개 이상의 댓글에서 미리보기용 세그먼트 생성.
     * @param {HTMLElement[]} rowEls 댓글 행 요소 배열
     * @returns {(string|number)[]}
     */
    buildSegmentsFromComments(commentEls) {
        const tsManager = window.VODSync?.tsManager;
        const result = [];
        let timeLinkCount = 0;
        let convertedCount = 0;
        let skippedNoGlobal = 0;
        this.debug('timeline_sync: buildSegmentsFromComments 시작', {
            commentCount: commentEls?.length ?? 0,
            hasPlaybackTimeToGlobalTS: !!tsManager?.playbackTimeToGlobalTS,
        });
        for (const commentEl of commentEls) {
            const cmmtTxt = commentEl?.querySelector('.cmmt-txt');
            if (!cmmtTxt) continue;
            const root = cmmtTxt.querySelector('p') || cmmtTxt;
            const nodes = root.childNodes;
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                if (node.nodeType === Node.TEXT_NODE) {
                    const t = node.textContent;
                    if (t) result.push(t);
                    continue;
                }
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                if (node.classList?.contains('best')) continue;
                if (node.tagName === 'BR') { result.push('\n'); continue; }
                if (node.classList?.contains('time_link') && node.hasAttribute('data-time')) {
                    timeLinkCount++;
                    const sec = parseInt(node.getAttribute('data-time'), 10);
                    if (!isNaN(sec) && tsManager?.playbackTimeToGlobalTS) {
                        const globalDate = tsManager.playbackTimeToGlobalTS(sec);
                        if (globalDate instanceof Date && !isNaN(globalDate.getTime())) {
                            convertedCount++;
                            result.push(globalDate.getTime());
                        } else {
                            skippedNoGlobal++;
                            this.debug('timeline_sync: time_link → globalTS 변환 실패', { sec, globalDate });
                        }
                    } else {
                        skippedNoGlobal++;
                        this.debug('timeline_sync: time_link 스킵', { sec, hasConverter: !!tsManager?.playbackTimeToGlobalTS });
                    }
                    continue;
                }
                const t = node.textContent?.trim();
                if (t) result.push(t);
            }
        }
        this.debug('timeline_sync: buildSegmentsFromComments 완료', {
            resultLen: result.length,
            timeLinkCount,
            convertedCount,
            skippedNoGlobal,
            sample: result.slice(0, 8),
        });
        return result;
    }

    /** Soop 댓글 타임라인 스타일: <a class="time_link">[ <strong class="time_link">HH:MM:SS</strong> ]</a> */
    createTimelineDisplayElement(playbackSec) {
        const sec = Math.floor(playbackSec);
        const a = document.createElement('a');
        a.setAttribute('data-time', String(sec));
        a.className = 'time_link';
        a.style.cursor = 'pointer';
        a.appendChild(document.createTextNode('[ '));
        const strong = document.createElement('strong');
        strong.className = 'time_link';
        strong.style.color = '#0182ff';
        strong.setAttribute('data-time', String(sec));
        strong.textContent = this.getTimelineDisplayText(playbackSec);
        a.appendChild(strong);
        a.appendChild(document.createTextNode(' ]'));
        const self = this;
        a._vodSyncUpdateTime = (s) => {
            const n = Math.floor(s);
            a.setAttribute('data-time', String(n));
            strong.setAttribute('data-time', String(n));
            strong.textContent = self.getTimelineDisplayText(s);
        };
        return a;
    }

    /** 단일 시각 토큰(예: 1:49:49)을 초로 변환. 편집 구간 가져오기 줄 파싱용. */
    parseHmsTokenToSeconds(token) {
        if (token == null || typeof token !== 'string') return null;
        return this.parsePlaybackSecondsFromText(token.trim());
    }

    /**
     * 한 줄에서 `앞글자 [ 01:02:03 ] ~ [ 4:05 ] 뒤글자` 또는 `1:02:03 ~ 4:05` 패턴을 찾는다(SOOP time_link 텍스트).
     * 앞·뒤 trim 후 공백으로 이은 문자열이 편집 구간 이름(둘 다 비면 이름 생략).
     * @returns {{ begin: number, end: number, name?: string }|null}
     */
    parseCommentLineForClipRange(line) {
        if (!line || typeof line !== 'string') return null;
        const hms = String.raw`\d{1,2}:\d{2}(?::\d{2})?`;
        const timeTok = String.raw`(?:\[\s*)?(${hms})(?:\s*\])?`;
        const m = line.match(new RegExp(String.raw`^([\s\S]*?)${timeTok}\s*~\s*${timeTok}\s*([\s\S]*)$`));
        if (!m) return null;
        const begin = this.parseHmsTokenToSeconds(m[2]);
        const end = this.parseHmsTokenToSeconds(m[3]);
        if (begin == null || end == null) return null;
        const left = m[1].trim();
        const right = m[4].trim();
        const name = [left, right].filter(Boolean).join(' ');
        return name ? { begin, end, name } : { begin, end };
    }

    /** 더보기 메뉴: 댓글에서 구간을 파싱해 편집 VOD 편집 구간으로 넘긴다. */
    importClipsFromCommentRow(rowEl) {
        const lines = this.getCommentLinesForClipImport(rowEl);
        const items = [];
        for (const line of lines) {
            const one = this.parseCommentLineForClipRange(line);
            if (one) items.push(one);
        }
        if (items.length === 0) {
            window.alert(
                '가져올 구간이 없습니다. "128강 1:49:49 ~ 1:54:48" 형식이 있는지 확인하세요.'
            );
            return;
        }
        const veditor = window.VODSync?.soopVeditorReplacement;
        if (!veditor || typeof veditor.importClipsFromParsedRanges !== 'function') {
            window.alert('VOD 편집 패널을 아직 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도하세요.');
            return;
        }
        veditor.importClipsFromParsedRanges(items);
    }

    _injectClipImportButtonIntoMoreLayer(layer, rowEl, closeMore) {
        if (!layer.querySelector(`.${this.constructor.CLIP_IMPORT_IN_MORE_CLASS}`)) {
            const clipBtn = document.createElement('button');
            clipBtn.type = 'button';
            clipBtn.className = this.constructor.CLIP_IMPORT_IN_MORE_CLASS;
            clipBtn.textContent = this.constructor.BTN_CLIP_IMPORT_IN_MORE;
            clipBtn.title = this.constructor.BTN_CLIP_IMPORT_IN_MORE_TOOLTIP;
            clipBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.importClipsFromCommentRow(rowEl);
                closeMore();
            });
            layer.appendChild(clipBtn);
        }
    }

    /** BR·블록 경계마다 줄을 나눠 `시간 ~ 시간` 줄 파싱에 쓴다. */
    getCommentLinesForClipImport(rowEl) {
        const cmmtTxt = rowEl?.querySelector('.cmmt-txt');
        if (!cmmtTxt) {
            const raw = this._extractTextContent(rowEl);
            return raw
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
        }
        const root = cmmtTxt.querySelector('p') || cmmtTxt;
        const lines = [];
        let buf = '';
        const flush = () => {
            const t = buf.trim();
            if (t) lines.push(t);
            buf = '';
        };
        for (let i = 0; i < root.childNodes.length; i++) {
            const node = root.childNodes[i];
            if (node.nodeType === Node.TEXT_NODE) {
                const t = node.textContent;
                if (t) buf += t;
                continue;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            if (node.classList?.contains('best')) continue;
            if (node.tagName === 'BR') {
                flush();
                continue;
            }
            const t = node.textContent;
            if (t) buf += t;
        }
        flush();
        return lines;
    }
}
        class SoopPrevChatViewer extends IVodSync {
    constructor() {
        super();
        this.restoreButton = null;
        this.settingsButton = null;
        this.buttonContainer = null;
        this.chatMemo = null; // chatMemo 참조 저장 (복구된 채팅 추가용)
        this.boxVstart = null; // boxVstart 참조 저장 (채팅 초기화 감지용)
        this.settingsPopup = null;
        this.isRestoring = false;
        this.checkInterval = null;
        // 복원 구간: startTime/endTime (playbackTime 기준)
        this._restoreTimeRange = null;
        this.vodInfo = null; // VOD 정보 캐시
        this.signatureEmoticon = null; // 시그니처 이모티콘 데이터 캐시
        this.defaultEmoticon = null; // 기본 이모티콘 데이터 캐시
        this.emoticonReplaceMap = new Map(); // 이모티콘 ID -> 이미지 HTML 매핑
        this.restoreInterval = 30; // 복원 구간 단위 (초)
        this.excludeEmoticonOnlyChat = false; // 이모티콘만으로 이루어진 채팅 복원 제외 여부
        this.autoRestoreEnabled = false; // 버튼 생성 시 1회 자동 복원 여부
        this.autoRestorePeriod = 30; // 자동 복원 시 불러올 구간 (초)
        this.initialRestoreEndTime = null; // statVBox 재생성 시점의 복구 끝지점 (playbackTime, 초 단위)
        this.sharedTooltip = null; // 재사용할 공통 툴팁 요소
        this._tooltipHideTimeout = null; // 툴팁 mouseleave 시 지연 숨김용
        this._soopUrls = window.VODSync?.SoopUrls || {};
        this.log('loaded');
        this.loadRestoreInterval();
        this.init();
    }

    // restoreTimeRange getter/setter (setter에서 자동으로 버튼 텍스트 업데이트)
    get nextRestorePlan() {return this._restoreTimeRange;}

    set nextRestorePlan(value) {
        this._restoreTimeRange = value;
        this.updateButtonText();
    }

    // 설정에서 복원 구간 불러오기
    async loadRestoreInterval() {
        // 크롬 확장 프로그램 환경에서만 설정 로드 (탬퍼몽키가 아닌 경우)
        if (window.VODSync?.IS_TAMPER_MONKEY_SCRIPT === true) {
            return;
        }
        try {
            const response = await chrome.runtime.sendMessage({ action: 'getAllSettings' });
            if (response && response.success && response.settings) {
                const interval = response.settings.soopRestoreInterval;
                if (interval !== undefined) {
                    this.restoreInterval = interval;
                    this.log(`복원 구간 설정 로드: ${interval}초`);
                }
                if (response.settings.soopExcludeEmoticonOnlyChat !== undefined) {
                    this.excludeEmoticonOnlyChat = response.settings.soopExcludeEmoticonOnlyChat;
                    this.log('이모티콘만 복원 제외 설정 로드:', this.excludeEmoticonOnlyChat);
                }
                if (response.settings.soopAutoRestoreChat !== undefined) {
                    this.autoRestoreEnabled = response.settings.soopAutoRestoreChat;
                    this.log('자동 복원 설정 로드:', this.autoRestoreEnabled);
                }
                if (response.settings.soopAutoRestorePeriod !== undefined) {
                    this.autoRestorePeriod = response.settings.soopAutoRestorePeriod;
                    this.log(`자동 복원 구간 설정 로드: ${this.autoRestorePeriod}초`);
                }
            }
        } catch (error) {
            this.log('복원 구간 설정 로드 실패:', error);
        }
    }

    // 복원 구간 설정 저장
    async saveRestoreInterval() {
        // 크롬 확장 프로그램 환경에서만 설정 저장 (탬퍼몽키가 아닌 경우)
        if (window.VODSync?.IS_TAMPER_MONKEY_SCRIPT === true) {
            return;
        }
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'saveSettings',
                settings: {
                    soopRestoreInterval: this.restoreInterval,
                    soopExcludeEmoticonOnlyChat: this.excludeEmoticonOnlyChat,
                    soopAutoRestoreChat: this.autoRestoreEnabled,
                    soopAutoRestorePeriod: this.autoRestorePeriod
                }
            });
            if (response && response.success) {
                this.log(`복원 구간 설정 저장: ${this.restoreInterval}초, 이모티콘만 제외: ${this.excludeEmoticonOnlyChat}, 자동 복원: ${this.autoRestoreEnabled} (${this.autoRestorePeriod}초)`);
            }
        } catch (error) {
            this.log('복원 구간 설정 저장 실패:', error);
        }
    }

    init() {
        // 공통 툴팁 요소 생성
        this.sharedTooltip = document.createElement('div');
        this.sharedTooltip.className = 'vodsync-chat-tooltip';
        this.sharedTooltip.style.cssText = `
            position: fixed;
            padding: 4px 8px;
            background: rgba(0, 0, 0, 0.85);
            color: white;
            border-radius: 4px;
            font-size: 12px;
            white-space: nowrap;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.1s;
            z-index: 10000;
        `;
        // 툴팁 클릭 시 해당 시점으로 이동 (툴팁만 클릭 가능하도록 여기서만 처리)
        this.sharedTooltip.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const sec = this.sharedTooltip.dataset.playbackTimeSeconds;
            if (sec === undefined || sec === '') return;
            const playbackTimeSeconds = parseInt(sec, 10);
            const tsManager = window.VODSync?.tsManager;
            if (tsManager && typeof tsManager.moveToPlaybackTime === 'function') {
                tsManager.moveToPlaybackTime(playbackTimeSeconds, true);
            }
            this.sharedTooltip.style.opacity = '0';
            this.sharedTooltip.style.pointerEvents = 'none';
        });
        this.sharedTooltip.addEventListener('mouseenter', () => {
            if (this._tooltipHideTimeout) {
                clearTimeout(this._tooltipHideTimeout);
                this._tooltipHideTimeout = null;
            }
        });
        this.sharedTooltip.addEventListener('mouseleave', () => {
            this._tooltipHideTimeout = setTimeout(() => {
                this._tooltipHideTimeout = null;
                if (this.sharedTooltip) {
                    this.sharedTooltip.style.opacity = '0';
                    this.sharedTooltip.style.pointerEvents = 'none';
                }
            }, 100);
        });
        document.body.appendChild(this.sharedTooltip);
        
        setTimeout(() => {
            this.checkInterval = setInterval(() => this.monitoringChatBoxVstartChange(), 500);
        }, 1000);
    }

    // boxVstart 변화 감지 및 채팅 초기화 처리
    monitoringChatBoxVstartChange() {
        if (this.boxVstart && this.boxVstart.isConnected) return;
        if (this.buttonContainer){
            this.buttonContainer.remove();
            this.buttonContainer = null;
            this.restoreButton = null; 
            this.settingsButton = null;
            this.chatMemo = null;
            this.boxVstart = null;
            this.initialRestoreEndTime = null; // statVBox 재생성 시 초기화
        }

        // ~ 이후에 저장된 채팅입니다. 메시지 찾기
        const boxVstart = document.getElementById('boxVstart');
        if (!boxVstart) return;

        const chatMemo = boxVstart.parentElement;
        if (!chatMemo) return;

        const chatArea = document.getElementById('chatArea');
        if (!chatArea) return;

        const video = document.querySelector('#video');
        if (!video || !video.src || video.readyState < 2) return;

        const tsManager = window.VODSync?.tsManager;
        if (!tsManager) {
            this.warn('SoopTimestampManager를 찾을 수 없습니다.');
            return;
        }

        const currentPlaybackTime = tsManager.getCurPlaybackTime();
        if (currentPlaybackTime === null) {
            this.warn('재생 시간을 가져올 수 없습니다.');
            return;
        }

        const endTime = currentPlaybackTime;
        const startTime = Math.max(0, currentPlaybackTime - this.restoreInterval);
        
        // statVBox 재생성 시점의 복구 끝지점 저장 (처음 세팅되는 시점)
        if (this.initialRestoreEndTime === null) {
            this.initialRestoreEndTime = endTime;
        }
        
        this.nextRestorePlan = { 
            startTime, 
            endTime
        };
        
        this.addRestoreButton(chatArea, chatMemo, boxVstart);
        this.log(`채팅 초기화 감지 및 복원 구간 설정: ${this.formatTime(startTime)} ~ ${this.formatTime(endTime)}`);
    }

    // 복원 버튼 추가
    addRestoreButton(chatArea, chatMemo, boxVstart) {
        // 버튼 컨테이너 생성
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; align-items: center; gap: 5px; margin: 10px; height:35px;';
        buttonContainer.setAttribute('data-vodsync-restore-container', 'true');

        const button = document.createElement('button');
        button.setAttribute('data-vodsync-restore', 'true');
        button.style.cssText = `
            padding: 8px 16px;
            background-color: #4CAF50;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
            width: 100%;
            height: 35px;
        `;
        button.addEventListener('click', () => this.restorePreviousChats());
        button.addEventListener('mouseenter', () => {
            if (!button.disabled) {
                button.style.backgroundColor = '#45a049';
            }
        });
        button.addEventListener('mouseleave', () => {
            if (!button.disabled) {
                button.style.backgroundColor = '#4CAF50';
            }
        });

        // 설정 버튼 생성
        const settingsBtn = document.createElement('button');
        settingsBtn.setAttribute('data-vodsync-settings', 'true');
        settingsBtn.innerHTML = '⚙️';
        settingsBtn.style.cssText = `
            padding: 8px 12px;
            background-color: #666;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            max-height: 35px;
        `;
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showSettingsPopup();
        });
        settingsBtn.addEventListener('mouseenter', () => settingsBtn.style.backgroundColor = '#555');
        settingsBtn.addEventListener('mouseleave', () => settingsBtn.style.backgroundColor = '#666');

        buttonContainer.appendChild(button);
        buttonContainer.appendChild(settingsBtn);

        // chatArea의 첫 번째 요소 앞에 버튼 컨테이너 추가
        chatArea.insertBefore(buttonContainer, chatArea.firstChild);
        this.buttonContainer = buttonContainer;
        this.restoreButton = button;
        this.settingsButton = settingsBtn;
        this.chatMemo = chatMemo;
        this.boxVstart = boxVstart;
        this.updateButtonText();
        this.tryAutoRestoreOnButtonCreate();
    }

    // 자동 복원이 켜져 있으면 버튼 생성 직후 1회 복원 (재생 시점 변경으로 버튼이 다시 생길 때마다 1회)
    tryAutoRestoreOnButtonCreate() {
        if (!this.autoRestoreEnabled || !this.nextRestorePlan) return;

        const { endTime } = this.nextRestorePlan;
        const startTime = Math.max(0, endTime - this.autoRestorePeriod);
        this.nextRestorePlan = { startTime, endTime };
        this.log(`자동 복원 실행: ${this.formatTime(startTime)} ~ ${this.formatTime(endTime)}`);
        this.restorePreviousChats();
    }

    // 채팅 복원 실행
    async restorePreviousChats() {
        if (this.isRestoring || !this.restoreButton || !this.nextRestorePlan) return;

        this.isRestoring = true;
        this.updateButtonText();

        try {
            const { startTime, endTime } = this.nextRestorePlan;
            const videoId = this.getVideoId();
            if (!videoId) throw new Error('VOD ID를 가져올 수 없습니다.');

            const soopAPI = window.VODSync?.soopAPI;
            if (!soopAPI) throw new Error('SoopAPI를 찾을 수 없습니다.');

            // vodInfo: 이모티콘 매핑, 설정 UI max(chat_duration)
            if (!this.vodInfo) {
                this.vodInfo = await soopAPI.GetSoopVodInfo(videoId);
                this.signatureEmoticon = await soopAPI.GetSignitureEmoticon(this.vodInfo?.data?.bj_id);
                this.defaultEmoticon = await soopAPI.GetEmoticon();
                this.buildEmoticonReplaceMap();
                this.log(`시그니처 이모티콘 로드 완료: ${this.signatureEmoticon}`);
                this.log(`기본 이모티콘 로드 완료: ${this.defaultEmoticon}`);
            }

            const messages = await this.fetchChatData(videoId, startTime, endTime);

            let filteredMessages = messages.filter(msg =>
                msg.timestamp >= startTime * 1000 && msg.timestamp <= endTime * 1000
            );

            let excludedCount = 0;
            if (this.excludeEmoticonOnlyChat) {
                const included = [];
                for (const msg of filteredMessages) {
                    if (this.isEmoticonOnlyMessage(msg)) {
                        excludedCount++;
                    } else {
                        included.push(msg);
                    }
                }
                filteredMessages = included;
            }

            let restoredCount = 0;
            if (filteredMessages.length > 0) {
                const chatElements = filteredMessages.map(msg => this.createChatElement(msg)).filter(el => el !== null);
                restoredCount = chatElements.length;
                this.insertChatsBelowButton(chatElements);
                this.log(`${restoredCount}개 채팅 복원 완료` + (excludedCount > 0 ? ` (${excludedCount}개 제외)` : ''));
            } else {
                this.log('복원할 채팅이 없습니다.');
            }

            // 다음 복원 구간 계산 (더 이전 restoreInterval만큼)
            const nextStart = Math.max(0, startTime - this.restoreInterval);
            const nextEnd = startTime;
            const suffix = excludedCount > 0
                ? ` - ${restoredCount}개, ${excludedCount} 제외`
                : ` - ${restoredCount}개`;
            this._restoreTimeRange = { startTime: nextStart, endTime: nextEnd };
            this.isRestoring = false;
            this.updateButtonText(suffix);

        } catch (error) {
            this.isRestoring = false;
            this.error('채팅 복원 오류:', error);
            if (this.restoreButton) {
                this.updateButtonText(' - 복원 실패, 다시 시도');
            }
        }
    }

    // GetChatLog로 복원 구간 채팅 fetch 후 파싱 (chunk·HTTP 캐시는 SoopAPI)
    async fetchChatData(videoId, startTimeSec, endTimeSec) {
        const soopAPI = window.VODSync?.soopAPI;
        if (!soopAPI) throw new Error('SoopAPI를 찾을 수 없습니다.');
        
        this.log(`채팅 로그 요청: ${startTimeSec}초 ~ ${endTimeSec}초`);
        
        const chatLogXml = await soopAPI.GetChatLog(videoId, startTimeSec, endTimeSec);
        if (!chatLogXml) {
            this.warn('채팅 로그를 가져올 수 없습니다.');
            return [];
        }

        const messages = this.parseChatLogXmlRaw(chatLogXml);
        this.log(`채팅 로그 수신: ${messages.length}개 메시지`);
        return messages;
    }

    // XML 파싱하여 메시지 데이터 반환 (필터링 없이 모든 메시지)
    parseChatLogXmlRaw(xmlText) {
        const messages = [];

        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "application/xml");

            const parserError = xmlDoc.querySelector("parsererror");
            if (parserError) {
                this.error("XML 파싱 오류:", parserError.textContent || parserError.innerText || '');
                return [];
            }

            Array.from(xmlDoc.querySelectorAll("root > chat, root > ogq")).forEach((chat) => {
                const msg = (chat.querySelector('m')?.textContent || '').trim();
                const timestampStr = (chat.querySelector('t')?.textContent || '').trim();
                const isOgq = chat.tagName.toLowerCase() === 'ogq';
                
                let pValue, p2Value;
                if (isOgq) {
                    const sfValue = (chat.querySelector('sf')?.textContent || '').trim();
                    [pValue, p2Value] = sfValue.split('|').map(v => v.trim());
                } else {
                    pValue = (chat.querySelector('p')?.textContent || '').trim();
                    p2Value = (chat.querySelector('p2')?.textContent || '').trim();
                }
                const nicknameColor = (chat.querySelector('nf')?.textContent || '').trim();
                const subscriptionMonths = (chat.querySelector('acfw')?.textContent || '').trim();
                
                const ogqGid = isOgq ? (chat.querySelector('gid')?.textContent || '').trim() : null;
                const ogqSid = isOgq ? (chat.querySelector('sid')?.textContent || '').trim() : null;
                const ogqVersion = isOgq ? (chat.querySelector('v')?.textContent || '').trim() : null;
                const ogqAnm = isOgq ? (chat.querySelector('anm')?.textContent || '').trim() : null;
                
                const userId = isOgq ? (chat.querySelector('s')?.textContent || '').trim() : (chat.querySelector('u')?.textContent || '').trim();
                const userNick = isOgq ? (chat.querySelector('sn')?.textContent || '').trim() : (chat.querySelector('n')?.textContent || '').trim();
                
                if (!timestampStr) return;

                const timestamp = parseFloat(timestampStr);
                if (isNaN(timestamp) || timestamp === 0) return;

                const timestampMs = Math.floor(timestamp * 1000);

                const p2Num = parseInt(p2Value || '0', 10);
                const subscriptionTier = ((p2Num & 0x80000) !== 0) ? 2 : 1;
                const badgeType = this.getBadgeType(pValue);
                const gradeValue = this.getGradeValue(pValue, subscriptionMonths);

                let ogqImageUrl = null;
                if (isOgq && ogqGid && ogqSid) {
                    const fileExtension = (ogqAnm === '1') ? 'webp' : 'png';
                    const ogqCdn = this._soopUrls.OGQ_STICKER_CDN_ORIGIN || 'https://ogq-sticker-global-cdn-z01.sooplive.com';
                    ogqImageUrl = `${ogqCdn}/sticker/${ogqGid}/${ogqSid}_80.${fileExtension}?ver=${ogqVersion || '1'}`;
                }

                const ogqPurchaseUrl = isOgq && ogqGid 
                    ? `${this._soopUrls.OGQ_MARKET_ORIGIN || 'https://ogqmarket.sooplive.com'}?m=detail&productId=${ogqGid}`
                    : null;

                messages.push({
                    userId, userNick, msg, timestamp: timestampMs, nicknameColor,
                    subscriptionMonths, subscriptionTier, badgeType, gradeValue,
                    isOgq, ogqImageUrl, ogqPurchaseUrl
                });
            });

            messages.sort((a, b) => a.timestamp - b.timestamp);
            return messages;
        } catch (error) {
            this.error('XML 파싱 오류:', error);
            return [];
        }
    }

    // 채팅 DOM 요소 생성
    createChatElement(chatData) {
        const { 
            userId, 
            userNick, 
            msg, 
            timestamp,
            nicknameColor, 
            subscriptionMonths, 
            subscriptionTier, 
            badgeType, 
            gradeValue,
            isOgq, 
            ogqImageUrl, 
            ogqPurchaseUrl 
        } = chatData;

        if (!userNick && !userId) {
            this.warn('채팅 데이터에 userNick과 userId가 없습니다:', chatData);
            return null;
        }

        const chatItem = document.createElement('div');
        chatItem.className = 'chatting-list-item';
        if (badgeType) {
            chatItem.setAttribute('user-type', badgeType);
        }

        const messageContainer = document.createElement('div');
        messageContainer.className = 'message-container';
        const usernameDiv = document.createElement('div');
        usernameDiv.className = 'username';
        const button = document.createElement('button');
        
        // 퍼스나콘 (구독 개월수 -1이면 표시 안함)
        const subscriptionMonthsNum = parseInt(subscriptionMonths || '-1', 10);
        if (subscriptionMonthsNum !== -1) {
            const thumb = document.createElement('span');
            thumb.className = 'thumb';
            const img = document.createElement('img');
            img.id = 'author';
            if (userId) {
                img.setAttribute('user_id', userId);
                img.setAttribute('user_nick', userNick || '');
                img.setAttribute('grade', gradeValue.toString());
                const personalconUrl = this.getPersonalconUrl(subscriptionMonths, subscriptionTier || 1);
                img.src = personalconUrl || `${this._soopUrls.RES_ORIGIN || 'https://res.sooplive.com'}/images/chatting/signature-default.svg`;
            } else {
                img.setAttribute('user_nick', userNick || '');
                img.setAttribute('grade', gradeValue.toString());
                img.src = `${this._soopUrls.RES_ORIGIN || 'https://res.sooplive.com'}/images/chatting/signature-default.svg`;
            }
            img.onerror = function() {
                this.src = `${window.VODSync?.SoopUrls?.RES_ORIGIN || 'https://res.sooplive.com'}/images/chatting/signature-default.svg`;
            };
            thumb.appendChild(img);
            button.appendChild(thumb);
        }
        
        // 배지
        if (badgeType) {
            const badge = document.createElement('span');
            if (badgeType === 'support') {
                badge.className = 'grade-badge-support';
                badge.setAttribute('tip', '서포터');
                badge.innerText = 'S';
            } else if (badgeType === 'vip') {
                badge.className = 'grade-badge-vip';
                badge.setAttribute('tip', '열혈팬');
                badge.innerText = '열';
            } else if (badgeType === 'subscribe') {
                badge.className = 'grade-badge-fan';
                badge.setAttribute('tip', '팬클럽');
                badge.innerText = 'F';
            } else if (badgeType === 'manager') {
                badge.className = 'grade-badge-manager';
                badge.setAttribute('tip', '매니저');
                badge.innerText = 'M';
            }
            badge.id = 'author';
            if (userId) badge.setAttribute('user_id', userId);
            badge.setAttribute('user_nick', userNick || '');
            badge.setAttribute('grade', gradeValue.toString());
            button.appendChild(badge);
        }
        
        // 사용자명
        const author = document.createElement('span');
        author.className = 'author random-color4';
        author.id = 'author';
        author.setAttribute('href', 'javascript:;');
        if (userId) author.setAttribute('user_id', userId);
        author.setAttribute('user_nick', userNick || '');
        author.setAttribute('grade', gradeValue.toString());
        author.innerText = userNick || '알 수 없음';
        if (nicknameColor) {
            author.style.color = `#${nicknameColor}`;
        }
        button.appendChild(author);
        usernameDiv.appendChild(button);

        // 메시지 텍스트
        const messageTextDiv = document.createElement('div');
        messageTextDiv.className = 'message-text';
        
        // OGQ 이모티콘
        if (isOgq && ogqImageUrl && ogqPurchaseUrl) {
            const emoticonBox = document.createElement('div');
            emoticonBox.className = 'emoticon-box';
            const imgBox = document.createElement('a');
            imgBox.className = 'img-box';
            imgBox.setAttribute('tip', '구매하기');
            imgBox.href = ogqPurchaseUrl;
            imgBox.target = '_blank';
            const ogqImg = document.createElement('img');
            ogqImg.className = 'ogqEmoticon';
            ogqImg.setAttribute('data-original-ext', ogqImageUrl.includes('.webp') ? 'webp' : 'png');
            ogqImg.style.cursor = 'pointer';
            ogqImg.src = ogqImageUrl;
            ogqImg.onerror = function() {
                this.src = `${window.VODSync?.SoopUrls?.RES_ORIGIN || 'https://res.sooplive.com'}/images/chat/ogq_default.png`;
            };
            imgBox.appendChild(ogqImg);
            emoticonBox.appendChild(imgBox);
            messageTextDiv.appendChild(emoticonBox);
        }
        
        const p = document.createElement('p');
        p.className = 'msg';
        p.style.color = '0';
        
        // 시그니처 이모티콘 처리
        if (msg && this.signatureEmoticon) {
            this.processSignatureEmoticons(p, msg);
        } else {
            p.innerText = msg || '';
        }
        
        // playbackTime 커스텀 툴팁 및 클릭 시 해당 시점으로 이동
        const playbackTimeSeconds = timestamp ? Math.floor(timestamp / 1000) : 0;
        if (timestamp && this.initialRestoreEndTime !== null && this.sharedTooltip) {
            const secondsAgo = Math.floor(this.initialRestoreEndTime - playbackTimeSeconds);

            let tooltipText;
            if (secondsAgo < 0) {
                tooltipText = this.formatTime(playbackTimeSeconds);
            } else if (secondsAgo === 0) {
                tooltipText = '방금 전';
            } else {
                const hours = Math.floor(secondsAgo / 3600);
                const minutes = Math.floor((secondsAgo % 3600) / 60);
                const seconds = secondsAgo % 60;
                const parts = [];
                if (hours > 0) parts.push(`${hours}시간`);
                if (minutes > 0) parts.push(`${minutes}분`);
                if (seconds > 0 || parts.length === 0) parts.push(`${seconds}초`);
                tooltipText = `${parts.join(' ')} 전`;
            }
            messageTextDiv.addEventListener('mouseenter', (e) => {
                if (!this.sharedTooltip) return;
                if (this._tooltipHideTimeout) {
                    clearTimeout(this._tooltipHideTimeout);
                    this._tooltipHideTimeout = null;
                }
                const rect = messageTextDiv.getBoundingClientRect();
                this.sharedTooltip.dataset.playbackTimeSeconds = String(playbackTimeSeconds);
                this.sharedTooltip.textContent = tooltipText;
                this.sharedTooltip.style.right = `${window.innerWidth - rect.right}px`;
                this.sharedTooltip.style.top = `${rect.top - 5}px`;
                this.sharedTooltip.style.opacity = '1';
                this.sharedTooltip.style.pointerEvents = 'auto';
                this.sharedTooltip.style.cursor = 'pointer';
            });
            messageTextDiv.addEventListener('mouseleave', (e) => {
                if (!this.sharedTooltip) return;
                if (e.relatedTarget === this.sharedTooltip) return;
                this._tooltipHideTimeout = setTimeout(() => {
                    this._tooltipHideTimeout = null;
                    if (this.sharedTooltip) {
                        this.sharedTooltip.style.opacity = '0';
                        this.sharedTooltip.style.pointerEvents = 'none';
                    }
                }, 100);
            });
        }

        messageTextDiv.appendChild(p);

        messageContainer.appendChild(usernameDiv);
        messageContainer.appendChild(messageTextDiv);
        chatItem.appendChild(messageContainer);

        return chatItem;
    }

    // 채팅을 버튼 컨테이너와 다음 요소 사이에 삽입
    insertChatsBelowButton(chatElements) {
        if (!this.chatMemo || chatElements.length === 0) return;

        const fragment = document.createDocumentFragment();
        chatElements.forEach(el => fragment.appendChild(el));

        // chatMemo의 첫 번째 요소 앞에 삽입
        if (this.chatMemo.firstChild) {
            this.chatMemo.insertBefore(fragment, this.chatMemo.firstChild);
        } else {
            this.chatMemo.appendChild(fragment);
        }
    }

    // 기본 버튼 문구 (nextRestorePlan + suffix 기준, 복원 중이면 복원 중 문구)
    generateRestoreButtonText(suffix = '') {
        if (this.isRestoring) return `이전 채팅 복원 (${this.restoreInterval}초) - 복원 중...`;
        if (!this.nextRestorePlan) return '이전 채팅 복원 준비 중';
        const { startTime, endTime } = this.nextRestorePlan;
        if (startTime === 0 && endTime === 0) return '영상의 시작 지점에 도달함';
        return `이전 채팅 복원 (${this.restoreInterval}초)${suffix}`;
    }

    // 버튼 텍스트 및 상태 업데이트 (nextRestorePlan / isRestoring 기준, suffix는 매개변수로 받음)
    updateButtonText(suffix = '') {
        if (!this.restoreButton) return;

        const atStart = this.nextRestorePlan && this.nextRestorePlan.startTime === 0 && this.nextRestorePlan.endTime === 0;
        const disabled = this.isRestoring || atStart;

        this.restoreButton.disabled = disabled;
        if (disabled) {
            this.restoreButton.style.backgroundColor = '#cccccc';
            this.restoreButton.style.color = '#333333';
            this.restoreButton.style.cursor = 'not-allowed';
            this.restoreButton.style.opacity = '0.6';
        } else {
            this.restoreButton.style.backgroundColor = '#4CAF50';
            this.restoreButton.style.color = 'white';
            this.restoreButton.style.cursor = 'pointer';
            this.restoreButton.style.opacity = '1';
        }

        this.restoreButton.innerText = this.generateRestoreButtonText(suffix);

        if (!this.nextRestorePlan) {
            this.restoreButton.title = '';
            return;
        }
        const { startTime, endTime } = this.nextRestorePlan;
        if (startTime !== undefined && endTime !== undefined) {
            if (startTime === 0 && endTime === 0) {
                this.restoreButton.title = '영상의 시작 지점에 도달함';
            } else {
                this.restoreButton.title = `다음 복원 구간: ${this.formatTime(startTime)} ~ ${this.formatTime(endTime)}`;
            }
        } else {
            this.restoreButton.title = '';
        }
    }

    // 초를 HH:MM:SS 형식으로 변환
    formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    // 시그니처 이모티콘 및 기본 이모티콘 매핑 데이터 생성
    buildEmoticonReplaceMap() {
        this.emoticonReplaceMap.clear();
        
        // 시그니처 이모티콘 처리
        if (this.signatureEmoticon?.data && this.signatureEmoticon?.img_path) {
            const imgPath = this.signatureEmoticon.img_path;
            const tier1 = this.signatureEmoticon.data.tier1 || [];
            const tier2 = this.signatureEmoticon.data.tier2 || [];
            const allEmoticons = [...tier1, ...tier2];

            allEmoticons.forEach(emoticon => {
                // move_img가 'Y'이면 pc_alternate_img 사용, 아니면 pc_img 사용
                const imgFileName = emoticon.move_img === 'Y' && emoticon.pc_alternate_img 
                    ? emoticon.pc_alternate_img 
                    : emoticon.pc_img;
                const imgUrl = imgPath + imgFileName;
                const imgHtml = `<img class="emoticon" src="${imgUrl}">`;
                
                // `/이모티콘ID/` -> `<img>` HTML 매핑
                this.emoticonReplaceMap.set(`/${emoticon.title}/`, imgHtml);
            });
        }

        // 기본 이모티콘 처리
        if (this.defaultEmoticon?.data) {
            // default 그룹 처리
            if (this.defaultEmoticon.data.default?.groups) {
                const defaultGroups = this.defaultEmoticon.data.default.groups;
                const defaultUrl = this.defaultEmoticon.data.default.small_url || this.defaultEmoticon.data.default.big_url;
                
                defaultGroups.forEach(group => {
                    if (group.emoticons) {
                        group.emoticons.forEach(emoticon => {
                            if (!emoticon.isDeprecated && emoticon.keyword && emoticon.fileName) {
                                const imgUrl = defaultUrl + emoticon.fileName;
                                const imgHtml = `<img class="emoticon" src="${imgUrl}">`;
                                this.emoticonReplaceMap.set(emoticon.keyword, imgHtml);
                            }
                        });
                    }
                });
            }

            // subscribe 그룹 처리
            if (this.defaultEmoticon.data.subscribe?.groups) {
                const subscribeGroups = this.defaultEmoticon.data.subscribe.groups;
                const subscribeUrl = this.defaultEmoticon.data.subscribe.small_url || this.defaultEmoticon.data.subscribe.big_url;
                
                subscribeGroups.forEach(group => {
                    if (group.emoticons) {
                        group.emoticons.forEach(emoticon => {
                            if (!emoticon.isDeprecated && emoticon.keyword && emoticon.fileName) {
                                // staticFileName이 있으면 사용, 없으면 fileName 사용
                                const imgFileName = emoticon.staticFileName || emoticon.fileName;
                                const imgUrl = subscribeUrl + imgFileName;
                                const imgHtml = `<img class="emoticon" src="${imgUrl}">`;
                                this.emoticonReplaceMap.set(emoticon.keyword, imgHtml);
                            }
                        });
                    }
                });
            }
        }
    }

    // 이모티콘만으로 이루어진 메시지 여부 (복원 제외 대상 판별용)
    isEmoticonOnlyMessage(chatData) {
        const { msg, isOgq } = chatData;
        // OGQ만 있고 텍스트가 없으면 이모티콘만
        if (isOgq && (!msg || !String(msg).trim())) {
            return true;
        }
        const text = (msg || '').trim();
        if (!text) return false;
        let rest = text;
        this.emoticonReplaceMap.forEach((_, pattern) => {
            rest = rest.split(pattern).join('');
        });
        return rest.trim() === '';
    }

    // 메시지 텍스트에서 시그니처 이모티콘 처리
    processSignatureEmoticons(pElement, msgText) {
        if (this.emoticonReplaceMap.size === 0) {
            pElement.innerText = msgText;
            return;
        }

        let processedText = msgText;
        
        // 매핑 데이터를 사용하여 모든 이모티콘 교체
        this.emoticonReplaceMap.forEach((imgHtml, emoticonPattern) => {
            processedText = processedText.replaceAll(emoticonPattern, imgHtml);
        });

        // HTML로 설정
        pElement.innerHTML = processedText;
    }

    // VOD ID 가져오기
    getVideoId() {
        const match = window.location.pathname.match(/\/player\/(\d+)/);
        return match ? match[1] : null;
    }

    // 구독 개월수에 맞는 퍼스나콘 이미지 URL 가져오기
    getPersonalconUrl(subscriptionMonths, subscriptionTier = 1) {
        if (!this.vodInfo?.data?.subscription_personalcon) {
            return null;
        }

        const monthsNum = parseInt(subscriptionMonths || '0', 10);
        if (isNaN(monthsNum) || monthsNum < 0) return null;

        const tier = subscriptionTier === 2 
            ? this.vodInfo.data.subscription_personalcon.tier2 
            : this.vodInfo.data.subscription_personalcon.tier1;
        
        if (!tier || tier.length === 0) return null;

        // monthsNum 이하인 것 중 가장 큰 값
        let bestMatch = null;
        for (const item of tier) {
            if (item.month <= monthsNum) {
                if (!bestMatch || item.month > bestMatch.month) {
                    bestMatch = item;
                }
            }
        }

        return bestMatch?.file_name || tier[0]?.file_name || null;
    }

    // p 태그 값에 따른 배지 타입 결정
    getBadgeType(pValue) {
        const pNum = parseInt(pValue || '0', 10);
        
        if ((pNum & 0x40) !== 0) return 'manager';
        if ((pNum & 0x8000) !== 0) return 'vip';
        if ((pNum & 0x20) !== 0) return 'subscribe';
        if ((pNum & 0x100000) !== 0) return 'support';
        return null;
    }

    // grade 속성 값 계산 (3: 팬클럽 이상, 6: 구독자, 5: 둘 다 아님)
    getGradeValue(pValue, subscriptionMonths) {
        const pNum = parseInt(pValue || '0', 10);
        const monthsNum = parseInt(subscriptionMonths || '-1', 10);
        
        const isFanClubOrVip = (pNum & 0x20) !== 0;
        const isSubscriber = monthsNum !== -1;
        
        if (isSubscriber) return 6;
        if (isFanClubOrVip) return 3;
        return 5;
    }

    // 설정 팝업 표시
    showSettingsPopup() {
        // 기존 팝업이 있으면 제거
        if (this.settingsPopup && this.settingsPopup.parentElement) {
            this.settingsPopup.remove();
        }

        if (!this.settingsButton) return;

        const maxDuration = this.vodInfo?.data?.chat_duration;

        // 설정 버튼의 위치 정보 가져오기
        const buttonRect = this.settingsButton.getBoundingClientRect();
        const popupWidth = 300; // min-width와 동일

        const popup = document.createElement('div');
        popup.style.cssText = `
            position: fixed;
            top: ${buttonRect.bottom}px;
            right: ${window.innerWidth - buttonRect.right}px;
            background: white;
            border: 2px solid #4CAF50;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.3);
            z-index: 10000;
            min-width: ${popupWidth}px;
        `;

        const title = document.createElement('div');
        title.innerText = '복원 구간 설정';
        title.style.cssText = 'font-size: 18px; font-weight: bold; margin-bottom: 15px;';

        const label = document.createElement('div');
        label.innerText = `복원 구간: ${this.restoreInterval}초`;
        label.id = 'vodsync-interval-label';
        label.style.cssText = 'margin-bottom: 10px; font-size: 14px;';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '10';
        slider.max = String(maxDuration || 300);
        slider.step = '10';
        slider.value = String(this.restoreInterval);
        slider.style.cssText = 'width: 100%; margin-bottom: 15px;';

        slider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value, 10);
            label.innerText = `복원 구간: ${value}초`;
        });

        const excludeEmoticonOnlyLabel = document.createElement('label');
        excludeEmoticonOnlyLabel.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 15px; font-size: 14px; cursor: pointer;';
        const excludeEmoticonOnlyCheck = document.createElement('input');
        excludeEmoticonOnlyCheck.type = 'checkbox';
        excludeEmoticonOnlyCheck.checked = this.excludeEmoticonOnlyChat;
        excludeEmoticonOnlyLabel.appendChild(excludeEmoticonOnlyCheck);
        excludeEmoticonOnlyLabel.appendChild(document.createTextNode('이모티콘만으로 이루어진 채팅 복원 제외'));

        const autoRestoreLabel = document.createElement('label');
        autoRestoreLabel.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 14px; cursor: pointer;';
        const autoRestoreCheck = document.createElement('input');
        autoRestoreCheck.type = 'checkbox';
        autoRestoreCheck.checked = this.autoRestoreEnabled;
        autoRestoreLabel.appendChild(autoRestoreCheck);
        autoRestoreLabel.appendChild(document.createTextNode('버튼 생성 시 자동 복원 (1회)'));

        const autoRestorePeriodLabel = document.createElement('div');
        autoRestorePeriodLabel.innerText = `자동 복원 구간: ${this.autoRestorePeriod}초`;
        autoRestorePeriodLabel.id = 'vodsync-auto-restore-period-label';
        autoRestorePeriodLabel.style.cssText = 'margin-bottom: 10px; font-size: 14px;';

        const autoRestorePeriodSlider = document.createElement('input');
        autoRestorePeriodSlider.type = 'range';
        autoRestorePeriodSlider.min = '10';
        autoRestorePeriodSlider.max = String(maxDuration || 300);
        autoRestorePeriodSlider.step = '10';
        autoRestorePeriodSlider.value = String(this.autoRestorePeriod);
        autoRestorePeriodSlider.style.cssText = 'width: 100%; margin-bottom: 15px;';
        autoRestorePeriodSlider.disabled = !this.autoRestoreEnabled;

        const syncAutoRestorePeriodControls = (enabled) => {
            autoRestorePeriodSlider.disabled = !enabled;
            autoRestorePeriodLabel.style.opacity = enabled ? '1' : '0.5';
        };
        autoRestoreCheck.addEventListener('change', () => {
            syncAutoRestorePeriodControls(autoRestoreCheck.checked);
        });
        autoRestorePeriodSlider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value, 10);
            autoRestorePeriodLabel.innerText = `자동 복원 구간: ${value}초`;
        });

        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; gap: 10px; justify-content: flex-end;';

        const cancelBtn = document.createElement('button');
        cancelBtn.innerText = '취소';
        cancelBtn.style.cssText = `
            padding: 8px 16px;
            background-color: #ccc;
            color: black;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        `;
        cancelBtn.addEventListener('click', () => {
            popup.remove();
        });

        const saveBtn = document.createElement('button');
        saveBtn.innerText = '저장';
        saveBtn.style.cssText = `
            padding: 8px 16px;
            background-color: #4CAF50;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        `;
        saveBtn.addEventListener('click', async () => {
            const newInterval = parseInt(slider.value, 10);
            this.restoreInterval = newInterval;
            this.excludeEmoticonOnlyChat = excludeEmoticonOnlyCheck.checked;
            this.autoRestoreEnabled = autoRestoreCheck.checked;
            this.autoRestorePeriod = parseInt(autoRestorePeriodSlider.value, 10);
            this.log(`복원 구간 단위 변경: ${newInterval}초, 이모티콘만 제외: ${this.excludeEmoticonOnlyChat}, 자동 복원: ${this.autoRestoreEnabled} (${this.autoRestorePeriod}초)`);

            // 설정 저장
            await this.saveRestoreInterval();
            
            // 현재 restoreTimeRange가 있으면 새로운 interval로 재계산
            if (this.nextRestorePlan) {
                const { endTime } = this.nextRestorePlan;
                const nextStart = Math.max(0, endTime - this.restoreInterval);
                this.nextRestorePlan = { startTime: nextStart, endTime: endTime };
            }

            popup.remove();
        });

        buttonContainer.appendChild(cancelBtn);
        buttonContainer.appendChild(saveBtn);

        popup.appendChild(title);
        popup.appendChild(label);
        popup.appendChild(slider);
        popup.appendChild(excludeEmoticonOnlyLabel);
        popup.appendChild(autoRestoreLabel);
        popup.appendChild(autoRestorePeriodLabel);
        popup.appendChild(autoRestorePeriodSlider);
        popup.appendChild(buttonContainer);

        document.body.appendChild(popup);
        this.settingsPopup = popup;
    }
}
        /**
 * SOOP VOD 편집 UI — `button.video_edit` 직접 처리, 패널 재사용(숨김/표시).
 * 확장(브리지 있음): `soop_content` 가 주입한 `VodCorePageBridge` 가 `#__vs_vodcore_ghost`에 playingTime·총 길이를 쓰고
 * `data-vs-seek`로 시크해 `window.vodCore`와 맞춘다.
 * 재생·시크는 `tsManager` 우선; 재생 어댑터(`window.VODSync.getVodCore`)를 통해 메타/명령을 통일한다.
 * @typedef {{ name: string, begin: number, end: number, visibleOnTimeline?: boolean }} VeditorClip
 * @typedef {{ startTime: number, endTime: number, duration: number, idx: number, sectionIdx: number }} VeditorApiClip
 *
 * 역할 맵 (편집기 뼈대 — 메서드·필드는 이 경계를 기준으로 묶인다).
 *
 * 1) 오버레이 수명주기 — `video_edit` 감지, 패널 표시/숨김, DOM 1회 마운트.
 *    진입점: `_scanVideoEditButtons`, `_showPanel`, `_hidePanel`, `_mountOverlayDom`
 *
 * 2) 편집 구간 모델 — 구간 배열, 선택 인덱스, undo, 검증.
 *    진입점: `_getClips`, `_clipAdd(begin,end,name?)`, `_recordClipUndo`, `_clipValidate`, `importClipsFromParsedRanges`
 *
 * 3) 타임라인 뷰 — px/s, 눈금·트랙·편집 구간 그래프, 휠/스크롤바, 도구 모드.
 *    진입점: `_syncUiFromState`, `_renderRuler`, `_renderClipsOnTrack`, `_bindTimelineWheel`
 *
 * 4) 재생·시크 — tsManager·vodCore(보간)·`<video>` 플레이헤드, 연속/구간 재생 RAF.
 *    진입점: `_refreshCachedGlobalPlaybackTime`, `_plSeekGlobal`, `_playAllClips`, `SoopVeditorReplacement.ClipBoundaryPlayback`
 *
 * 5) 게시 — 모달·카테고리·API 제출. 모달 차단: 총 길이 15초 미만 또는 30분 이상. 3초 미만 구간이 있으면 경고 alert만(모달·게시 시도는 가능). 페이로드는 유효 구간을 공식 API에 전달.
 *    진입점: `_onPublishButtonClick`, `_submitPublishModal`
 *
 * 데이터 변경 후 UI 일괄 갱신: `_syncUiFromState()` (조율자).
 */

class SoopVeditorReplacement extends IVodSync {
    static VEDITOR_API_SLOT_COUNT = 5;
    static VEDITOR_HOUR_SEC = 3600;
    /** px/초 — 뷰포트·총 길이를 알 수 없을 때만 사용 (전체 타임라인 맞춤 시에는 더 작게 허용). */
    static MIN_PPS_ABS_FLOOR = 0.02;
    static MAX_PPS = 800;
    /** 휠 deltaY 를 픽셀 단위로 맞춘 뒤 `pps *= exp(-dy * 이 값)` — 작을수록 줌이 완만함. */
    static ZOOM_WHEEL_EXP_PER_PX = 0.001125;
    static RULER_HEIGHT_PX = 17;
    static MAX_RULER_TICKS = 200;
    static TIMELINE_SCROLL_THUMB_MIN_PX = 28;
    static MAX_MINOR_TICKS = 600;
    static CLIP_MIN_DURATION = 0.05;
    /** 편집 패널 배속 드롭다운 값 (표시는 n×). */
    static PLAYBACK_SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    /** 타임라인 복사 `<select>` 안내 항목 — 복사 후 이 값으로 되돌려 같은 형식을 연속 선택할 수 있게 함. */
    static TIMELINE_COPY_PROMPT_VALUE = '_vs_timeline_copy_prompt';
    /** 시크 후 stale 시각이 end 뒤로 남아 있을 때 종료·다음 편집 구간 오판 방지 — 이 여유 안으로 들어와야 ‘현재 편집 구간 재생 중’으로 본다. */
    static PLAYBACK_CLIP_ENTRY_BEGIN_EPS = 0.15;
    static PLAYBACK_CLIP_ENTRY_END_SLACK = 0.4;
    /** 편집 오버레이 인라인 CSS — 탬퍼몽키는 본 클래스만 추출하므로 여기에 둔다. */
    static OverlayInlineStyles = class {
        static cssText() {
            return `            .vs-veditor-overlay { position: fixed; left: 0; right: 0; top: 0; bottom: 0; z-index: 2147483000;
              display: none; flex-direction: column; align-items: stretch; justify-content: flex-end; padding: 0; margin: 0;
              box-sizing: border-box; pointer-events: none; }
            /* 공통 떠 있는 패널 스킨 — 타임라인·편집 구간 목록은 각각 별도 엘리먼트로 shell에 나란히 붙음 */
            .vs-veditor-overlay-panel {
              pointer-events: auto; box-sizing: border-box; border-radius: 0;
              box-shadow: 0 -6px 36px rgba(0,0,0,0.5); border: 1px solid var(--vs-border, #2a2e33); border-bottom: none; margin: 0;
              max-height: min(78vh, 920px); overflow-x: hidden; overflow-y: auto;
              padding: 12px 12px 14px; background: var(--vs-bg); }
            .vs-veditor-dock-row {
              display: flex; flex-direction: row; flex-wrap: nowrap; align-items: flex-end; align-content: flex-start;
              justify-content: flex-start; gap: 0; width: 100%; pointer-events: none; }
            .vs-veditor-dock-row > .vs-veditor-overlay-panel { pointer-events: auto; }
            .vs-veditor-timeline-panel {
              flex: 0 0 auto;
              width: 75%; max-width: 75%;
              min-width: 0;
              padding-bottom: 4px; }
            .vs-veditor-clip-panel {
              flex: 0 0 auto;
              width: 25%; max-width: 25%;
              min-width: 0;
              /* 뷰포트 높이의 약 절반 — 고정 박스, 내부만 스크롤 */
              height: 50vh;
              max-height: 50vh;
              min-height: 0;
              display: flex;
              flex-direction: column;
              overflow: hidden;
              align-self: flex-end; }
            .vs-veditor-clip-panel.vs-collapsed {
              height: auto; max-height: none; overflow: visible; }
            .vs-veditor-clip-panel.vs-collapsed > .vs-veditor-clip-col {
              flex: none; overflow: visible; min-height: auto; }
            .vs-veditor-clip-panel.vs-collapsed .vs-veditor-clip-scroll {
              display: none; }
            .vs-veditor-clip-panel-head {
              font-weight: 600; font-size: 13px; margin: 0 0 8px; color: #e8eaed; letter-spacing: 0.02em;
              flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
            .vs-veditor-clip-panel-head-actions {
              display: flex; align-items: center; gap: 6px; flex-shrink: 1; min-width: 0; justify-content: flex-end; }
            .vs-veditor-clip-panel-head .vs-veditor-playback-speed.vs-veditor-timeline-copy-action {
              flex: 1 1 auto; width: auto; min-width: 9em; max-width: 15em; max-height: 26px; box-sizing: border-box; }
            .vs-veditor-clip-panel-toggle {
              padding: 2px 8px; min-height: 22px; border-radius: 4px; font-size: 12px; flex: 0 0 auto; }
            .vs-veditor-clip-panel > .vs-veditor-json-toolbar { flex-shrink: 0; }
            .vs-veditor-root {
              --vs-bg: #0c0d10;
              --vs-panel: #12141a;
              --vs-border: #2a2e33;
              --vs-muted: #8b95a5;
              --vs-accent: #00d4e8;
              --vs-accent-dim: #0099aa;
              --vs-playhead-glow: rgba(0, 212, 232, 0.35);
              --vs-clip-fill: rgba(0, 140, 130, 0.42);
              --vs-clip-fill-sel: rgba(0, 180, 170, 0.52);
              --vs-clip-border: #00a896;
              --vs-clip-border-sel: #40d4c8;
              box-sizing: border-box; font-family: inherit; color: #e8eaed; background: var(--vs-bg);
              border: none; border-radius: 0; padding: 0; margin: 0; width: 100%; max-width: 100%;
              position: relative; z-index: 1; display: flex; flex-direction: column; gap: 8px; min-width: 0;
              background: transparent; }
            .vs-veditor-clip-panel .vs-veditor-json-panel {
              display: none; margin-top: 8px; flex-shrink: 1; min-height: 0; max-height: 28vh; overflow: auto; }
            .vs-veditor-clip-panel .vs-veditor-json-panel.vs-open { display: block; }
            .vs-veditor-clip-panel .vs-veditor-json-toolbar { margin-top: 6px; }
            .vs-veditor-root * { box-sizing: border-box; }
            .vs-veditor-title-head { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
            .vs-veditor-title { font-weight: 600; margin-bottom: 0; font-size: 14px; flex: 0 1 auto; min-width: 0; }
            .vs-veditor-title-row { display: flex; align-items: center; justify-content: space-between; gap: 10px;
              margin-bottom: 6px; flex-wrap: wrap; position: relative; }
            .vs-veditor-title-actions { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; }
            .vs-veditor-seq-col {
              width: 100%; min-width: 0;
              display: flex; flex-direction: column; gap: 6px;
              height: max-content; max-height: max-content; overflow: hidden;
              contain: layout; }
            .vs-veditor-clip-col {
              width: 100%; min-width: 0; min-height: 0;
              flex: 1 1 0;
              display: flex; flex-direction: column; gap: 6px;
              overflow: hidden; }
            .vs-veditor-seq-header {
              flex: 0 0 34px; width: 34px; min-width: 34px;
              display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 6px;
              padding: 4px; background: var(--vs-panel); border: 1px solid var(--vs-border); border-radius: 4px;
              font-size: 12px; color: var(--vs-muted); }
            .vs-veditor-timecode { font-family: ui-monospace, monospace; color: var(--vs-accent); font-size: 12px; }
            .vs-veditor-seq-head-right { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; }
            .vs-veditor-clip-toolbar {
              display: flex; flex-direction: column; gap: 6px; padding: 6px; background: var(--vs-panel);
              border: 1px solid var(--vs-border); border-radius: 4px; flex-shrink: 0; }
            .vs-veditor-clip-toolbar-row { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
            .vs-veditor-title-inline-actions {
              justify-content: center; padding: 0; margin: 0;
              position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
              background: transparent; border: none; }
            .vs-veditor-clip-total { font-size: 14px; color: var(--vs-muted); margin-left: auto; }
            .vs-veditor-clip-play-status {
              font-size: 12px; color: #ffd8d8; margin-left: 8px; white-space: nowrap; }
            .vs-veditor-clip-scroll {
              flex: 1 1 0;
              min-height: 0;
              overflow: auto;
              border: 1px solid var(--vs-border); border-radius: 4px; background: #0a0b0e; padding: 4px; }
            .vs-veditor-clip-list-empty { padding: 12px; font-size: 12px; color: var(--vs-muted); text-align: center; }
            .vs-veditor-clip-row {
              border: 1px solid var(--vs-border); border-radius: 4px; margin-bottom: 6px; padding: 6px;
              background: #15171c; cursor: pointer; }
            .vs-veditor-clip-row.vs-veditor-clip-add-row {
              cursor: default; display: flex; align-items: center; justify-content: center;
              margin-bottom: 0; min-height: 0; }
            .vs-veditor-clip-add-btn {
              width: 30px; height: 30px; min-width: 30px; min-height: 30px;
              border-radius: 50%; padding: 0; margin: 0;
              display: flex; align-items: center; justify-content: center;
              font-size: 18px; font-weight: 300; line-height: 1; font-family: system-ui, sans-serif;
              color: var(--vs-accent);
              background: rgba(0, 212, 232, 0.12);
              border: 2px dashed var(--vs-accent-dim);
              cursor: pointer;
              box-sizing: border-box;
              transition: background 0.12s, border-color 0.12s, transform 0.12s; }
            .vs-veditor-clip-add-btn:hover {
              background: rgba(0, 212, 232, 0.22);
              border-style: solid;
              border-color: var(--vs-accent);
              transform: scale(1.04); }
            .vs-veditor-clip-add-btn:active { transform: scale(0.98); }
            .vs-veditor-clip-row--selected {
              border-color: var(--vs-clip-border-sel); box-shadow: 0 0 0 1px rgba(0, 180, 170, 0.25); }
            .vs-veditor-clip-row-line {
              display: grid;
              grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
              align-items: center;
              gap: 8px;
              min-width: 0; }
            .vs-veditor-clip-row-left {
              display: flex; align-items: center; gap: 6px; min-width: 0; }
            .vs-veditor-clip-row-center {
              display: flex; align-items: center; justify-content: center; gap: 4px;
              flex-wrap: nowrap; }
            .vs-veditor-clip-row-right {
              display: flex; align-items: center; justify-content: flex-end; gap: 6px; min-width: 0; }
            .vs-veditor-clip-name { flex: 1 1 auto; min-width: 0; font-size: 12px; padding: 3px 5px;
              background: #1a1d24; border: 1px solid #3d4450; color: #e8eaed; border-radius: 3px; }
            .vs-veditor-clip-dur {
              flex: 0 0 auto; font-size: 12px; color: var(--vs-muted);
              font-family: ui-monospace, "Cascadia Mono", "Consolas", monospace; }
            .vs-veditor-clip-drag-handle {
              flex: 0 0 auto;
              width: 22px; min-width: 22px; height: 22px;
              display: inline-flex; align-items: center; justify-content: center;
              border: none; border-radius: 4px; background: transparent; color: #9aa4b5;
              cursor: grab; user-select: none; padding: 0; font-size: 12px; line-height: 1; }
            .vs-veditor-clip-drag-handle:active { cursor: grabbing; }
            .vs-veditor-clip-drag-handle:disabled { opacity: 0.45; cursor: default; }
            .vs-veditor-clip-time-tilde {
              flex: 0 0 auto; color: var(--vs-muted); font-size: 13px; line-height: 1;
              font-family: ui-monospace, "Cascadia Mono", "Consolas", monospace;
              user-select: none; padding: 0 1px; }
            .vs-veditor-clip-time-inp {
              flex: 0 0 auto; min-width: 11.5ch; width: 12ch; max-width: 100%;
              font-family: ui-monospace, "Cascadia Mono", "Consolas", monospace;
              font-size: 13px; line-height: 1.3;
              text-align: center;
              padding: 5px 6px;
              background: #0d1117; border: 1px solid #4a5568; color: #e8eaed; border-radius: 4px;
              outline: none; box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
              transition: border-color 0.12s, box-shadow 0.12s; }
            .vs-veditor-clip-time-inp:hover { border-color: #6b7585; }
            .vs-veditor-clip-time-inp:focus {
              border-color: var(--vs-accent);
              box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 0 0 2px rgba(0, 212, 232, 0.22); }
            .vs-veditor-clip-time-inp::-webkit-outer-spin-button,
            .vs-veditor-clip-time-inp::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
            .vs-veditor-clip-time-inp[type="number"] { -moz-appearance: textfield; appearance: textfield; }
            .vs-veditor-btn-icon { padding: 2px 8px; min-width: 2em; }
            .vs-veditor-clip-eye-btn {
              display: inline-flex; align-items: center; justify-content: center;
              padding: 2px 4px; min-width: 28px; min-height: 26px; box-sizing: border-box; }
            .vs-veditor-clip-eye-btn svg { display: block; width: 16px; height: 16px; flex-shrink: 0; }
            .vs-veditor-clip-eye-btn svg,
            .vs-veditor-clip-eye-btn svg * { pointer-events: none; }
            .vs-veditor-clip-eye-btn--off { color: #8b95a8; }
            .vs-veditor-timeline-dock {
              width: 100%; min-width: 0; flex: 0 0 auto; flex-grow: 0; flex-shrink: 0;
              display: flex; flex-direction: row; align-items: stretch; gap: 6px;
              height: max-content; max-height: max-content; overflow: visible; }
            .vs-veditor-timeline-graph-col {
              flex: 1 1 auto; min-width: 0;
              display: flex; flex-direction: column; gap: 6px; }
            .vs-veditor-timeline-viewport { display: block; width: 100%; max-width: none; overflow-x: hidden; overflow-y: hidden;
              height: 66px; max-height: 66px; min-height: 66px; background: #0a0b0e; border: 1px solid var(--vs-border);
              border-radius: 4px; position: relative; flex-grow: 0; flex-shrink: 0; }
            .vs-veditor-timeline-scroll-wrap { width: 100%; margin-top: 0; flex-shrink: 0; user-select: none; }
            .vs-veditor-timeline-scroll-track { position: relative; height: 14px; border-radius: 7px; background: #1e2228;
              border: 1px solid #3d4450; cursor: pointer; box-sizing: border-box; }
            .vs-veditor-timeline-scroll-thumb { position: absolute; top: 1px; height: calc(100% - 2px); left: 0;
              min-width: 28px; border-radius: 6px; background: linear-gradient(180deg, #4a7a82 0%, #3a5c62 100%);
              border: 1px solid #5a9098; box-sizing: border-box; cursor: grab; touch-action: none; }
            .vs-veditor-timeline-scroll-thumb:active { cursor: grabbing; }
            .vs-veditor-timeline-scroll-wrap.vs-disabled .vs-veditor-timeline-scroll-thumb { cursor: default; opacity: 0.85; }
            .vs-veditor-timeline-inner { position: relative; height: 66px; min-height: 66px; max-height: 66px;
              overflow: hidden;
              box-sizing: border-box; }
            .vs-veditor-ruler { position: absolute; left: 0; top: 0; right: 0; height: 17px; z-index: 6;
              pointer-events: auto; }
            .vs-veditor-tick-major { position: absolute; top: 0; bottom: 0; border-left: 1px solid #4a5568; padding-left: 2px; }
            .vs-veditor-tick-minor { position: absolute; top: 10px; bottom: 0; left: 0; width: 0; border-left: 1px solid #2f3540;
              padding: 0; pointer-events: none; }
            .vs-veditor-track { position: absolute; left: 0; right: 0; top: 19px; bottom: 3px; background: #14181d;
              pointer-events: auto; }
            .vs-veditor-playhead { position: absolute; top: 0; bottom: 0; width: 13px; margin-left: -6px; z-index: 12;
              pointer-events: auto; cursor: ew-resize; touch-action: none; }
            .vs-veditor-playhead-line { position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; margin-left: -1px;
              background: var(--vs-accent); box-shadow: 0 0 6px var(--vs-playhead-glow); pointer-events: none; }
            .vs-veditor-playhead-head { position: absolute; left: 50%; top: 0; width: 11px; height: 15px; margin-left: -5px;
              background: linear-gradient(180deg, #33e4f5 0%, var(--vs-accent) 100%); border-radius: 2px 2px 1px 1px;
              border: 1px solid var(--vs-accent-dim); pointer-events: none; box-shadow: 0 1px 4px rgba(0,0,0,0.45); }
            .vs-veditor-clip { position: absolute; top: 4px; bottom: 4px; background: var(--vs-clip-fill);
              border: 1px solid var(--vs-clip-border); border-radius: 2px; pointer-events: auto; z-index: 1; }
            .vs-veditor-clip.vs-selected { background: var(--vs-clip-fill-sel); border-color: var(--vs-clip-border-sel); z-index: 2; }
            .vs-veditor-clip-order {
              position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
              max-width: calc(100% - 18px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
              font-size: 12px; font-weight: 700; color: #e8f8f6; text-shadow: 0 1px 2px rgba(0,0,0,0.85);
              pointer-events: none; z-index: 3; }
            .vs-veditor-clip-handle { position: absolute; top: 0; bottom: 0; width: 8px; max-width: 35%;
              cursor: ew-resize; z-index: 2; background: rgba(255,255,255,0.1); }
            .vs-veditor-clip-handle:hover { background: rgba(255,255,255,0.22); }
            .vs-veditor-clip-handle.vs-left { left: 0; border-radius: 2px 0 0 2px; }
            .vs-veditor-clip-handle.vs-right { right: 0; border-radius: 0 2px 2px 0; }
            .vs-veditor-clip-body { position: absolute; left: 8px; right: 8px; top: 0; bottom: 0; cursor: grab; z-index: 1; }
            .vs-veditor-clip-body:active { cursor: grabbing; }
            .vs-veditor-btn { padding: 4px 10px; border-radius: 4px; border: 1px solid #3d4450; background: #1e2228; color: #e8eaed; cursor: pointer; font-size: 12px; }
            .vs-veditor-btn:hover:not(:disabled) { background: #2a3038; border-color: #4a5568; }
            .vs-veditor-btn:disabled { opacity: 0.42; cursor: not-allowed; pointer-events: none; }
            .vs-veditor-btn.vs-veditor-btn-danger {
              background: #8a2020; border-color: #b13a3a; color: #fff2f2; font-weight: 600; }
            .vs-veditor-btn.vs-veditor-btn-danger:hover:not(:disabled) {
              background: #a12828; border-color: #c54b4b; }
            .vs-veditor-btn.vs-veditor-btn-primary {
              background: #007bff; border-color: #4ea4ff; color: white; font-weight: 600; }
            .vs-veditor-btn.vs-veditor-btn-primary:hover:not(:disabled) {
              background: #3395ff; border-color: #7ab8ff; color: white; }
            .vs-veditor-publish-modal {
              position: fixed; inset: 0; z-index: 2147483646; display: none; align-items: center; justify-content: center;
              background: rgba(2, 4, 8, 0.56); pointer-events: auto; }
            .vs-veditor-publish-modal.vs-open { display: flex; }
            .vs-veditor-publish-card {
              width: min(520px, calc(100vw - 20px)); max-height: calc(100vh - 30px); overflow: auto;
              background: #2a2e34; border: 1px solid #424952; border-radius: 4px; padding: 14px; }
            .vs-veditor-publish-head {
              display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; font-size: 14px; font-weight: 600; }
            .vs-veditor-publish-close {
              border: none; background: transparent; color: #f3f5f8; cursor: pointer; font-size: 18px; padding: 0 4px; line-height: 1; }
            .vs-veditor-publish-grid { display: flex; flex-direction: column; gap: 10px; }
            .vs-veditor-publish-label { font-size: 12px; color: #dce2ea; margin-bottom: 4px; display: inline-block; }
            .vs-veditor-publish-required { color: #ff5f5f; margin-left: 2px; }
            .vs-veditor-publish-input,
            .vs-veditor-publish-select,
            .vs-veditor-publish-textarea {
              width: 100%; background: #51565e; color: #f2f4f7; border: 1px solid #7a828f; border-radius: 2px; font-size: 12px; }
            .vs-veditor-publish-input,
            .vs-veditor-publish-select { height: 34px; padding: 0 10px; }
            .vs-veditor-publish-textarea { min-height: 86px; resize: vertical; padding: 8px 10px; }
            /* 제목 입력은 내용 입력과 동일한 시각 톤으로 고정 */
            .vs-veditor-publish-input.vs-veditor-publish-title {
              background: #51565e; border: 1px solid #7a828f; color: #f2f4f7; padding: 8px 10px; }
            .vs-veditor-publish-input::placeholder,
            .vs-veditor-publish-textarea::placeholder { color: #b7bec9; }
            .vs-veditor-publish-input:focus,
            .vs-veditor-publish-select:focus,
            .vs-veditor-publish-textarea:focus {
              outline: none; border-color: #9db4d5; box-shadow: 0 0 0 2px rgba(157,180,213,0.18); }
            .vs-veditor-publish-category-row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
            .vs-veditor-publish-desc {
              margin-top: 8px; font-size: 12px; line-height: 1.5; color: #ff4f4f; white-space: pre-line; }
            .vs-veditor-publish-err {
              margin-top: 6px; font-size: 12px; color: #ff9a9a; min-height: 1.3em; }
            .vs-veditor-publish-actions { margin-top: 8px; display: flex; justify-content: center; gap: 8px; }
            .vs-veditor-publish-cancel { min-width: 68px; background: #1f2328; }
            .vs-veditor-publish-submit { min-width: 68px; background: #2b8cff; border-color: #4ea4ff; color: #f7fbff; }
            .vs-veditor-timeline-tools { display: flex; flex-direction: column; align-items: stretch; gap: 4px; margin-right: 0; }
            .vs-veditor-timeline-label-mode,
            .vs-veditor-playback-speed {
              width: 100%; min-width: 0; max-width: none; height: 24px; padding: 0 5px;
              border-radius: 4px; border: 1px solid #3d4450; background: #12161d; color: #d9deea; font-size: 12px; }
            .vs-veditor-clip-toolbar-row .vs-veditor-playback-speed {
              width: auto; min-width: 5em; max-width: 7.5em; flex: 0 0 auto; }
            .vs-veditor-btn.vs-veditor-tool-btn {
              width: 24px; min-width: 24px; max-width: 24px;
              padding: 2px; min-height: 24px; display: inline-flex; align-items: center; justify-content: center; gap: 0;
              font-size: 12px; color: #b9c3d2; }
            .vs-veditor-tool-btn svg { width: 14px; height: 14px; display: block; }
            .vs-veditor-tool-btn.vs-active {
              color: var(--vs-accent); border-color: var(--vs-accent-dim);
              box-shadow: inset 0 0 0 1px rgba(0, 212, 232, 0.14); }
            .vs-veditor-track.vs-tool-cut .vs-veditor-clip,
            .vs-veditor-track.vs-tool-cut .vs-veditor-clip-body,
            .vs-veditor-track.vs-tool-cut .vs-veditor-clip-handle {
              cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='M11 3h7l3 3v12l-3 3h-7l-3-3V6z' fill='%2315191f' stroke='%23cfd7e4' stroke-width='1.35'/%3E%3Cpath d='M12.7 8h5M12.7 12h4M12.7 16h5' stroke='%23cfd7e4' stroke-width='1.35' stroke-linecap='round'/%3E%3Cpath d='M4 1.5v21' stroke='%2300d4e8' stroke-width='1.8'/%3E%3C/svg%3E") 4 12, crosshair; }
            .vs-veditor-json { width: 100%; min-height: 72px; font-size: 12px; font-family: monospace; background: #0a0b0e; color: #a8b0bc;
              border: 1px solid var(--vs-border); border-radius: 4px; padding: 6px; }
            .vs-veditor-ruler-hover-tip { position: fixed; z-index: 2147483640; display: none; pointer-events: none;
              padding: 2px 6px; border-radius: 4px; background: #1e2228; border: 1px solid #4a5568; font-size: 12px; color: #e8eaed; }
        `;
        }
    };

    static ClipBoundaryPlayback = class {
        /**
         * @param {SoopVeditorReplacement} editor
         * @param {number} t
         * @param {number} begin
         * @param {number} end
         * @returns {'continue'|'segment_end'}
         */
        static advance(editor, t, begin, end) {
            const eps = SoopVeditorReplacement.PLAYBACK_CLIP_ENTRY_BEGIN_EPS;
            const slack = SoopVeditorReplacement.PLAYBACK_CLIP_ENTRY_END_SLACK;
            if (!editor._playbackClipEntered) {
                if (t >= begin - eps && t <= end + slack) {
                    editor._playbackClipEntered = true;
                }
                return 'continue';
            }
            if (t >= end - 0.05) return 'segment_end';
            return 'continue';
        }
    };

    static EDITOR_RULER_STEPS_SEC = [
        0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600,
    ];
    /** 타임라인 표시 토글 아이콘 — 고정 문자열 재사용(행마다 새 문자열 조립 안 함). */
    static CLIP_TIMELINE_VISIBILITY_SVG_ON =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M1.75 8C3.4 5.15 5.55 3.5 8 3.5 10.45 3.5 12.6 5.15 14.25 8 12.6 10.85 10.45 12.5 8 12.5 5.55 12.5 3.4 10.85 1.75 8z"/>' +
        '<circle cx="8" cy="8" r="2"/></svg>';
    static CLIP_TIMELINE_VISIBILITY_SVG_OFF =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M1.75 8.1Q8 5.55 14.25 8.1"/></svg>';
    static TIMELINE_TOOL_SVG_SELECT =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M3 2.5L11.5 8.1 7.8 8.9 9.9 13.5 8.1 14.2 6 9.6 3 12V2.5z"/></svg>';
    static TIMELINE_TOOL_SVG_CUT =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M5.2 2.2H11.9L13.7 4V11.8L11.9 13.6H5.2L3.4 11.8V4z"/><path d="M6.4 5.4h4.4M6.4 8h3.5M6.4 10.6h4.4"/><path d="M1.2 1.2v13.6"/></svg>';

    // 필드 초기화, 핸들러 bind, MutationObserver로 video_edit 버튼 스캔을 시작한다 (확장 로드 직후).
    constructor() {
        super();
        /** @type {string|null} */
        this.titleNo = null;
        this._panelVisible = false;

        /** @type {VeditorClip[]} */
        this._clips = [];
        this._selectedClipIndex = 0;
        /** @type {{ clips: VeditorClip[], selectedClipIndex: number }[]} */
        this._clipUndoStack = [];
        this._clipUndoMaxDepth = 100;
        /** @type {'select'|'cut'} */
        this._timelineToolMode = 'select';
        /** @type {'index'|'name'} */
        this._timelineClipLabelMode = 'index';
        /** @type {{ clip: VeditorClip, mode: string, startX: number, origBegin: number, origEnd: number, total: number, undoSnapshot: { clips: VeditorClip[], selectedClipIndex: number }|null, dragEl: HTMLElement|null, moveRaf: number, pendingClientX: number }|null} */
        this._clipDrag = null;

        this.rootEl = null;
        this._overlayShell = null;
        /** @type {HTMLDivElement|null} */
        this._clipListScrollEl = null;
        /** @type {HTMLElement|null} */
        this._clipPanelEl = null;
        /** @type {HTMLButtonElement|null} */
        this._clipPanelToggleBtn = null;
        this._clipPanelCollapsed = false;
        /** @type {HTMLElement|null} */
        this._sequenceHeaderEl = null;
        /** @type {HTMLElement|null} */
        this._timecodeEl = null;
        /** @type {HTMLElement|null} */
        this._clipTotalEl = null;
        /** @type {HTMLElement|null} */
        this._clipPlayStatusEl = null;
        /** @type {HTMLSelectElement|null} */
        this._timelineCopyActionSel = null;
        /** @type {HTMLButtonElement|null} */
        this._clipToolbarFitBtn = null;
        /** @type {HTMLButtonElement|null} */
        this._clipToolbarDupBtn = null;
        /** @type {HTMLButtonElement|null} */
        this._clipToolbarDelBtn = null;
        /** @type {HTMLButtonElement|null} */
        this._clipToolbarStartBtn = null;
        /** @type {HTMLButtonElement|null} */
        this._clipToolbarEndBtn = null;
        /** @type {HTMLButtonElement|null} */
        this._clipToolbarAddBtn = null;
        /** @type {HTMLButtonElement|null} */
        this._clipToolbarPlaySelBtn = null;
        /** @type {HTMLButtonElement|null} */
        this._clipToolbarTestBtn = null;
        /** @type {HTMLButtonElement|null} */
        this._clipToolbarPublishBtn = null;
        /** @type {HTMLButtonElement|null} */
        this._officialVeditorBtn = null;
        /** @type {HTMLDivElement|null} */
        this._publishModalEl = null;
        /** @type {HTMLSelectElement|null} */
        this._publishBoardSel = null;
        /** @type {HTMLSelectElement|null} */
        this._publishVodCategorySel = null;
        /** @type {HTMLSelectElement|null} */
        this._publishVodCategorySubSel = null;
        /** @type {HTMLSelectElement|null} */
        this._publishLangSel = null;
        /** @type {HTMLInputElement|null} */
        this._publishTitleInp = null;
        /** @type {HTMLTextAreaElement|null} */
        this._publishContentsInp = null;
        /** @type {HTMLElement|null} */
        this._publishErrEl = null;
        /** @type {HTMLButtonElement|null} */
        this._publishSubmitBtn = null;
        this._publishSubmitting = false;
        this._publishVodCategoryTree = [];
        /** @type {HTMLButtonElement|null} */
        this._timelineToolSelectBtn = null;
        /** @type {HTMLButtonElement|null} */
        this._timelineToolCutBtn = null;
        /** @type {HTMLSelectElement|null} */
        this._timelineLabelModeSelect = null;
        /** @type {HTMLSelectElement|null} */
        this._playbackSpeedSelect = null;
        this._playAllMode = false;
        /** 선택한 편집 구간만 재생 중일 때 true — RAF·grace는 `_playAllRaf` 등 재사용. */
        this._playSingleClipMode = false;
        this._playSingleClipBeginSec = 0;
        this._playSingleClipEndSec = 0;
        /** 시크 직후 `t >= end` 오판 방지: 현재 편집 구간 begin 근처~end+slack 안으로 들어온 뒤에만 true */
        this._playbackClipEntered = false;
        /** @type {number|null} */
        this._playAllRaf = null;
        this._playAllSeekGraceUntil = 0;
        /** @type {number} */
        this._playAllIndex = 0;
        this._listDnDIndex = null;
        /** DnD 로 순서만 바뀐 뒤 전체 재빌드(행 DOM 순서·dataset 일치). */
        this._clipListReorderPending = false;
        /** `.vs-veditor-clip-scroll` 에 편집 구간 목록 위임 리스너 1회만 부착. */
        this._clipListDelegationBound = false;
        this._timelineViewport = null;
        this._timelineInner = null;
        this._rulerEl = null;
        this._trackEl = null;
        this._playheadEl = null;
        this._rulerHoverTipEl = null;
        this._pixelsPerSecond = 80;
        /** 첫 레이아웃에서 타임라인 줌을 뷰포트에 맞는 최대 축소로 맞출 때까지 true */
        this._veditorInitialTimelineZoomPending = true;
        this._playheadSec = 0;
        this._playheadDragging = false;
        this._playheadRafId = null;
        this._playheadVideoBound = null;
        this._wheelPaintRaf = 0;
        /** 스크롤·썸 드래그로 눈금+커스텀 스크롤바 갱신을 한 프레임으로 묶음 */
        this._viewportScrollVisualRaf = null;
        /** 눈금 호버 툴팁: mousemove 를 rAF 로 합쳐 getBoundingClientRect 폭주 방지 */
        this._rulerTipRaf = null;
        /** @type {MouseEvent|null} */
        this._rulerTipPendingEv = null;
        this._viewportResizeObs = null;
        this._timelineScrollBarEl = null;
        this._timelineScrollTrackEl = null;
        this._timelineScrollThumbEl = null;
        /** @type {{ pointerId: number, startX: number, startScroll: number, maxScroll: number, maxThumbLeft: number }|null} */
        this._scrollThumbDrag = null;
        /** `_refreshCachedGlobalPlaybackTime` 결과 — 재생 헤드 갱신·시크 직후 등에서만 refresh 후, 나머지는 이 값만 읽는다. */
        this._cachedGlobalPlaybackSec = 0;
        /** 동일 동기 스택에서 `_refreshCachedGlobalPlaybackTime` 재진입 시 1회만 읽기. */
        this._gpGlobalPlaybackReadCoalesced = false;
        /** 재생 시간이 잠깐 멈출 때 재생 헤드 표시만 시계로 보간 (편집 시각은 `_cachedGlobalPlaybackSec`). */
        this._phExRaw = null;
        this._phExAnchorSec = 0;
        this._phExWallMs = 0;

        this._onVideoPauseSeekForPlayhead = this._onVideoPauseSeekForPlayhead.bind(this);
        this._onPlayheadPointerMove = this._onPlayheadPointerMove.bind(this);
        this._onPlayheadPointerUp = this._onPlayheadPointerUp.bind(this);
        this._onPlayheadKeydown = this._onPlayheadKeydown.bind(this);
        this._onClipResizeMove = this._onClipResizeMove.bind(this);
        this._onClipResizeEnd = this._onClipResizeEnd.bind(this);
        this._tickPlayheadPanelSync = this._tickPlayheadPanelSync.bind(this);
        this._onVideoEditClick = this._onVideoEditClick.bind(this);
        this._onTimelineScrollThumbUp = this._onTimelineScrollThumbUp.bind(this);
        this._onClipListChange = this._onClipListChange.bind(this);
        this._onClipListHostClick = this._onClipListHostClick.bind(this);
        this._onClipListHostDragStart = this._onClipListHostDragStart.bind(this);
        this._onClipListHostDragOver = this._onClipListHostDragOver.bind(this);
        this._onClipListHostDrop = this._onClipListHostDrop.bind(this);
        this._onClipListHostDragEnd = this._onClipListHostDragEnd.bind(this);

        this._editButtonObserver = new MutationObserver(() => this._scanVideoEditButtons());
        this._editButtonObserver.observe(document.documentElement, { childList: true, subtree: true });
        this._scanVideoEditButtons();
        window.VODSync = window.VODSync || {};
        window.VODSync.soopVeditorReplacement = this;
        this.debug('SoopVeditorReplacement: ready');
    }

    /**
     * 타임라인 댓글 등에서 파싱한 구간을 편집 구간 목록에 한 번에 추가한다. 패널이 없으면 연다.
     * @param {{ begin: number, end: number, name?: string }[]} items
     */
    importClipsFromParsedRanges(items) {
        if (!Array.isArray(items) || items.length === 0) return;
        if (!/\/player\/\d+/.test(window.location.pathname)) return;

        const titleNo = window.location.pathname.match(/\/player\/(\d+)/)?.[1];
        if (!titleNo) return;
        this.titleNo = titleNo;

        if (this._isClipListBusy()) {
            window.alert('구간 테스트·연속 재생 중에는 가져올 수 없습니다. 먼저 재생을 멈춰 주세요.');
            return;
        }

        if (!this._overlayShell) {
            this._mountOverlayDom();
            this._panelVisible = true;
            this._veditorInitialTimelineZoomPending = true;
            this._hydratePlaylistFromSource();
            if (this._overlayShell) this._overlayShell.style.display = 'flex';
        } else if (!this._panelVisible || this._overlayShell.style.display === 'none') {
            this._showPanel();
        }

        this._recordClipUndo();
        for (const it of items) {
            const nm = it?.name != null && String(it.name).trim() !== '' ? String(it.name).trim() : undefined;
            this._clipAdd(it.begin, it.end, nm);
        }
        const clips = this._getClips();
        this._selectedClipIndex = Math.max(0, clips.length - 1);
        this._syncUiFromState();
    }

    // --- 오버레이·진입 (역할 맵: video_edit, 패널, vodCore 파사드) ---
    /** 확장/TM 공통 vodCore 파사드. 상세 접근 분기는 `window.VODSync.getVodCore()` 뒤로 숨긴다. */
    _getVodCore() {
        return window.VODSync?.getVodCore?.() ?? null;
    }

    // DOM에 있는 video_edit 버튼을 모두 찾아 아직 미바인딩인 것만 연결한다 (Observer 콜백·초기 스캔).
    _scanVideoEditButtons() {
        document.querySelectorAll('button.video_edit').forEach((btn) => this._bindVideoEditButton(btn));
    }

    // video_edit 버튼에 캡처 단계 클릭 리스너를 한 번만 붙인다 (중복 방지용 data 속성 사용).
    _bindVideoEditButton(btn) {
        if (!(btn instanceof HTMLButtonElement)) return;
        if (btn.dataset.vsVodEditBound === '1') return;
        btn.dataset.vsVodEditBound = '1';
        btn.addEventListener('click', this._onVideoEditClick, true);
    }

    // 플레이어 페이지에서 편집 버튼 클릭 시 기본 동작을 막고 오버레이를 최초 생성하거나 토글한다.
    _onVideoEditClick(e) {
        if (!/\/player\/\d+/.test(window.location.pathname)) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const titleNo = window.location.pathname.match(/\/player\/(\d+)/)?.[1];
        if (!titleNo) return;
        this.titleNo = titleNo;

        if (!this._overlayShell) {
            this._mountOverlayDom();
            // `_hydratePlaylistFromSource` 안의 `_startPlayheadRaf` 가 `_panelVisible` 을 본다. 먼저 true 로 두어야 최초 오픈 시에도 rAF 가 돈다.
            this._panelVisible = true;
            this._veditorInitialTimelineZoomPending = true;
            this._hydratePlaylistFromSource();
            if (this._overlayShell) this._overlayShell.style.display = 'flex';
            return;
        }
        if (this._panelVisible) {
            this._hidePanel();
        } else {
            this._showPanel();
        }
    }

    // 재생 어댑터 값과 URL 기준 titleNo를 맞춘 뒤 UI를 갱신한다 (패널 최초 오픈·표시 시).
    _hydratePlaylistFromSource() {
        const vc = this._getVodCore();
        const titleNo = vc?.config?.titleNo != null ? String(vc.config.titleNo) : '';
        if (titleNo !== '') this.titleNo = String(titleNo);
        const playingTime = vc?.playerController?.playingTime;
        const hasPlayingTime = typeof playingTime === 'number' && Number.isFinite(playingTime);
        const cfg = vc?.config;
        const cfgSum = cfg?.configFilesDurationSum != null ? String(cfg.configFilesDurationSum) : '';
        const fiSum = cfg?.fileItemsDurationSum != null ? String(cfg.fileItemsDurationSum) : '';
        const totalDur = cfg?.totalFileDuration != null ? String(cfg.totalFileDuration) : '';
        const hasVodCoreData =
            vc &&
            (hasPlayingTime || cfgSum !== '' || fiSum !== '' || totalDur !== '');
        if (!vc) {
            this.debug('vodCore 어댑터 없음 — 타임라인·시크는 tsManager·<video> 폴백');
        } else if (!hasVodCoreData) {
            this.debug('vodCore 브리지 대기 중 — 재생 길이는 video 메타에 의존할 수 있음');
        } else {
            this.debug('playlist via vodCore page bridge');
        }
        this._syncOfficialVeditorButtonState();
        this._syncPlaybackSpeedSelectFromPlayer();
        this._syncUiFromState();
        this._startPlayheadRaf();
    }

    /** 공식 편집기 버튼: titleNo 가 있을 때만 활성화 (vodCore·URL 동기화 후 상태 맞춤). */
    _syncOfficialVeditorButtonState() {
        const btn = this._officialVeditorBtn;
        if (!btn) return;
        const ok = String(this.titleNo || '').trim().length > 0;
        btn.disabled = !ok;
        btn.title = ok ? 'SOOP 공식 웹 편집기(새 탭)' : 'titleNo를 알 수 없어 공식 편집기를 열 수 없습니다.';
    }

    // 편집 패널을 숨기고 재생 헤드 RAF·드래그 상태를 정리한다 (닫기·토글 시).
    _hidePanel() {
        this._panelVisible = false;
        this._stopPlayAll();
        this._closePublishModal();
        this._onPlayheadPointerUp();
        this._onTimelineScrollThumbUp();
        this._stopPlayheadRaf();
        if (this._viewportScrollVisualRaf != null) {
            cancelAnimationFrame(this._viewportScrollVisualRaf);
            this._viewportScrollVisualRaf = null;
        }
        if (this._rulerTipRaf != null) {
            cancelAnimationFrame(this._rulerTipRaf);
            this._rulerTipRaf = null;
        }
        this._rulerTipPendingEv = null;
        this._resetPlayheadExtrap();
        if (this._overlayShell) this._overlayShell.style.display = 'none';
    }

    _showPanel() {
        this._panelVisible = true;
        this._veditorInitialTimelineZoomPending = true;
        if (this._overlayShell) {
            this._overlayShell.style.display = 'flex';
            this._hydratePlaylistFromSource();
        }
    }

    // --- 편집 구간 모델 (배열, undo, 검증) ---
    // 편집 중인 편집 구간 배열 참조를 반환한다 (테이블·트랙 렌더링에서 공통 접근).
    _getClips() {
        return this._clips;
    }

    _isClipListBusy() {
        return this._playAllMode || this._playSingleClipMode;
    }

    _cloneClipForUndo(clip) {
        return {
            name: String(clip?.name ?? ''),
            begin: this._roundClipSec(Number(clip?.begin ?? 0)),
            end: this._roundClipSec(Number(clip?.end ?? 0)),
            visibleOnTimeline: clip?.visibleOnTimeline !== false,
        };
    }

    _snapshotClipStateForUndo() {
        return {
            clips: this._clips.map((c) => this._cloneClipForUndo(c)),
            selectedClipIndex: this._selectedClipIndex,
        };
    }

    _recordClipUndo() {
        const snapshot = this._snapshotClipStateForUndo();
        this._clipUndoStack.push(snapshot);
        if (this._clipUndoStack.length > this._clipUndoMaxDepth) {
            this._clipUndoStack.splice(0, this._clipUndoStack.length - this._clipUndoMaxDepth);
        }
    }

    /**
     * 레거시 `{ startTime, endTime }` 또는 불완전 필드를 `{ name, begin, end, visibleOnTimeline }` 형태로 맞춘다.
     */
    _migrateClipShape() {
        for (let i = 0; i < this._clips.length; i++) {
            const c = this._clips[i];
            if (c.begin === undefined && c.startTime !== undefined) {
                c.begin = Number(c.startTime);
                c.end = Number(c.endTime);
            }
            if (c.name === undefined || String(c.name).trim() === '') c.name = `편집 구간 ${i + 1}`;
            if (c.visibleOnTimeline === undefined) c.visibleOnTimeline = true;
            if (Number.isFinite(Number(c.begin))) c.begin = this._roundClipSec(Number(c.begin));
            if (Number.isFinite(Number(c.end))) c.end = this._roundClipSec(Number(c.end));
        }
    }

    // 새 편집 구간을 추가한다 (배열 끝 = 리스트 순서; 시간순 자동 정렬 없음). name 생략·빈 문자열이면 `편집 구간 n`.
    _clipAdd(begin, end, name = undefined) {
        let b = Math.min(Number(begin), Number(end));
        let e = Math.max(Number(begin), Number(end));
        if (!Number.isFinite(b)) b = 0;
        if (!Number.isFinite(e)) e = b;
        b = this._roundClipSec(b);
        e = this._roundClipSec(e);
        const n = this._clips.length + 1;
        const label = name != null && String(name).trim() !== '' ? String(name).trim() : `편집 구간 ${n}`;
        this._clips.push({ name: label, begin: b, end: e, visibleOnTimeline: true });
    }

    // 지정 인덱스 편집 구간 필드를 갱신한다 (표·타임라인 조작 후).
    _clipUpdate(clipIdx, patch) {
        const c = this._clips[clipIdx];
        if (!c) return;
        if (patch.begin !== undefined) {
            const v = Number(patch.begin);
            if (Number.isFinite(v)) c.begin = this._roundClipSec(v);
        }
        if (patch.end !== undefined) {
            const v = Number(patch.end);
            if (Number.isFinite(v)) c.end = this._roundClipSec(v);
        }
        if (patch.name !== undefined) c.name = String(patch.name);
        if (patch.visibleOnTimeline !== undefined) c.visibleOnTimeline = !!patch.visibleOnTimeline;
    }

    // 한 편집 구간을 배열에서 제거한다 (표의 삭제 버튼).
    _clipRemove(clipIdx) {
        if (this._isClipListBusy()) return;
        if (clipIdx < 0 || clipIdx >= this._clips.length) return;
        this._clips.splice(clipIdx, 1);
    }

    // 모든 편집 구간을 비운다 (전체 비우기 버튼).
    _clipClearAll() {
        if (this._isClipListBusy()) return;
        if (this._clips.length > 0) this._recordClipUndo();
        this._clips = [];
    }

    // 편집 구간들의 (끝−시작) 합을 초 단위로 구한다 (미리보기 라벨·검증 보조).
    _clipTotalDurationSec() {
        let sum = 0;
        for (const c of this._clips) {
            sum += Math.max(0, c.end - c.begin);
        }
        return sum;
    }

    // 합계 초를 패널 라벨용으로 붙인다 — 60초 미만은 초만, 이상은 분·초(소수 둘째).
    _formatClipTotalSumLabel(sumSec) {
        if (!Number.isFinite(sumSec) || sumSec < 0) return '총 길이 0.00초';
        const m = Math.floor(sumSec / 60);
        const sRem = Math.max(0, sumSec - m * 60);
        if (m === 0) return `총 길이 ${sRem.toFixed(2)}초`;
        return `총 길이 ${m}분 ${sRem.toFixed(2)}초`;
    }

    /** 게시 API와 동일 규칙(시각 소수 둘째 자리)으로 한 편집 구간의 길이(초). 비정상이면 null. */
    _clipPublishDurationSec(c) {
        const startTime = this._roundClipSec(c.begin);
        const endTime = this._roundClipSec(c.end);
        if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return null;
        const duration = this._roundClipSec(endTime - startTime);
        if (!Number.isFinite(duration)) return null;
        return Math.max(0, duration);
    }

    // 편집 구간이 유효한지 검사한다 (게시 저장 직전·필요 시 호출).
    _clipValidate() {
        for (let i = 0; i < this._clips.length; i++) {
            const c = this._clips[i];
            if (!(c.end >= c.begin)) {
                return { ok: false, message: `편집 구간 ${i + 1}: 끝 시각이 시작보다 작을 수 없습니다.` };
            }
            if (c.begin < 0) {
                return { ok: false, message: `편집 구간 ${i + 1}: 시작 시각이 음수입니다.` };
            }
        }
        return { ok: true };
    }

    /**
     * 타임라인·시크 클램프에 쓰는 총 길이. vodCore 메타 → `tsManager.getTotalFileDurationSec`(SOOP API)·`<video>.duration` 순.
     */
    _getTotalDurationSec() {
        const vc = this._getVodCore();
        let meta = 0;
        if (vc && vc.config && typeof vc.config === 'object') {
            const pick = (key) => {
                const raw = vc.config[key];
                const x = parseFloat(raw == null ? '' : String(raw));
                return Number.isFinite(x) && x > 0 ? x : 0;
            };
            const cfs = pick('configFilesDurationSum');
            const sm = pick('fileItemsDurationSum');
            const tf = pick('totalFileDuration');
            const vals = [cfs, sm, tf].filter((v) => v > 0);
            if (vals.length === 1) meta = vals[0];
            else if (vals.length >= 2) {
                const lo = Math.min(...vals);
                const hi = Math.max(...vals);
                meta = hi > lo + 0.5 && lo < hi * 0.5 ? hi : lo;
            }
        }
        if (meta > 0) return meta;
        const ts = window.VODSync?.tsManager;
        if (ts && typeof ts.getTotalFileDurationSec === 'function') {
            const apiSec = ts.getTotalFileDurationSec();
            if (apiSec !== null && Number.isFinite(apiSec) && apiSec > 0) return apiSec;
        }
        const v = this._getVideo();
        const vd =
            v && Number.isFinite(v.duration) && v.duration > 0 && v.duration !== Number.POSITIVE_INFINITY
                ? v.duration
                : 0;
        if (vd > 0) return vd;
        return 3600;
    }

    /**
     * `tsManager.getCurPlaybackTime()` → 실패 시 `<video>.currentTime`.
     * 동일 동기 스택에서 여러 번 호출돼도 실제 DOM 읽기는 한 번만 한다.
     */
    _refreshCachedGlobalPlaybackTime() {
        if (this._gpGlobalPlaybackReadCoalesced) return;
        this._gpGlobalPlaybackReadCoalesced = true;
        try {
            const ts = window.VODSync?.tsManager;
            if (ts && typeof ts.getCurPlaybackTime === 'function') {
                const pt = ts.getCurPlaybackTime();
                if (pt !== null && Number.isFinite(pt)) {
                    this._cachedGlobalPlaybackSec = Math.max(0, pt);
                    return;
                }
            }
            const v = this._getVideo();
            this._cachedGlobalPlaybackSec = v && Number.isFinite(v.currentTime) ? Math.max(0, v.currentTime) : 0;
        } finally {
            queueMicrotask(() => {
                this._gpGlobalPlaybackReadCoalesced = false;
            });
        }
    }

    _resetPlayheadExtrap() {
        this._phExRaw = null;
        this._phExAnchorSec = 0;
        this._phExWallMs = 0;
    }

    /**
     * 노란 헤드 **표시**용 시각 (rAF). vodCore `playingTime` 있으면 보간, 없으면 `tsManager.getCurPlaybackTime`·`<video>`.
     */
    _computePlayheadDisplaySec(total) {
        const vc = this._getVodCore();
        const rawPlayback = vc?.playerController?.playingTime;
        const playbackSec =
            typeof rawPlayback === 'number' && Number.isFinite(rawPlayback) ? Math.max(0, rawPlayback) : null;
        const v = this._getVideo();
        const haveCur =
            typeof HTMLMediaElement !== 'undefined'
                ? HTMLMediaElement.HAVE_CURRENT_DATA
                : /* @__PURE__ */ 2;
        const playing = Boolean(v && !v.paused && !v.ended && v.readyState >= haveCur);

        if (playbackSec != null) {
            if (!playing) {
                this._resetPlayheadExtrap();
                return Math.min(total, playbackSec);
            }
            const now = performance.now();
            const eps = 1e-4;
            if (this._phExRaw == null || Math.abs(playbackSec - this._phExRaw) >= eps) {
                this._phExRaw = playbackSec;
                this._phExAnchorSec = playbackSec;
                this._phExWallMs = now;
                return Math.max(0, Math.min(total, playbackSec));
            }
            const elapsedSec = (now - this._phExWallMs) / 1000;
            if (elapsedSec > 0.35) {
                this._phExAnchorSec = playbackSec;
                this._phExWallMs = now;
                return Math.max(0, Math.min(total, playbackSec));
            }
            const rate = v.playbackRate || 1;
            return Math.max(0, Math.min(total, this._phExAnchorSec + elapsedSec * rate));
        }

        this._resetPlayheadExtrap();
        const ts = window.VODSync?.tsManager;
        if (ts && typeof ts.getCurPlaybackTime === 'function') {
            const pt = ts.getCurPlaybackTime();
            if (pt !== null && Number.isFinite(pt)) {
                return Math.min(total, Math.max(0, pt));
            }
        }
        const ct = v && Number.isFinite(v.currentTime) ? Math.max(0, v.currentTime) : null;
        if (ct != null) return Math.min(total, ct);
        return 0;
    }

    // `tsManager.moveToPlaybackTime`(URL·vodCore·time_link) → ts 없을 때만 vodCore·`<video>`.
    _plSeekGlobal(globalSec) {
        const s = Number(globalSec);
        const sec = Number.isFinite(s) ? Math.max(0, s) : 0;
        const ts = window.VODSync?.tsManager;
        if (ts && typeof ts.moveToPlaybackTime === 'function') {
            ts.moveToPlaybackTime(sec, false);
            return;
        }
        const vc = this._getVodCore();
        if (vc && typeof vc.seek === 'function') {
            try {
                vc.seek(sec);
                return;
            } catch (e) {
                /* ignore */
            }
        }
        const v = this._getVideo();
        if (v) {
            try {
                v.currentTime = sec;
            } catch (e) {
                /* ignore */
            }
        }
    }

    // 문서의 첫 `<video>` 요소 (vodCore 미가동·보조 시 길이·재생 시각).
    _getVideo() {
        const v = document.querySelector('video');
        return v instanceof HTMLVideoElement ? v : null;
    }

    // vodCore 어댑터로 배속 적용(확장=브리지 속성, TM=unsafeWindow.vodCore.speed); 실패 시 `<video>.playbackRate`.
    _setPlaybackSpeedFromUi(rate) {
        const r = Number(rate);
        if (!Number.isFinite(r) || r <= 0) return;
        const vc = this._getVodCore();
        if (vc) {
            try {
                vc.speed = r;
                return;
            } catch (_) {
                /* ignore */
            }
        }
        const v = this._getVideo();
        if (v) {
            try {
                v.playbackRate = r;
            } catch (e) {
                /* ignore */
            }
        }
    }

    // 플레이어 `<video>.playbackRate` 를 기준으로 배속 드롭다운 표시를 가장 가까운 옵션에 맞춘다 (패널 표시 시).
    _syncPlaybackSpeedSelectFromPlayer() {
        const sel = this._playbackSpeedSelect;
        if (!sel) return;
        const opts = SoopVeditorReplacement.PLAYBACK_SPEED_OPTIONS;
        let cur = 1;
        const v = this._getVideo();
        if (v && Number.isFinite(v.playbackRate) && v.playbackRate > 0) cur = v.playbackRate;
        let best = opts[3];
        let bestDiff = Math.abs(best - cur);
        for (let i = 0; i < opts.length; i++) {
            const d = Math.abs(opts[i] - cur);
            if (d < bestDiff) {
                bestDiff = d;
                best = opts[i];
            }
        }
        sel.value = String(best);
    }

    // 뷰포트 너비에 맞춰 전체 타임라인이 한 화면에 들어가게 하는 최소 px/초를 구한다 (줌 하한).
    _minPpsToFitViewport(totalSec) {
        const vp = this._timelineViewport;
        const total = totalSec !== undefined ? totalSec : this._getTotalDurationSec();
        if (!vp || total <= 0) return SoopVeditorReplacement.MIN_PPS_ABS_FLOOR;
        const w = Math.max(vp.clientWidth, 1);
        return Math.max(SoopVeditorReplacement.MIN_PPS_ABS_FLOOR, w / total);
    }

    /**
     * 타임라인 inner 너비(px). `total*pps`가 뷰포트보다 작으면 inner가 viewport보다 좁아져 옆에 빈 틈이 보이므로
     * 항상 최소 `clientWidth` 이상으로 맞춘다 (눈금·편집 구간 좌표는 여전히 `t*pps` 기준).
     */
    _getTimelineInnerWidthPx(total, pps) {
        const vp = this._timelineViewport;
        const raw = total > 0 ? total * pps : 0;
        if (!vp) return Math.max(1, raw);
        const cw = Math.max(vp.clientWidth, 1);
        return Math.max(raw, cw);
    }

    // 픽셀/초 줌 값을 허용 범위와 뷰포트 맞춤 하한 사이로 잘라낸다 (휠 줌·동기화 시).
    _clampPps(pps, totalSec) {
        const minPps = this._minPpsToFitViewport(totalSec);
        const lo = Math.max(SoopVeditorReplacement.MIN_PPS_ABS_FLOOR, minPps);
        return Math.max(lo, Math.min(SoopVeditorReplacement.MAX_PPS, pps));
    }

    // 타임라인 내부 너비가 바뀐 뒤 가로 스크롤이 범위를 벗어나지 않게 맞춘다 (줌·리사이즈 후).
    _clampViewportScroll(innerW) {
        const vp = this._timelineViewport;
        if (!vp) return;
        const maxScroll = Math.max(0, innerW - vp.clientWidth);
        if (maxScroll <= 0) {
            vp.scrollLeft = 0;
        } else {
            vp.scrollLeft = Math.max(0, Math.min(vp.scrollLeft, maxScroll));
        }
        this._updateTimelineScrollBarUI();
    }

    // 오버레이용 기본 스타일 버튼을 만들고 클릭 후 포커스를 뺀다 (접근성·키보드 트랩 완화).
    _btn(label, onClick) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'vs-veditor-btn';
        b.textContent = label;
        b.addEventListener('click', onClick);
        b.addEventListener('click', () => {
            queueMicrotask(() => b.blur());
        });
        return b;
    }

    _getSoopApi() {
        return window.VODSync?.soopAPI ?? null;
    }

    _setPublishError(msg) {
        if (!this._publishErrEl) return;
        this._publishErrEl.textContent = msg || '';
    }

    _setPublishSubmitting(on) {
        this._publishSubmitting = !!on;
        if (this._publishSubmitBtn) this._publishSubmitBtn.disabled = !!on;
        if (this._publishBoardSel) this._publishBoardSel.disabled = !!on;
        if (this._publishVodCategorySel) this._publishVodCategorySel.disabled = !!on;
        if (this._publishVodCategorySubSel) this._publishVodCategorySubSel.disabled = !!on;
        if (this._publishLangSel) this._publishLangSel.disabled = !!on;
        if (this._publishTitleInp) this._publishTitleInp.disabled = !!on;
        if (this._publishContentsInp) this._publishContentsInp.disabled = !!on;
    }

    _toggleClipPanelCollapsed() {
        this._clipPanelCollapsed = !this._clipPanelCollapsed;
        this._updateClipPanelCollapseUi();
    }

    _updateClipPanelCollapseUi() {
        if (this._clipPanelEl) this._clipPanelEl.classList.toggle('vs-collapsed', this._clipPanelCollapsed);
        if (this._clipPanelToggleBtn) {
            this._clipPanelToggleBtn.textContent = this._clipPanelCollapsed ? '펼치기' : '접기';
            this._clipPanelToggleBtn.setAttribute('aria-label', this._clipPanelCollapsed ? '편집 구간 목록 펼치기' : '편집 구간 목록 접기');
            this._clipPanelToggleBtn.title = this._clipPanelCollapsed ? '편집 구간 목록 펼치기' : '편집 구간 목록 접기';
        }
    }

    _setSelectOptions(selectEl, list, placeholder, valueKey, labelKey) {
        if (!selectEl) return;
        selectEl.innerHTML = '';
        const ph = document.createElement('option');
        ph.value = '';
        ph.textContent = placeholder;
        selectEl.appendChild(ph);
        for (const it of list) {
            const op = document.createElement('option');
            op.value = String(it[valueKey] ?? '');
            op.textContent = String(it[labelKey] ?? it[valueKey] ?? '');
            if (it.category !== undefined) op.dataset.category = String(it.category);
            selectEl.appendChild(op);
        }
    }

    _collectVodCategoryTree(catRoot) {
        const out = [];
        const roots = catRoot?.CHANNEL?.VOD_CATEGORY;
        if (!Array.isArray(roots)) return out;
        for (const major of roots) {
            const majorName = major?.cate_name;
            const majorVodCategory = major?.cate_no || major?.vod_category;
            if (!majorName || !majorVodCategory) continue;
            const majorCategory = String(major?.ucc_cate || '00210000');
            const node = {
                name: String(majorName),
                vodCategory: String(majorVodCategory),
                category: majorCategory,
                children: [],
            };
            const children = Array.isArray(major?.child) ? major.child : [];
            for (const child of children) {
                const childName = child?.cate_name;
                const childVodCategory = child?.cate_no || child?.vod_category;
                if (!childName || !childVodCategory) continue;
                node.children.push({
                    name: String(childName),
                    vodCategory: String(childVodCategory),
                    category: String(child?.ucc_cate || majorCategory),
                });
            }
            out.push(node);
        }
        return out;
    }

    _fillVodCategorySubOptionsByMain(mainVodCategory) {
        const sel = this._publishVodCategorySubSel;
        if (!sel) return;
        const main = this._publishVodCategoryTree.find((x) => x.vodCategory === String(mainVodCategory));
        const children = main?.children || [];
        if (children.length === 0) {
            this._setSelectOptions(sel, [], '세부 카테고리 없음', 'vodCategory', 'name');
            sel.disabled = true;
            return;
        }
        this._setSelectOptions(sel, children, '카테고리 선택', 'vodCategory', 'name');
        sel.disabled = false;
    }

    _getPublishVodCategorySelection() {
        const mainValue = this._publishVodCategorySel?.value || '';
        if (!mainValue) return null;
        const main = this._publishVodCategoryTree.find((x) => x.vodCategory === String(mainValue));
        if (!main) return null;
        const subValue = this._publishVodCategorySubSel?.value || '';
        if (subValue && Array.isArray(main.children) && main.children.length > 0) {
            const sub = main.children.find((x) => x.vodCategory === String(subValue));
            if (sub) return sub;
        }
        return main;
    }

    _buildPublishEditJobInfo() {
        const block = [];
        for (let i = 0; i < this._clips.length; i++) {
            const c = this._clips[i];
            const startTime = this._roundClipSec(c.begin);
            const endTime = this._roundClipSec(c.end);
            const duration = this._roundClipSec(endTime - startTime);
            if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || !Number.isFinite(duration) || duration <= 0) {
                return null;
            }
            block.push({
                startTime,
                endTime,
                duration,
                idx: i,
                sectionIdx: 0,
            });
        }
        return [block];
    }

    async _resolvePublishLoginId() {
        const vc = this._getVodCore();
        const fromVodCore = vc?.config?.loginId != null ? String(vc.config.loginId) : '';
        if (fromVodCore) return String(fromVodCore);
        const api = this._getSoopApi();
        if (!api || typeof api.GetPrivateInfo !== 'function') return null;
        const priv = await api.GetPrivateInfo();
        return priv?.CHANNEL?.LOGIN_ID ?? null;
    }

    // --- 게시 (모달, API) ---
    async _onPublishButtonClick() {
        if (this._isClipListBusy() || this._publishSubmitting) return;
        const failOpen = (msg) => {
            this._setPublishError(msg);
            alert(msg);
        };
        if (this._clips.length === 0) {
            alert('게시할 편집 구간이 없습니다.');
            return;
        }
        const clipVal = this._clipValidate();
        if (!clipVal.ok) {
            alert(clipVal.message);
            return;
        }
        let anySegmentLt3 = false;
        for (const c of this._clips) {
            const d = this._clipPublishDurationSec(c);
            if (d === null) {
                alert('편집 구간 시각을 확인할 수 없습니다.');
                return;
            }
            if (d < 3) anySegmentLt3 = true;
        }
        const totalClipSec = this._clipTotalDurationSec();
        if (totalClipSec < 15) {
            alert('편집 구간 길이 총합이 15초 이상이어야 합니다.');
            return;
        }
        if (totalClipSec > 1800) {
            alert('편집 구간 길이 총합이 30분(1800초) 이하여야 합니다.');
            return;
        }
        if (anySegmentLt3) {
            alert('3초 미만인 편집 구간이 있습니다. 이는 최종 결과물에 포함되지 않을 것입니다.');
        }
        const api = this._getSoopApi();
        if (!api) {
            alert('soopAPI를 찾을 수 없습니다.');
            return;
        }
        this._setPublishError('');
        this._setPublishSubmitting(true);
        try {
            const titleNo = String(this.titleNo || '');
            if (!titleNo) {
                failOpen('titleNo를 확인할 수 없습니다.');
                return;
            }
            const [webInfo, catTree, loginId] = await Promise.all([
                api.GetSoopVeditorWebVodInfo?.(titleNo),
                api.GetVodEditorCategory?.(),
                this._resolvePublishLoginId(),
            ]);
            if (!loginId) {
                failOpen('로그인 ID를 확인할 수 없습니다.');
                return;
            }
            // 게시판·언어는 stbbs vodInfo.php(mode=web)의 info.bbs / info.langs 사용
            const info = webInfo?.response?.info || {};
            const boards = Array.isArray(info.bbs)
                ? info.bbs
                    .map((b) => ({ bbsNo: b?.bbs_no, name: b?.name }))
                    .filter((b) => b.bbsNo != null && String(b.name || '').trim())
                : [];
            const langsObj = info.langs && typeof info.langs === 'object' ? info.langs : {};
            const langs = Object.keys(langsObj).map((k) => ({ code: k, name: langsObj[k] }));
            const cats = this._collectVodCategoryTree(catTree);
            if (boards.length === 0 || langs.length === 0 || cats.length === 0) {
                failOpen('게시판/카테고리/언어 목록 조회에 실패했습니다.');
                return;
            }
            this._setSelectOptions(this._publishBoardSel, boards, '게시판 선택', 'bbsNo', 'name');
            this._publishVodCategoryTree = cats;
            this._setSelectOptions(this._publishVodCategorySel, cats, '대분류 선택', 'vodCategory', 'name');
            this._fillVodCategorySubOptionsByMain('');
            this._setSelectOptions(this._publishLangSel, langs, '언어 선택', 'code', 'name');
            if (this._publishLangSel) this._publishLangSel.value = 'ko_KR';
            if (this._publishTitleInp) this._publishTitleInp.value = '';
            if (this._publishContentsInp) {
                const vodOrigin = window.VODSync?.SoopUrls?.VOD_ORIGIN || 'https://vod.sooplive.com';
                const reviewUrl = new URL(`${vodOrigin}/player/${titleNo}`);
                const firstClip = this._clips[0];
                if (firstClip) {
                    const sec = this._roundClipSec(Number(firstClip.begin));
                    if (Number.isFinite(sec) && sec >= 0) {
                        reviewUrl.searchParams.set('change_second', String(Math.round(sec)));
                    }
                }
                const head = `원본 다시보기: ${reviewUrl.toString()}`;
                const clipBlock = this._clips
                    .map((c, i) => {
                        const b = this._formatClipTimeInput(c.begin);
                        const e = this._formatClipTimeInput(c.end);
                        const nm = String(c.name || '').trim() || `편집 구간 ${i + 1}`;
                        return `${i + 1}. ${nm}: ${b} ~ ${e}`;
                    })
                    .join('\n');
                this._publishContentsInp.value = `${head}\n${clipBlock}`;
            }
            if (this._publishModalEl) this._publishModalEl.classList.add('vs-open');
        } catch (e) {
            this.error('게시 모달 데이터 로딩 실패', e);
            failOpen('게시 모달을 준비하지 못했습니다.');
        } finally {
            this._setPublishSubmitting(false);
        }
    }

    _closePublishModal() {
        if (this._publishModalEl) this._publishModalEl.classList.remove('vs-open');
        this._setPublishError('');
    }

    async _submitPublishModal() {
        if (this._publishSubmitting) return;
        const board = this._publishBoardSel?.value || '';
        const selectedCategory = this._getPublishVodCategorySelection();
        const lang = (this._publishLangSel?.value || '').trim();
        const title = (this._publishTitleInp?.value || '').trim();
        const contents = (this._publishContentsInp?.value || '').trim();
        if (!board || !selectedCategory?.vodCategory || !lang || !title) {
            this._setPublishError('게시판, VOD 카테고리, 언어, 제목은 필수입니다.');
            return;
        }
        const clipVal = this._clipValidate();
        if (!clipVal.ok) {
            this._setPublishError(clipVal.message);
            return;
        }
        const editJobInfo = this._buildPublishEditJobInfo();
        if (!editJobInfo) {
            this._setPublishError('편집 구간 정보 변환에 실패했습니다.');
            return;
        }
        const api = this._getSoopApi();
        if (!api || typeof api.SetWebEditorJob !== 'function') {
            this._setPublishError('게시 API를 찾을 수 없습니다.');
            return;
        }
        const titleNo = String(this.titleNo || '');
        if (!titleNo) {
            this._setPublishError('titleNo를 확인할 수 없습니다.');
            return;
        }
        this._setPublishSubmitting(true);
        this._setPublishError('');
        try {
            const webInfo = await api.GetSoopVeditorWebVodInfo?.(titleNo);
            const broadNo = webInfo?.response?.info?.broad_no;
            if (!broadNo) {
                this._setPublishError('broadNo를 확인할 수 없습니다.');
                return;
            }
            const res = await api.SetWebEditorJob({
                titleNo,
                broadNo: String(broadNo),
                bbsNo: String(board),
                category: String(selectedCategory.category || '00210000'),
                vodCategory: String(selectedCategory.vodCategory),
                title,
                contents,
                strmLangType: String(lang),
                editType: '1',
                editJobInfo,
            });
            if (!res) {
                this._setPublishError('게시 요청에 실패했습니다.');
                return;
            }
            this._closePublishModal();
            alert(res.MSG || '게시 요청을 전송했습니다.');
        } catch (e) {
            this.error('게시 API 요청 실패', e);
            this._setPublishError('게시 요청 중 오류가 발생했습니다.');
        } finally {
            this._setPublishSubmitting(false);
        }
    }

    // 편집 패널 DOM·CSS·타임라인·편집 구간 표를 생성해 body에 붙이고 이벤트를 연결한다 (최초 오픈 시 한 번).
    _mountOverlayDom() {
        const shell = document.createElement('div');
        shell.id = 'vod-sync-veditor-overlay';
        shell.className = 'vs-veditor-overlay';

        const wrap = document.createElement('div');
        wrap.id = 'vod-sync-veditor-root';
        wrap.className = 'vs-veditor-root vs-veditor-root--overlay';
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-label', '편집 VOD 만들기');

        const style = document.createElement('style');
        style.textContent = SoopVeditorReplacement.OverlayInlineStyles.cssText();
        wrap.appendChild(style);

        this._veditorMountOverlayPanelElements(wrap);

        shell.appendChild(wrap);
        document.body.appendChild(shell);
        this._overlayShell = shell;
        this.rootEl = wrap;

        this._veditorBindOverlayControls();
    }

    /**
     * 오버레이 패널 DOM 트리(타임라인·편집 구간 목록·게시 모달)만 조립한다. 스타일은 `SoopVeditorReplacement.OverlayInlineStyles`.
     * @param {HTMLDivElement} wrap
     */
    _veditorMountOverlayPanelElements(wrap) {
        const titleRow = document.createElement('div');
        titleRow.className = 'vs-veditor-title-row';
        const titleHead = document.createElement('div');
        titleHead.className = 'vs-veditor-title-head';
        const title = document.createElement('div');
        title.className = 'vs-veditor-title';
        title.textContent = 'VOD 편집하기';
        const closeBtn = this._btn('닫기', () => this._hidePanel());
        this._officialVeditorBtn = this._btn('공식 편집기 열기', () => {
            const id = String(this.titleNo || '').trim();
            if (!id) return;
            const url = `https://veditor.sooplive.com/web/${encodeURIComponent(id)}`;
            window.open(url, '_blank', 'noopener,noreferrer');
        });
        this._officialVeditorBtn.title = 'SOOP 공식 웹 편집기(새 탭)';
        this._officialVeditorBtn.setAttribute('aria-label', 'SOOP 공식 웹 편집기 새 탭');
        titleHead.appendChild(title);
        titleHead.appendChild(this._officialVeditorBtn);
        titleRow.appendChild(titleHead);

        this._timelineViewport = document.createElement('div');
        this._timelineViewport.className = 'vs-veditor-timeline-viewport';
        this._timelineInner = document.createElement('div');
        this._timelineInner.className = 'vs-veditor-timeline-inner';
        this._rulerEl = document.createElement('div');
        this._rulerEl.className = 'vs-veditor-ruler';
        this._trackEl = document.createElement('div');
        this._trackEl.className = 'vs-veditor-track';
        this._timelineInner.appendChild(this._rulerEl);
        this._timelineInner.appendChild(this._trackEl);
        this._playheadEl = document.createElement('div');
        this._playheadEl.className = 'vs-veditor-playhead';
        this._playheadEl.setAttribute('role', 'slider');
        this._playheadEl.setAttribute('aria-label', '재생 헤드');
        const phLine = document.createElement('div');
        phLine.className = 'vs-veditor-playhead-line';
        const phHead = document.createElement('div');
        phHead.className = 'vs-veditor-playhead-head';
        this._playheadEl.appendChild(phLine);
        this._playheadEl.appendChild(phHead);
        this._timelineInner.appendChild(this._playheadEl);
        this._timelineViewport.appendChild(this._timelineInner);

        this._timelineScrollBarEl = document.createElement('div');
        this._timelineScrollBarEl.className = 'vs-veditor-timeline-scroll-wrap';
        this._timelineScrollTrackEl = document.createElement('div');
        this._timelineScrollTrackEl.className = 'vs-veditor-timeline-scroll-track';
        this._timelineScrollThumbEl = document.createElement('div');
        this._timelineScrollThumbEl.className = 'vs-veditor-timeline-scroll-thumb';
        this._timelineScrollThumbEl.setAttribute('role', 'slider');
        this._timelineScrollThumbEl.setAttribute('aria-label', '타임라인 가로 스크롤');
        this._timelineScrollTrackEl.appendChild(this._timelineScrollThumbEl);
        this._timelineScrollBarEl.appendChild(this._timelineScrollTrackEl);

        const timelineDock = document.createElement('div');
        timelineDock.className = 'vs-veditor-timeline-dock';
        const seqHeader = document.createElement('div');
        seqHeader.className = 'vs-veditor-seq-header';
        this._timecodeEl = document.createElement('span');
        this._timecodeEl.className = 'vs-veditor-timecode';
        this._timecodeEl.textContent = '00:00:00.000';
        const toolModes = document.createElement('div');
        toolModes.className = 'vs-veditor-timeline-tools';
        this._timelineToolSelectBtn = this._btn('', () => this._setTimelineToolMode('select'));
        this._timelineToolSelectBtn.classList.add('vs-veditor-tool-btn');
        this._timelineToolSelectBtn.innerHTML = SoopVeditorReplacement.TIMELINE_TOOL_SVG_SELECT;
        this._timelineToolSelectBtn.title = '선택 모드 (V)';
        this._timelineToolSelectBtn.setAttribute('aria-label', '선택 모드');
        this._timelineToolCutBtn = this._btn('', () => this._setTimelineToolMode('cut'));
        this._timelineToolCutBtn.classList.add('vs-veditor-tool-btn');
        this._timelineToolCutBtn.innerHTML = SoopVeditorReplacement.TIMELINE_TOOL_SVG_CUT;
        this._timelineToolCutBtn.title = '자르기 모드 (C)';
        this._timelineToolCutBtn.setAttribute('aria-label', '자르기 모드');
        this._timelineLabelModeSelect = document.createElement('select');
        this._timelineLabelModeSelect.className = 'vs-veditor-timeline-label-mode';
        this._timelineLabelModeSelect.title = '타임라인 라벨 표시';
        this._timelineLabelModeSelect.setAttribute('aria-label', '타임라인 라벨 표시');
        this._timelineLabelModeSelect.innerHTML =
            '<option value="index">편집 구간 표시: 순서</option><option value="name">편집 구간 표시: 이름</option>';
        this._timelineLabelModeSelect.value = this._timelineClipLabelMode;
        this._timelineLabelModeSelect.addEventListener('change', () => {
            this._timelineClipLabelMode =
                this._timelineLabelModeSelect && this._timelineLabelModeSelect.value === 'name' ? 'name' : 'index';
            this._renderClipsOnTrack(this._getTotalDurationSec(), this._pixelsPerSecond);
        });
        toolModes.appendChild(this._timelineToolSelectBtn);
        toolModes.appendChild(this._timelineToolCutBtn);
        const seqHeadRight = document.createElement('div');
        seqHeadRight.className = 'vs-veditor-seq-head-right';
        seqHeadRight.appendChild(toolModes);
        const titleActions = document.createElement('div');
        titleActions.className = 'vs-veditor-title-actions';
        titleActions.appendChild(this._timecodeEl);
        titleActions.appendChild(this._timelineLabelModeSelect);
        titleActions.appendChild(closeBtn);
        titleRow.appendChild(titleActions);
        const timelineGraphCol = document.createElement('div');
        timelineGraphCol.className = 'vs-veditor-timeline-graph-col';
        timelineGraphCol.appendChild(this._timelineViewport);
        timelineGraphCol.appendChild(this._timelineScrollBarEl);
        seqHeader.appendChild(seqHeadRight);
        this._sequenceHeaderEl = seqHeader;
        timelineDock.appendChild(seqHeader);
        timelineDock.appendChild(timelineGraphCol);

        const clipCol = document.createElement('div');
        clipCol.className = 'vs-veditor-clip-col';
        const clipToolbar = document.createElement('div');
        clipToolbar.className = 'vs-veditor-clip-toolbar';
        const tbr1 = document.createElement('div');
        tbr1.className = 'vs-veditor-clip-toolbar-row vs-veditor-title-inline-actions';
        this._clipToolbarAddBtn = this._btn('+', () => this._addDefaultClip());
        this._clipToolbarAddBtn.classList.add('vs-veditor-btn-icon');
        this._clipToolbarAddBtn.title = '편집 구간 추가';
        this._clipToolbarAddBtn.setAttribute('aria-label', '편집 구간 추가');
        this._clipToolbarStartBtn = this._btn('[', () => this._applyCurrentAsStart());
        this._clipToolbarStartBtn.classList.add('vs-veditor-btn-icon');
        this._clipToolbarStartBtn.title = '선택한 편집 구간의 시작을 현재 재생 위치로 맞춤 (단축키: [)';
        this._clipToolbarStartBtn.setAttribute('aria-label', '선택한 편집 구간의 시작을 현재 재생 위치로 맞춤');
        this._clipToolbarEndBtn = this._btn(']', () => this._applyCurrentAsEnd());
        this._clipToolbarEndBtn.classList.add('vs-veditor-btn-icon');
        this._clipToolbarEndBtn.title = '선택한 편집 구간의 끝을 현재 재생 위치로 맞춤 (단축키: ])';
        this._clipToolbarEndBtn.setAttribute('aria-label', '선택한 편집 구간의 끝을 현재 재생 위치로 맞춤');
        tbr1.appendChild(this._clipToolbarAddBtn);
        tbr1.appendChild(this._clipToolbarStartBtn);
        tbr1.appendChild(this._clipToolbarEndBtn);
        this._clipToolbarFitBtn = this._btn('[<>]', () => {
            const clips = this._getClips();
            const i = this._selectedClipIndex;
            if (!clips[i]) return;
            this._fitTimelineToClipIndex(i);
        });
        this._clipToolbarFitBtn.classList.add('vs-veditor-btn-icon');
        this._clipToolbarFitBtn.title = '선택한 편집 구간에 타임라인 맞춤';
        this._clipToolbarFitBtn.setAttribute('aria-label', '선택한 편집 구간에 타임라인 맞춤');
        this._clipToolbarPlaySelBtn = this._btn('편집 구간 재생', () => {
            if (this._playAllMode) return;
            const clips = this._getClips();
            const i = this._selectedClipIndex;
            const c = clips[i];
            if (!c) return;
            if (this._playSingleClipMode) {
                this._stopPlayAll(true);
                return;
            }
            this._stopPlayAll(false);
            this._playSingleClipMode = true;
            this._playbackClipEntered = false;
            this._playSingleClipBeginSec = c.begin;
            this._playSingleClipEndSec = c.end;
            this._playAllSeekGraceUntil = performance.now() + 200;
            this._plSeekGlobal(c.begin);
            const v = this._getVideo();
            if (v) v.play().catch(() => {});
            this._syncUiFromState();
            this._updateClipToolbarSelectionActions();
            const tick = () => {
                if (!this._playSingleClipMode || !this._panelVisible) return;
                if (this._playAllSeekGraceUntil && performance.now() < this._playAllSeekGraceUntil) {
                    this._playAllRaf = requestAnimationFrame(tick);
                    return;
                }
                this._playAllSeekGraceUntil = 0;
                this._refreshCachedGlobalPlaybackTime();
                const t = this._cachedGlobalPlaybackSec;
                const begin = this._playSingleClipBeginSec;
                const end = this._playSingleClipEndSec;
                if (SoopVeditorReplacement.ClipBoundaryPlayback.advance(this, t, begin, end) === 'segment_end') {
                    this._stopPlayAll(true);
                    return;
                }
                this._playAllRaf = requestAnimationFrame(tick);
            };
            this._playAllRaf = requestAnimationFrame(tick);
        });
        this._clipToolbarDupBtn = this._btn('복제', () => {
            if (!this._getClips()[this._selectedClipIndex]) return;
            this._duplicateSelectedClip();
        });
        this._clipToolbarDupBtn.title = '선택한 편집 구간 복제';
        this._clipToolbarDupBtn.setAttribute('aria-label', '선택한 편집 구간 복제');
        this._clipToolbarDelBtn = this._btn('삭제', () => {
            const clips = this._getClips();
            const i = this._selectedClipIndex;
            if (!clips[i]) return;
            this._recordClipUndo();
            this._clipRemove(i);
            this._ensureSelectedClipIndex();
            this._syncUiFromState();
        });
        this._clipToolbarDelBtn.title = '선택한 편집 구간 삭제';
        this._clipToolbarDelBtn.setAttribute('aria-label', '선택한 편집 구간 삭제');
        tbr1.appendChild(this._clipToolbarFitBtn);
        tbr1.appendChild(this._clipToolbarPlaySelBtn);
        tbr1.appendChild(this._clipToolbarDupBtn);
        tbr1.appendChild(this._clipToolbarDelBtn);
        this._playbackSpeedSelect = document.createElement('select');
        this._playbackSpeedSelect.className = 'vs-veditor-playback-speed';
        this._playbackSpeedSelect.title = '재생 배속';
        this._playbackSpeedSelect.setAttribute('aria-label', '재생 배속');
        for (const sp of SoopVeditorReplacement.PLAYBACK_SPEED_OPTIONS) {
            const op = document.createElement('option');
            op.value = String(sp);
            op.textContent = `${sp}x`;
            this._playbackSpeedSelect.appendChild(op);
        }
        this._playbackSpeedSelect.value = '1';
        this._playbackSpeedSelect.addEventListener('change', () => {
            const r = parseFloat(this._playbackSpeedSelect?.value || '1');
            this._setPlaybackSpeedFromUi(r);
            this._playbackSpeedSelect?.blur();
        });
        tbr1.appendChild(this._playbackSpeedSelect);
        titleRow.insertBefore(tbr1, titleActions);
        const tbr2 = document.createElement('div');
        tbr2.className = 'vs-veditor-clip-toolbar-row';
        this._clipToolbarTestBtn = this._btn('테스트 시작', () => {
            if (this._playAllMode) {
                this._stopPlayAll();
            } else {
                this._playAllClips();
            }
        });
        this._clipToolbarTestBtn.classList.add('vs-veditor-btn-danger');
        tbr2.appendChild(this._clipToolbarTestBtn);
        this._clipToolbarPublishBtn = this._btn('게시하기', () => this._onPublishButtonClick());
        this._clipToolbarPublishBtn.classList.add('vs-veditor-btn-primary');
        this._clipPlayStatusEl = document.createElement('span');
        this._clipPlayStatusEl.className = 'vs-veditor-clip-play-status';
        this._clipPlayStatusEl.textContent = '';
        this._clipPlayStatusEl.style.display = 'none';
        tbr2.appendChild(this._clipPlayStatusEl);
        this._clipTotalEl = document.createElement('span');
        this._clipTotalEl.className = 'vs-veditor-clip-total';
        this._clipTotalEl.textContent = this._formatClipTotalSumLabel(0);
        tbr2.appendChild(this._clipTotalEl);
        tbr2.appendChild(this._clipToolbarPublishBtn);
        clipToolbar.appendChild(tbr2);

        const clipScroll = document.createElement('div');
        clipScroll.className = 'vs-veditor-clip-scroll';
        this._clipListScrollEl = clipScroll;
        this._bindClipListScrollDelegationOnce();
        clipCol.appendChild(clipToolbar);
        clipCol.appendChild(clipScroll);

        const seqCol = document.createElement('div');
        seqCol.className = 'vs-veditor-seq-col';
        seqCol.appendChild(timelineDock);

        const timelinePanel = document.createElement('div');
        timelinePanel.className = 'vs-veditor-overlay-panel vs-veditor-timeline-panel';
        timelinePanel.setAttribute('role', 'region');
        timelinePanel.setAttribute('aria-label', '타임라인');
        timelinePanel.appendChild(titleRow);
        timelinePanel.appendChild(seqCol);

        const clipPanelHead = document.createElement('div');
        clipPanelHead.className = 'vs-veditor-clip-panel-head';
        const clipPanelTitle = document.createElement('span');
        clipPanelTitle.textContent = '편집 구간 리스트';
        const clipPanelHeadActions = document.createElement('div');
        clipPanelHeadActions.className = 'vs-veditor-clip-panel-head-actions';
        this._timelineCopyActionSel = document.createElement('select');
        this._timelineCopyActionSel.className = 'vs-veditor-playback-speed vs-veditor-timeline-copy-action';
        this._timelineCopyActionSel.title = '모든 편집 구간을 댓글 타임라인 형식으로 복사 (옵션을 선택하면 즉시 복사됩니다.)';
        this._timelineCopyActionSel.setAttribute('aria-label', '모든 편집 구간을 댓글 타임라인 형식으로 복사 (옵션을 선택하면 즉시 복사됩니다.)');
        const promptVal = SoopVeditorReplacement.TIMELINE_COPY_PROMPT_VALUE;
        this._timelineCopyActionSel.innerHTML =
            `<option value="${promptVal}">타임라인 복사(선택하세요)</option>` +
            '<option value="none">이름을 제외하여 복사</option>' +
            '<option value="prefix">이름을 앞에 붙여 복사</option>' +
            '<option value="suffix">이름을 뒤에 붙여 복사</option>';
        this._timelineCopyActionSel.value = promptVal;
        this._timelineCopyActionSel.addEventListener('change', async () => {
            const sel = this._timelineCopyActionSel;
            if (!sel) return;
            if (sel.value === SoopVeditorReplacement.TIMELINE_COPY_PROMPT_VALUE) {
                sel.blur();
                return;
            }
            try {
                await this._copyClipsAsTimelineComment();
            } finally {
                sel.value = SoopVeditorReplacement.TIMELINE_COPY_PROMPT_VALUE;
                sel.blur();
            }
        });
        clipPanelHeadActions.appendChild(this._timelineCopyActionSel);
        this._clipPanelToggleBtn = this._btn('접기', () => this._toggleClipPanelCollapsed());
        this._clipPanelToggleBtn.classList.add('vs-veditor-clip-panel-toggle');
        clipPanelHeadActions.appendChild(this._clipPanelToggleBtn);
        clipPanelHead.appendChild(clipPanelTitle);
        clipPanelHead.appendChild(clipPanelHeadActions);

        const clipPanel = document.createElement('div');
        clipPanel.className = 'vs-veditor-overlay-panel vs-veditor-clip-panel';
        clipPanel.setAttribute('role', 'region');
        clipPanel.setAttribute('aria-label', '편집 구간 목록');
        clipPanel.appendChild(clipPanelHead);
        clipPanel.appendChild(clipCol);
        this._clipPanelEl = clipPanel;

        const dockRow = document.createElement('div');
        dockRow.className = 'vs-veditor-dock-row';
        dockRow.appendChild(timelinePanel);
        dockRow.appendChild(clipPanel);
        wrap.appendChild(dockRow);

        this._rulerHoverTipEl = document.createElement('div');
        this._rulerHoverTipEl.className = 'vs-veditor-ruler-hover-tip';
        this._rulerHoverTipEl.setAttribute('aria-hidden', 'true');
        document.body.appendChild(this._rulerHoverTipEl);

        wrap.addEventListener('change', this._onClipListChange);
        wrap.addEventListener(
            'keydown',
            (e) => {
                if (e.key !== 'Enter') return;
                const t = e.target;
                if (!(t instanceof HTMLElement)) return;
                if (t.closest('input, textarea, select, [contenteditable="true"]') == null) return;
                if (!(t instanceof HTMLInputElement)) return;
                if (!t.classList.contains('vs-veditor-clip-name') && !t.classList.contains('vs-veditor-clip-time-inp'))
                    return;
                if (this._isClipListBusy()) return;
                e.preventDefault();
                e.stopPropagation();
                t.blur();
            },
            true
        );

        const publishModal = document.createElement('div');
        publishModal.className = 'vs-veditor-publish-modal';
        const publishCard = document.createElement('div');
        publishCard.className = 'vs-veditor-publish-card';
        const publishHead = document.createElement('div');
        publishHead.className = 'vs-veditor-publish-head';
        const publishTitle = document.createElement('div');
        publishTitle.textContent = '게시하기';
        const publishClose = document.createElement('button');
        publishClose.type = 'button';
        publishClose.className = 'vs-veditor-publish-close';
        publishClose.textContent = '×';
        publishClose.addEventListener('click', () => this._closePublishModal());
        publishHead.appendChild(publishTitle);
        publishHead.appendChild(publishClose);
        publishCard.appendChild(publishHead);
        const grid = document.createElement('div');
        grid.className = 'vs-veditor-publish-grid';
        const row = (label, required, inputEl) => {
            const box = document.createElement('div');
            const lab = document.createElement('label');
            lab.className = 'vs-veditor-publish-label';
            lab.textContent = label;
            if (required) {
                const req = document.createElement('span');
                req.className = 'vs-veditor-publish-required';
                req.textContent = '*';
                lab.appendChild(req);
            }
            box.appendChild(lab);
            box.appendChild(inputEl);
            return box;
        };
        this._publishBoardSel = document.createElement('select');
        this._publishBoardSel.className = 'vs-veditor-publish-select';
        this._publishVodCategorySel = document.createElement('select');
        this._publishVodCategorySel.className = 'vs-veditor-publish-select';
        this._publishVodCategorySubSel = document.createElement('select');
        this._publishVodCategorySubSel.className = 'vs-veditor-publish-select';
        this._publishVodCategorySel.addEventListener('change', () => {
            this._fillVodCategorySubOptionsByMain(this._publishVodCategorySel?.value || '');
        });
        this._publishLangSel = document.createElement('select');
        this._publishLangSel.className = 'vs-veditor-publish-select';
        this._publishTitleInp = document.createElement('input');
        this._publishTitleInp.type = 'text';
        this._publishTitleInp.className = 'vs-veditor-publish-input vs-veditor-publish-title';
        this._publishTitleInp.placeholder = '제목을 입력해주세요.';
        this._publishContentsInp = document.createElement('textarea');
        this._publishContentsInp.className = 'vs-veditor-publish-textarea';
        this._publishContentsInp.placeholder = '내용을 입력해주세요.';
        grid.appendChild(row('게시판 선택', true, this._publishBoardSel));
        const catWrap = document.createElement('div');
        catWrap.className = 'vs-veditor-publish-category-row';
        catWrap.appendChild(this._publishVodCategorySel);
        catWrap.appendChild(this._publishVodCategorySubSel);
        grid.appendChild(row('VOD 카테고리 선택', true, catWrap));
        grid.appendChild(row('언어 선택', true, this._publishLangSel));
        grid.appendChild(row('제목', true, this._publishTitleInp));
        grid.appendChild(row('내용', false, this._publishContentsInp));
        publishCard.appendChild(grid);
        const desc = document.createElement('div');
        desc.className = 'vs-veditor-publish-desc';
        desc.textContent =
            '* 표시는 필수 입력입니다.\n* 본 영상에서 발생하는 별풍선 및 애드벌룬 수익은 방송한 스트리머에게 전달됩니다.';
        publishCard.appendChild(desc);
        this._publishErrEl = document.createElement('div');
        this._publishErrEl.className = 'vs-veditor-publish-err';
        publishCard.appendChild(this._publishErrEl);
        const actions = document.createElement('div');
        actions.className = 'vs-veditor-publish-actions';
        const cancelBtn = this._btn('취소', () => this._closePublishModal());
        cancelBtn.classList.add('vs-veditor-publish-cancel');
        this._publishSubmitBtn = this._btn('저장', () => this._submitPublishModal());
        this._publishSubmitBtn.classList.add('vs-veditor-publish-submit');
        actions.appendChild(cancelBtn);
        actions.appendChild(this._publishSubmitBtn);
        publishCard.appendChild(actions);
        publishModal.appendChild(publishCard);
        publishModal.addEventListener('click', (e) => {
            if (e.target === publishModal) this._closePublishModal();
        });
        wrap.appendChild(publishModal);
        this._publishModalEl = publishModal;
    }

    /**
     * 오버레이 마운트 직후 플레이헤드·타임라인 입력·리사이즈 등 컨트롤을 연결한다.
     */
    _veditorBindOverlayControls() {
        this._initPlayheadFromVideo();
        this._bindPlayheadAndKeyboard();
        this._bindTimelineWheel();
        this._bindTimelineViewportScrollClamp();
        this._bindTimelineCustomScrollbar();
        this._bindViewportResize();
        this._bindRulerHoverTimeTip();
        this._ensureVideoPlayheadListeners();
        this._updateClipPanelCollapseUi();
        this._syncOfficialVeditorButtonState();
    }

    /** WheelEvent.deltaY 를 대략 픽셀 단위로 통일 (마우스/트랙패드·deltaMode 차이 완화). */
    _wheelDeltaYPixels(ev, viewportEl) {
        let dy = ev.deltaY;
        if (ev.deltaMode === WheelEvent.DOM_DELTA_LINE) dy *= 16;
        else if (ev.deltaMode === WheelEvent.DOM_DELTA_PAGE) dy *= Math.max(viewportEl.clientHeight, 1);
        return dy;
    }

    // 타임라인 뷰포트에 휠 가로 스크롤(Alt 시 줌)을 붙이고 끝에 페인트를 요청한다.
    _bindTimelineWheel() {
        const vp = this._timelineViewport;
        if (!vp) return;
        vp.addEventListener(
            'wheel',
            (ev) => {
                const total = this._getTotalDurationSec();
                const rect = vp.getBoundingClientRect();
                const relX = ev.clientX - rect.left;

                ev.preventDefault();
                if (!ev.altKey) {
                    vp.scrollLeft += this._wheelDeltaYPixels(ev, vp);
                    this._clampViewportScroll(
                        this._getTimelineInnerWidthPx(total, this._pixelsPerSecond)
                    );
                    this._requestTimelinePaint();
                    return;
                }
                const minPps = this._minPpsToFitViewport(total);
                const pps = this._pixelsPerSecond;
                const timeUnder = (vp.scrollLeft + relX) / pps;
                const dy = this._wheelDeltaYPixels(ev, vp);
                const zoomIn = dy < 0;
                const k = SoopVeditorReplacement.ZOOM_WHEEL_EXP_PER_PX;
                const factor = Math.exp(-dy * k);
                let newPps = pps * factor;
                newPps = this._clampPps(newPps, total);
                if (zoomIn && newPps <= minPps * 1.000001) {
                    newPps = this._clampPps(minPps * 1.002, total);
                }
                this._pixelsPerSecond = newPps;
                const innerW = this._getTimelineInnerWidthPx(total, newPps);
                if (this._timelineInner) this._timelineInner.style.width = `${innerW}px`;
                const maxScroll = Math.max(0, innerW - vp.clientWidth);
                let nextScroll = timeUnder * newPps - relX;
                if (!zoomIn && newPps <= minPps * 1.0001) {
                    nextScroll = 0;
                }
                vp.scrollLeft = maxScroll <= 0 ? 0 : Math.max(0, Math.min(nextScroll, maxScroll));
                // scrollLeft 가 0→0 으로 같으면 scroll 이벤트가 안 나와 `_scheduleViewportScrollVisualSync` 가 안 돈다. 썸 너비는 innerW/pps 에 따라 바로 맞춘다.
                this._updateTimelineScrollBarUI();
                this._requestTimelinePaint();
            },
            { passive: false }
        );
    }

    // 자식(재생 헤드·눈금 텍스트)이 밖으로 삐져나가면 scrollWidth 가 커져 슬라이더가 과하게 길어진다.
    // overflow:hidden 으로 막되, 일부 브라우저/상황에서 scrollLeft 가 논리 범위를 넘으면 여기서 클램프한다.
    _bindTimelineViewportScrollClamp() {
        const vp = this._timelineViewport;
        if (!vp) return;
        vp.addEventListener('scroll', () => {
            if (!this._timelineInner) return;
            this._scheduleViewportScrollVisualSync();
        });
    }

    /** 스크롤/썸 조작 시 눈금·스크롤바를 rAF 1회로만 갱신 (연속 scroll 이벤트 합침). */
    _scheduleViewportScrollVisualSync() {
        if (this._viewportScrollVisualRaf != null) return;
        this._viewportScrollVisualRaf = requestAnimationFrame(() => {
            this._viewportScrollVisualRaf = null;
            if (!this._timelineInner || !this._panelVisible) return;
            const total = this._getTotalDurationSec();
            const innerW = this._getTimelineInnerWidthPx(total, this._pixelsPerSecond);
            const vport = this._timelineViewport;
            if (vport) {
                const maxScroll = Math.max(0, innerW - vport.clientWidth);
                if (maxScroll <= 0) vport.scrollLeft = 0;
                else vport.scrollLeft = Math.max(0, Math.min(vport.scrollLeft, maxScroll));
            }
            this._updateTimelineScrollBarUI();
            const pps = this._pixelsPerSecond;
            this._renderRuler(total, pps);
        });
    }

    /** `innerW`·`scrollLeft`에 맞춰 커스텀 가로 스크롤 썸 위치·너비를 맞춘다. */
    _updateTimelineScrollBarUI() {
        const vp = this._timelineViewport;
        const track = this._timelineScrollTrackEl;
        const thumb = this._timelineScrollThumbEl;
        const wrap = this._timelineScrollBarEl;
        if (!vp || !track || !thumb || !wrap) return;
        const total = this._getTotalDurationSec();
        const innerW = this._getTimelineInnerWidthPx(total, this._pixelsPerSecond);
        const cw = Math.max(vp.clientWidth, 1);
        const maxScroll = Math.max(0, innerW - cw);
        const trackW = track.clientWidth;
        if (trackW <= 1) return;

        const minT = SoopVeditorReplacement.TIMELINE_SCROLL_THUMB_MIN_PX;

        if (maxScroll <= 0) {
            wrap.classList.add('vs-disabled');
            const w = Math.max(0, trackW - 4);
            thumb.style.width = `${w}px`;
            thumb.style.left = '2px';
            thumb.setAttribute('aria-valuemin', '0');
            thumb.setAttribute('aria-valuemax', '0');
            thumb.setAttribute('aria-valuenow', '0');
            return;
        }
        wrap.classList.remove('vs-disabled');
        const thumbW = Math.max(minT, (cw / innerW) * trackW);
        const maxThumbLeft = Math.max(0, trackW - thumbW);
        const ratio = maxScroll > 0 ? vp.scrollLeft / maxScroll : 0;
        thumb.style.width = `${thumbW}px`;
        thumb.style.left = `${ratio * maxThumbLeft}px`;
        thumb.setAttribute('aria-valuemin', '0');
        thumb.setAttribute('aria-valuemax', String(Math.round(maxScroll)));
        thumb.setAttribute('aria-valuenow', String(Math.round(vp.scrollLeft)));
    }

    // 네이티브 스크롤바 대신 트랙 클릭·썸 드래그로 `scrollLeft`를 맞춘다.
    _bindTimelineCustomScrollbar() {
        const track = this._timelineScrollTrackEl;
        const thumb = this._timelineScrollThumbEl;
        if (!track || !thumb) return;

        thumb.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            e.preventDefault();
            const vport = this._timelineViewport;
            if (!vport) return;
            const total = this._getTotalDurationSec();
            const innerW = this._getTimelineInnerWidthPx(total, this._pixelsPerSecond);
            const cw = Math.max(vport.clientWidth, 1);
            const maxScroll = Math.max(0, innerW - cw);
            if (maxScroll <= 0) return;
            const trackW = track.clientWidth;
            const thumbW = thumb.clientWidth || SoopVeditorReplacement.TIMELINE_SCROLL_THUMB_MIN_PX;
            const maxThumbLeft = Math.max(0, trackW - thumbW);
            this._scrollThumbDrag = {
                pointerId: e.pointerId,
                startX: e.clientX,
                startScroll: vport.scrollLeft,
                maxScroll,
                maxThumbLeft,
            };
            try {
                thumb.setPointerCapture(e.pointerId);
            } catch (_) {
                /* ignore */
            }
        });

        thumb.addEventListener('pointermove', (e) => {
            if (!this._scrollThumbDrag || e.pointerId !== this._scrollThumbDrag.pointerId) return;
            e.preventDefault();
            this._applyTimelineScrollThumbDrag(e.clientX);
        });

        thumb.addEventListener('pointerup', (e) => {
            this._onTimelineScrollThumbUp(e);
        });
        thumb.addEventListener('pointercancel', (e) => {
            this._onTimelineScrollThumbUp(e);
        });

        track.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            const t = e.target;
            if (t instanceof Node && thumb.contains(t)) return;
            e.preventDefault();
            const vport = this._timelineViewport;
            if (!vport) return;
            const total = this._getTotalDurationSec();
            const innerW = this._getTimelineInnerWidthPx(total, this._pixelsPerSecond);
            const cw = Math.max(vport.clientWidth, 1);
            const maxScroll = Math.max(0, innerW - cw);
            if (maxScroll <= 0) return;
            const rect = track.getBoundingClientRect();
            const trackW = track.clientWidth || rect.width;
            const thumbW = thumb.clientWidth || SoopVeditorReplacement.TIMELINE_SCROLL_THUMB_MIN_PX;
            const maxThumbLeft = Math.max(0, trackW - thumbW);
            const clickX = e.clientX - rect.left;
            let newLeft = clickX - thumbW / 2;
            newLeft = Math.max(0, Math.min(newLeft, maxThumbLeft));
            const r = maxThumbLeft > 0 ? newLeft / maxThumbLeft : 0;
            vport.scrollLeft = r * maxScroll;
            this._clampViewportScroll(innerW);
            this._scheduleViewportScrollVisualSync();
        });
    }

    _applyTimelineScrollThumbDrag(clientX) {
        if (!this._scrollThumbDrag || !this._timelineViewport) return;
        const { startX, startScroll, maxScroll, maxThumbLeft } = this._scrollThumbDrag;
        if (maxThumbLeft <= 0 || maxScroll <= 0) return;
        const dx = clientX - startX;
        const scrollPerPx = maxScroll / maxThumbLeft;
        let sl = startScroll + dx * scrollPerPx;
        sl = Math.max(0, Math.min(sl, maxScroll));
        this._timelineViewport.scrollLeft = sl;
        this._scheduleViewportScrollVisualSync();
    }

    /** @param {PointerEvent} [e] */
    _onTimelineScrollThumbUp(e) {
        const thumb = this._timelineScrollThumbEl;
        const d = this._scrollThumbDrag;
        if (d && thumb) {
            const releaseId = e && e.pointerId === d.pointerId ? e.pointerId : d.pointerId;
            try {
                if (typeof thumb.hasPointerCapture === 'function' && thumb.hasPointerCapture(releaseId)) {
                    thumb.releasePointerCapture(releaseId);
                }
            } catch (_) {
                /* ignore */
            }
        }
        this._scrollThumbDrag = null;
    }

    // 타임라인 너비 변경 시 `_syncUiFromState`로 눈금·줌 하한을 다시 맞춘다.
    _bindViewportResize() {
        const vp = this._timelineViewport;
        if (!vp || typeof ResizeObserver === 'undefined') return;
        this._viewportResizeObs = new ResizeObserver(() => {
            this._syncUiFromState();
        });
        this._viewportResizeObs.observe(vp);
    }

    // 눈금 영역 호버 시 화면 좌표에 맞는 시각 툴팁을 띄운다 (미세 편집 가이드).
    _bindRulerHoverTimeTip() {
        const vp = this._timelineViewport;
        const tip = this._rulerHoverTipEl;
        if (!vp || !tip) return;

        const hide = () => {
            tip.style.display = 'none';
        };

        const flushRulerTip = () => {
            this._rulerTipRaf = null;
            const e = this._rulerTipPendingEv;
            this._rulerTipPendingEv = null;
            if (!e) return;
            const r = vp.getBoundingClientRect();
            const ly = e.clientY - r.top;
            const lx = e.clientX - r.left;
            if (ly < 0 || ly > SoopVeditorReplacement.RULER_HEIGHT_PX || lx < 0 || lx > r.width) {
                hide();
                return;
            }
            const total = this._getTotalDurationSec();
            const sec = this._clientXToTimelineSec(e.clientX, total);
            tip.textContent = this._formatHoverTimelineSec(sec);
            tip.style.display = 'block';
            const tw = tip.offsetWidth || 100;
            const th = tip.offsetHeight || 22;
            let left = e.clientX + 12;
            let top = e.clientY - th - 8;
            if (left + tw > window.innerWidth - 4) left = window.innerWidth - tw - 4;
            if (left < 4) left = 4;
            if (top < 4) top = e.clientY + 16;
            if (top + th > window.innerHeight - 4) top = window.innerHeight - th - 4;
            tip.style.left = `${left}px`;
            tip.style.top = `${top}px`;
        };

        vp.addEventListener('mousemove', (e) => {
            this._rulerTipPendingEv = e;
            if (this._rulerTipRaf != null) return;
            this._rulerTipRaf = requestAnimationFrame(flushRulerTip);
        });

        vp.addEventListener('mouseleave', () => {
            this._rulerTipPendingEv = null;
            if (this._rulerTipRaf != null) {
                cancelAnimationFrame(this._rulerTipRaf);
                this._rulerTipRaf = null;
            }
            hide();
        });
    }

    // 호버 툴팁에 쓸 초 값을 사람이 읽기 쉬운 문자열로 만든다 (분·초·소수).
    _formatHoverTimelineSec(sec) {
        if (!Number.isFinite(sec)) return '';
        const s = Math.max(0, sec);
        if (s < 60) return `${s.toFixed(3)} s`;
        if (s < 3600) {
            const m = Math.floor(s / 60);
            const rem = s - m * 60;
            return `${m}:${String(Math.floor(rem)).padStart(2, '0')}.${(rem % 1).toFixed(3).slice(2)}`;
        }
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const rem = s - h * 3600 - m * 60;
        return `${h}:${String(m).padStart(2, '0')}:${String(Math.floor(rem)).padStart(2, '0')}.${(rem % 1).toFixed(3).slice(2)}`;
    }

    // `<video>`가 바뀌면 메타데이터·재생 이벤트로 헤드 RAF와 UI 동기화를 건다 (동적 플레이어 대응).
    _ensureVideoPlayheadListeners() {
        const v = this._getVideo();
        if (!v || this._playheadVideoBound === v) return;
        this._playheadVideoBound = v;
        v.addEventListener('loadedmetadata', () => {
            this._initPlayheadFromVideo();
            this._syncUiFromState();
        });
        v.addEventListener('playing', () => this._startPlayheadRaf());
        v.addEventListener('pause', this._onVideoPauseSeekForPlayhead);
        v.addEventListener('seeked', this._onVideoPauseSeekForPlayhead);
        v.addEventListener('ended', this._onVideoPauseSeekForPlayhead);
    }

    // 패널이 열려 있을 때 매 프레임(rAF) vodCore·video 재생 시각을 따라 노란 헤드를 갱신한다 (일시정지·시크 포함).
    _startPlayheadRaf() {
        if (!this._panelVisible || !this._playheadEl || this._playheadDragging) return;
        if (this._playheadRafId != null) return;
        this._playheadRafId = requestAnimationFrame(this._tickPlayheadPanelSync);
    }

    // 재생 헤드 RAF를 취소해 루프를 멈춘다 (패널 닫기·드래그 시작).
    _stopPlayheadRaf() {
        if (this._playheadRafId != null) {
            cancelAnimationFrame(this._playheadRafId);
            this._playheadRafId = null;
        }
    }

    _tickPlayheadPanelSync() {
        this._playheadRafId = null;
        if (!this._panelVisible || !this._playheadEl || this._playheadDragging) return;
        this._refreshCachedGlobalPlaybackTime();
        const total = this._getTotalDurationSec();
        this._playheadSec = Math.max(0, Math.min(total, this._computePlayheadDisplaySec(total)));
        this._updatePlayheadVisual(total);
        this._updateSequenceHeaderUi(total);
        if (this._panelVisible && !this._playheadDragging) {
            this._playheadRafId = requestAnimationFrame(this._tickPlayheadPanelSync);
        }
    }

    // 총 길이와 현재 재생 위치로 재생 헤드 초기 위치를 맞춘다 (메타데이터 로드·패널 마운트 직후).
    _initPlayheadFromVideo() {
        this._resetPlayheadExtrap();
        const total = this._getTotalDurationSec();
        this._refreshCachedGlobalPlaybackTime();
        this._playheadSec = Math.max(0, Math.min(total, this._cachedGlobalPlaybackSec));
        this._updatePlayheadVisual(total);
    }

    // 비디오 이벤트 시 한 프레임 더 빨리 헤드를 맞춤 (rAF 와 병행; 패널 닫힘이면 무시).
    _onVideoPauseSeekForPlayhead() {
        if (this._playheadDragging || !this._panelVisible || !this._playheadEl) return;
        this._resetPlayheadExtrap();
        const total = this._getTotalDurationSec();
        this._refreshCachedGlobalPlaybackTime();
        this._playheadSec = Math.max(0, Math.min(total, this._cachedGlobalPlaybackSec));
        this._updatePlayheadVisual(total);
    }

    // `_playheadSec`을 총 길이 안으로 클램프하고 헤드 위치·ARIA 값을 갱신한다 (거의 모든 타임라인 갱신 경로).
    _updatePlayheadVisual(totalSec) {
        if (!this._playheadEl) return;
        const total = totalSec !== undefined ? totalSec : this._getTotalDurationSec();
        const pps = this._pixelsPerSecond;
        const t = Math.max(0, Math.min(total, this._playheadSec));
        this._playheadSec = t;
        this._playheadEl.style.left = `${t * pps}px`;
        const max = Math.max(0, total);
        this._playheadEl.setAttribute('aria-valuemin', '0');
        this._playheadEl.setAttribute('aria-valuemax', String(max));
        this._playheadEl.setAttribute('aria-valuenow', String(Math.round(t * 1000) / 1000));
    }

    // 현재 헤드 시각으로 실제 VOD 재생을 옮기고 헤드 표시를 맞춘다 (눈금 클릭·헤드 드래그 종료 시).
    _seekVideoToPlayhead(totalSec) {
        const total = totalSec !== undefined ? totalSec : this._getTotalDurationSec();
        const t = Math.max(0, Math.min(total, this._playheadSec));
        this._plSeekGlobal(t);
        this._updatePlayheadVisual(total);
    }

    // 화면 X좌표를 타임라인 상의 초 단위 시각으로 변환한다 (눈금 클릭·드래그·툴팁).
    _clientXToTimelineSec(clientX, totalSec) {
        const vp = this._timelineViewport;
        if (!vp) return this._playheadSec;
        const rect = vp.getBoundingClientRect();
        const x = clientX - rect.left + vp.scrollLeft;
        const total = totalSec !== undefined ? totalSec : this._getTotalDurationSec();
        const pps = this._pixelsPerSecond;
        return Math.max(0, Math.min(total, x / pps));
    }

    // 눈금 클릭으로 시크·헤드 드래그(끝에서만 시크)·키보드 단축키(V/C 등)를 연결한다.
    _bindPlayheadAndKeyboard() {
        const vp = this._timelineViewport;
        const ph = this._playheadEl;
        if (!vp || !ph) return;

        vp.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (e.target.closest('.vs-veditor-playhead')) return;
            if (!e.target.closest('.vs-veditor-ruler')) return;
            e.preventDefault();
            const total = this._getTotalDurationSec();
            this._playheadSec = this._clientXToTimelineSec(e.clientX, total);
            this._seekVideoToPlayhead(total);
        });

        ph.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            this._playheadDragging = true;
            this._stopPlayheadRaf();
            const total = this._getTotalDurationSec();
            this._playheadSec = this._clientXToTimelineSec(e.clientX, total);
            this._updatePlayheadVisual(total);
            document.addEventListener('mousemove', this._onPlayheadPointerMove);
            document.addEventListener('mouseup', this._onPlayheadPointerUp);
        });

        window.addEventListener('keydown', this._onPlayheadKeydown, true);
    }

    // 헤드 드래그 중에는 시각만 갱신하고, seek 는 pointerup 에서 한 번만 보낸다.
    _onPlayheadPointerMove(e) {
        if (!this._playheadDragging) return;
        const total = this._getTotalDurationSec();
        this._playheadSec = this._clientXToTimelineSec(e.clientX, total);
        this._updatePlayheadVisual(total);
    }

    // 헤드 드래그 종료 시 seek 1회 후 리스너 제거.
    _onPlayheadPointerUp() {
        if (!this._playheadDragging) return;
        document.removeEventListener('mousemove', this._onPlayheadPointerMove);
        document.removeEventListener('mouseup', this._onPlayheadPointerUp);
        this._playheadDragging = false;
        const total = this._getTotalDurationSec();
        this._seekVideoToPlayhead(total);
        this._resetPlayheadExtrap();
        this._startPlayheadRaf();
    }

    // 패널이 열린 상태에서 V/C(도구), [/](편집 구간 경계←현재), {/}(재생→편집 구간 경계), Ctrl+D·Ctrl+Z·Delete 단축키를 처리한다.
    _onPlayheadKeydown(e) {
        if (!this._panelVisible) return;
        const t = e.target;
        if (!(t instanceof HTMLElement)) return;
        if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '[' || e.key === ']' || e.key === '{' || e.key === '}')) {
            if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
            if (this._isClipListBusy()) return;
            e.preventDefault();
            e.stopPropagation();
            if (e.key === '[') {
                this._applyCurrentAsStart();
                return;
            }
            if (e.key === ']') {
                this._applyCurrentAsEnd();
                return;
            }
            if (e.key === '{') {
                this._seekPlaybackToSelectedClipBoundary(false);
                return;
            }
            this._seekPlaybackToSelectedClipBoundary(true);
            return;
        }
        if (!e.ctrlKey && !e.metaKey && (e.key === 'v' || e.key === 'V')) {
            if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
            e.preventDefault();
            e.stopPropagation();
            this._setTimelineToolMode('select');
            return;
        }
        if (!e.ctrlKey && !e.metaKey && (e.key === 'c' || e.key === 'C')) {
            if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
            e.preventDefault();
            e.stopPropagation();
            this._setTimelineToolMode('cut');
            return;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
            if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
            if (this._isClipListBusy()) return;
            e.preventDefault();
            e.stopPropagation();
            this._duplicateSelectedClip();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
            if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
            if (this._isClipListBusy()) return;
            e.preventDefault();
            e.stopPropagation();
            const snapshot = this._clipUndoStack.pop();
            if (snapshot) {
                this._clips = snapshot.clips.map((c) => this._cloneClipForUndo(c));
                this._selectedClipIndex = Number.isFinite(snapshot.selectedClipIndex) ? snapshot.selectedClipIndex : 0;
                this._ensureSelectedClipIndex();
                this._syncUiFromState();
            }
            return;
        }
        if (e.key === 'Delete' || e.code === 'Delete') {
            if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
            if (this._isClipListBusy()) return;
            const clips = this._getClips();
            const i = this._selectedClipIndex;
            if (!clips[i]) return;
            e.preventDefault();
            e.stopPropagation();
            this._recordClipUndo();
            this._clipRemove(i);
            this._ensureSelectedClipIndex();
            this._syncUiFromState();
            return;
        }
    }

    // 현재 재생 시각 기준 0분 ~ +20초 기본 편집 구간을 추가한다 (리스트 하단 + 버튼).
    _addDefaultClip() {
        if (this._isClipListBusy()) return;
        const cur = this._cachedGlobalPlaybackSec;
        const total = this._getTotalDurationSec();
        const begin = Math.max(0, cur);
        const end = Math.min(total, cur + 20);
        this._recordClipUndo();
        this._clipAdd(begin, end);
        const clips = this._getClips();
        this._selectedClipIndex = Math.max(0, clips.length - 1);
        this._syncUiFromState();
    }

    // 선택한 편집 구간의 시작을 현재 재생 시각으로 맞추거나, 편집 구간이 없으면 짧은 구간을 새로 만든다.
    _applyCurrentAsStart() {
        if (this._isClipListBusy()) return;
        if (!this._getVideo()) {
            this.warn('video 요소 없음');
            return;
        }
        const clips = this._getClips();
        const cur = this._cachedGlobalPlaybackSec;
        if (clips.length === 0) {
            if (cur < 0) {
                window.alert('시작 시각이 음수가 되어 편집 구간을 만들 수 없습니다.');
                return;
            }
            this._recordClipUndo();
            this._clipAdd(cur, Math.min(cur + 10, this._getTotalDurationSec()));
            this._selectedClipIndex = 0;
        } else {
            const idx = Math.min(this._selectedClipIndex, clips.length - 1);
            const clipRef = clips[idx];
            if (cur > clipRef.end) {
                window.alert('현재 시각이 종점보다 뒤라 시점으로 설정할 수 없습니다.');
                return;
            }
            this._recordClipUndo();
            this._clipUpdate(idx, { begin: cur });
            this._syncSelectionToClip(clipRef);
        }
        this._syncUiFromState();
    }

    /** 선택한 편집 구간의 시작(false)·끝(true) 시각으로 재생·타임라인 헤드를 옮긴다 ({ / } 단축키). */
    _seekPlaybackToSelectedClipBoundary(toEnd) {
        if (this._isClipListBusy()) return;
        const clips = this._getClips();
        if (clips.length === 0) return;
        const idx = Math.min(Math.max(0, this._selectedClipIndex), clips.length - 1);
        const clip = clips[idx];
        if (!clip) return;
        const total = this._getTotalDurationSec();
        const raw = toEnd ? clip.end : clip.begin;
        const t = Math.max(0, Math.min(total, Number(raw)));
        if (!Number.isFinite(t)) return;
        this._playheadSec = t;
        this._resetPlayheadExtrap();
        this._plSeekGlobal(t);
        this._updatePlayheadVisual(total);
        this._updateSequenceHeaderUi(total);
        this._refreshCachedGlobalPlaybackTime();
        this._startPlayheadRaf();
    }

    // 선택한 편집 구간의 끝을 현재 재생 시각으로 맞추거나, 편집 구간이 없으면 짧은 구간을 새로 만든다.
    _applyCurrentAsEnd() {
        if (this._isClipListBusy()) return;
        if (!this._getVideo()) {
            this.warn('video 요소 없음');
            return;
        }
        const clips = this._getClips();
        const cur = this._cachedGlobalPlaybackSec;
        if (clips.length === 0) {
            const begin = cur - 10;
            if (begin < 0) {
                window.alert('시작 시각이 음수가 되어 편집 구간을 만들 수 없습니다.');
                return;
            }
            this._recordClipUndo();
            this._clipAdd(begin, cur);
            this._selectedClipIndex = 0;
        } else {
            const idx = Math.min(this._selectedClipIndex, clips.length - 1);
            const clipRef = clips[idx];
            if (cur < clipRef.begin) {
                window.alert('현재 시각이 시점보다 앞이라 종점으로 설정할 수 없습니다.');
                return;
            }
            this._recordClipUndo();
            this._clipUpdate(idx, { end: cur });
            this._syncSelectionToClip(clipRef);
        }
        this._syncUiFromState();
    }

    // `_selectedClipIndex`가 편집 구간 개수 범위 안에 있게 보정한다 (삭제·정렬 후).
    _ensureSelectedClipIndex() {
        const n = this._getClips().length;
        if (n === 0) {
            this._selectedClipIndex = 0;
            return;
        }
        if (this._selectedClipIndex >= n) this._selectedClipIndex = n - 1;
        if (this._selectedClipIndex < 0) this._selectedClipIndex = 0;
    }

    /** 편집 구간이 없으면 맞춤·복제·삭제 툴바 버튼을 비활성화한다. */
    _updateClipToolbarSelectionActions() {
        const clips = this._getClips();
        const n = clips.length;
        const ok = n > 0 && this._selectedClipIndex >= 0 && this._selectedClipIndex < n;
        const busy = this._isClipListBusy();
        const dis = !ok || busy;
        if (this._clipToolbarFitBtn) this._clipToolbarFitBtn.disabled = !ok;
        for (const b of [this._clipToolbarDupBtn, this._clipToolbarDelBtn]) {
            if (b) b.disabled = dis;
        }
        if (this._clipToolbarAddBtn) this._clipToolbarAddBtn.disabled = busy;
        for (const b of [this._clipToolbarStartBtn, this._clipToolbarEndBtn]) {
            if (b) b.disabled = dis;
        }
        if (this._clipToolbarPlaySelBtn) {
            this._clipToolbarPlaySelBtn.disabled = !ok || this._playAllMode;
            const segLabel = this._playSingleClipMode ? '[■]' : '[▶]';
            this._clipToolbarPlaySelBtn.textContent = segLabel
            this._clipToolbarPlaySelBtn.title = this._playSingleClipMode ? '선택된 편집 구간 정지' : '선택된 편집 구간 재생';
            this._clipToolbarPlaySelBtn.setAttribute('aria-label', segLabel);
        }
        if (this._clipToolbarTestBtn) {
            this._clipToolbarTestBtn.textContent = this._playAllMode ? '테스트 중지' : '테스트 시작';
            this._clipToolbarTestBtn.title = this._playAllMode ? '테스트 중지' : '테스트 시작';
        }
        if (this._timelineCopyActionSel) this._timelineCopyActionSel.disabled = n === 0 || busy;
        if (this._clipToolbarPublishBtn) this._clipToolbarPublishBtn.disabled = busy;
    }

    // 객체 참조로 선택 행을 맞춘 뒤 인덱스 범위를 다시 검증한다 (표 변경·드래그 후).
    _syncSelectionToClip(clipRef) {
        if (clipRef) {
            const i = this._getClips().indexOf(clipRef);
            if (i >= 0) this._selectedClipIndex = i;
        }
        this._ensureSelectedClipIndex();
    }

    /**
     * 다음 프레임에 타임라인을 다시 그린다 (디바운스).
     * @param {boolean} [rulerOnly] true 이면 가로 스크롤 등으로 보이는 눈금 구간만 갱신 (편집 구간·헤드는 생략).
     */
    _requestTimelinePaint(rulerOnly) {
        if (this._wheelPaintRaf) cancelAnimationFrame(this._wheelPaintRaf);
        this._wheelPaintRaf = requestAnimationFrame(() => {
            this._wheelPaintRaf = 0;
            const total = this._getTotalDurationSec();
            const pps = this._pixelsPerSecond;
            this._renderRuler(total, pps);
            if (!rulerOnly) {
                this._renderClipsOnTrack(total, pps);
                this._updatePlayheadVisual(total);
            }
            this._updateTimelineScrollBarUI();
        });
    }

    // --- 타임라인·편집 구간 패널 뷰 동기화 (조율자 `_syncUiFromState`) ---
    // 내부 상태를 기준으로 타임라인 너비·눈금·트랙·표·미리보기·헤드를 전부 동기화한다 (데이터 변경의 단일 진입점).
    _syncUiFromState() {
        this._migrateClipShape();
        this._ensureVideoPlayheadListeners();
        const total = this._getTotalDurationSec();
        this._ensureSelectedClipIndex();
        const vp = this._timelineViewport;
        let initialWindowStartSec = null;
        if (
            this._veditorInitialTimelineZoomPending &&
            this._timelineInner &&
            total > 0 &&
            vp &&
            vp.clientWidth > 0
        ) {
            this._veditorInitialTimelineZoomPending = false;
            this._refreshCachedGlobalPlaybackTime();
            const cur = Math.max(0, Math.min(total, this._cachedGlobalPlaybackSec));
            const start = Math.max(0, cur - 300);
            const end = Math.min(total, cur + 300);
            const span = Math.max(1e-6, end - start);
            this._pixelsPerSecond = this._clampPps(vp.clientWidth / span, total);
            initialWindowStartSec = start;
        }
        this._pixelsPerSecond = this._clampPps(this._pixelsPerSecond, total);
        const pps = this._pixelsPerSecond;
        const innerW = this._getTimelineInnerWidthPx(total, pps);
        if (this._timelineInner) this._timelineInner.style.width = `${innerW}px`;
        if (vp && initialWindowStartSec !== null) {
            vp.scrollLeft = Math.max(0, initialWindowStartSec * pps);
        }
        this._clampViewportScroll(innerW);

        this._renderRuler(total, pps);
        this._renderClipsOnTrack(total, pps);
        this._syncClipList();
        this._updateTimelineToolModeUi();
        this._updateClipToolbarSelectionActions();
        this._updateSequenceHeaderUi(total);
        this._updatePlayheadVisual(total);
        queueMicrotask(() => this._updateTimelineScrollBarUI());
    }

    // 현재 스크롤·줌 기준 보이는 시간 구간 [t0,t1](초)을 여유 패딩 포함해 구한다 (눈금만 그릴 때).
    _getVisibleTimelineRangeSec(total, pps) {
        const vp = this._timelineViewport;
        const sl = vp ? vp.scrollLeft : 0;
        const vw = vp ? Math.max(vp.clientWidth, 1) : 1;
        const padSec = 40 / pps;
        let t0 = Math.max(0, sl / pps - padSec);
        let t1 = Math.min(total, (sl + vw) / pps + padSec);
        if (t1 <= t0) {
            t0 = 0;
            t1 = total;
        }
        return { t0, t1 };
    }

    // 주 눈금 간격에서 보조 눈금 간격(초)을 고른다 (픽셀 간격이 너무 촘촘해지지 않게).
    _minorStepFromMajor(majorStep, pps) {
        if (!Number.isFinite(majorStep) || majorStep <= 0) return 0;
        const MIN_PX = 5;
        for (const n of [10, 5, 4, 2]) {
            const m = majorStep / n;
            if (m * pps >= MIN_PX && m < majorStep - 1e-12) return m;
        }
        return 0;
    }

    // 시각 t가 주 눈금 격자에 거의 걸리는지 본다 (보조 눈금과 겹침 방지).
    _isNearlyOnMajorTick(t, majorStep) {
        if (!Number.isFinite(majorStep) || majorStep <= 0) return false;
        const q = t / majorStep;
        return Math.abs(q - Math.round(q)) < 1e-4;
    }

    // 보이는 구간과 줌에 맞는 주/보조 눈금 간격을 결정한다 (`_renderRuler` 직전).
    _getRulerTickLayout(total, pps) {
        const { t0, t1 } = this._getVisibleTimelineRangeSec(total, pps);
        const span = Math.max(t1 - t0, 1e-6);
        const minStepFromPx = 52 / pps;
        const targetTicks = 10;
        const idealStep = span / targetTicks;
        const rough = Math.max(minStepFromPx, idealStep);
        const majorStep = this._pickEditorRulerStepSec(rough);
        const minorStep = this._minorStepFromMajor(majorStep, pps);
        return { t0, t1, majorStep, minorStep };
    }

    /**
     * @param {number} total
     * @param {number} pps
     */
    _renderRuler(total, pps) {
        if (!this._rulerEl) return;
        const { t0, t1, majorStep, minorStep } = this._getRulerTickLayout(total, pps);

        this._rulerEl.innerHTML = '';

        if (minorStep > 0) {
            let nMin = 0;
            const tMinor0 = Math.floor(t0 / minorStep) * minorStep;
            for (let t = tMinor0; t <= t1 + minorStep * 0.001 && nMin < SoopVeditorReplacement.MAX_MINOR_TICKS; t += minorStep) {
                if (t < -0.001 || t > total + 0.001) continue;
                if (this._isNearlyOnMajorTick(t, majorStep)) continue;
                const m = document.createElement('div');
                m.className = 'vs-veditor-tick-minor';
                m.style.left = `${t * pps}px`;
                this._rulerEl.appendChild(m);
                nMin++;
            }
        }

        const tStart = Math.floor(t0 / majorStep) * majorStep;
        let nMaj = 0;
        for (let t = tStart; t <= t1 + majorStep * 0.001 && nMaj < SoopVeditorReplacement.MAX_RULER_TICKS; t += majorStep) {
            if (t < -0.001 || t > total + 0.001) continue;
            const tick = document.createElement('div');
            tick.className = 'vs-veditor-tick-major';
            tick.style.left = `${t * pps}px`;
            tick.textContent = this._formatTimeLabel(t, majorStep);
            this._rulerEl.appendChild(tick);
            nMaj++;
        }
    }

    // 대략적인 목표 간격(초)에 맞는 표준 눈금 스텝을 고르거나 배수로 확장한다.
    _pickEditorRulerStepSec(roughSec) {
        if (!Number.isFinite(roughSec) || roughSec <= 0) return 1;
        for (const s of SoopVeditorReplacement.EDITOR_RULER_STEPS_SEC) {
            if (s >= roughSec - 1e-12) return s;
        }
        let s =
            SoopVeditorReplacement.EDITOR_RULER_STEPS_SEC[
                SoopVeditorReplacement.EDITOR_RULER_STEPS_SEC.length - 1
            ];
        while (s < roughSec) s *= 2;
        return s;
    }

    // 눈금에 찍을 시각 레이블 문자열을 만든다 (스텝이 작으면 소수 초 표기).
    _formatTimeLabel(sec, stepSec) {
        if (!Number.isFinite(sec)) return '';
        const st = stepSec !== undefined && stepSec > 0 ? stepSec : 1;
        const subSecTicks = st < 1;
        const dec = st >= 0.1 ? 1 : 2;
        const quant = 10 ** dec;
        const sDisp = subSecTicks ? Math.round(sec * quant) / quant : Math.round(sec);

        if (!subSecTicks) {
            if (sDisp < 60) return `${sDisp}s`;
            if (sDisp < 3600) {
                const m = Math.floor(sDisp / 60);
                const s = Math.floor(sDisp % 60);
                return `${m}:${String(s).padStart(2, '0')}`;
            }
            const h = Math.floor(sDisp / 3600);
            const m = Math.floor((sDisp % 3600) / 60);
            const s = Math.floor(sDisp % 60);
            return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }

        if (sDisp < 60) return `${sDisp.toFixed(dec)}s`;
        if (sDisp < 3600) {
            const mi = Math.floor(sDisp / 60);
            const ss = sDisp - mi * 60;
            const ssStr = ss.toFixed(dec);
            const [intP, fracP] = ssStr.split('.');
            return `${mi}:${intP.padStart(2, '0')}.${fracP}`;
        }
        const h = Math.floor(sDisp / 3600);
        const rem = sDisp - h * 3600;
        const mi = Math.floor(rem / 60);
        const ss = rem - mi * 60;
        const ssStr = ss.toFixed(dec);
        const [intP, fracP] = ssStr.split('.');
        return `${h}:${String(mi).padStart(2, '0')}:${intP.padStart(2, '0')}.${fracP}`;
    }

    /**
     * @param {number} total
     * @param {number} pps
     */
    _renderClipsOnTrack(total, pps) {
        if (!this._trackEl) return;
        this._trackEl.innerHTML = '';
        this._trackEl.classList.toggle('vs-tool-cut', this._timelineToolMode === 'cut');
        const clips = this._getClips();
        clips.forEach((c, idx) => {
            if (c.visibleOnTimeline === false) return;
            const el = document.createElement('div');
            el.className = 'vs-veditor-clip';
            el.dataset.clipIndex = String(idx);
            if (idx === this._selectedClipIndex) el.classList.add('vs-selected');
            el.style.left = `${c.begin * pps}px`;
            el.style.width = `${Math.max(2, (c.end - c.begin) * pps)}px`;

            const leftH = document.createElement('div');
            leftH.className = 'vs-veditor-clip-handle vs-left';
            leftH.title = '시작 지점';
            const body = document.createElement('div');
            body.className = 'vs-veditor-clip-body';
            body.title = '드래그하여 편집 구간 이동';
            const rightH = document.createElement('div');
            rightH.className = 'vs-veditor-clip-handle vs-right';
            rightH.title = '끝 지점';
            const label = document.createElement('div');
            label.className = 'vs-veditor-clip-order';
            label.textContent = this._timelineClipLabelMode === 'name' ? c.name : String(idx + 1);
            label.title = this._timelineClipLabelMode === 'name' ? c.name : `편집 구간 순서 ${idx + 1}`;
            el.appendChild(leftH);
            el.appendChild(body);
            el.appendChild(label);
            el.appendChild(rightH);

            leftH.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this._timelineToolMode === 'cut') {
                    this._splitClipAtClientX(idx, e.clientX, total);
                    return;
                }
                const root = el;
                this._beginClipDrag(c, 'resize-start', e.clientX, total, root);
            });
            body.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._selectedClipIndex = idx;
                if (this._timelineToolMode === 'cut') {
                    this._splitClipAtClientX(idx, e.clientX, total);
                    return;
                }
                const root = el;
                this._beginClipDrag(c, 'move', e.clientX, total, root);
            });
            rightH.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this._timelineToolMode === 'cut') {
                    this._splitClipAtClientX(idx, e.clientX, total);
                    return;
                }
                const root = el;
                this._beginClipDrag(c, 'resize-end', e.clientX, total, root);
            });

            this._trackEl.appendChild(el);
        });
    }

    _setTimelineToolMode(mode) {
        if (mode !== 'select' && mode !== 'cut') return;
        if (this._timelineToolMode === mode) return;
        this._timelineToolMode = mode;
        this._updateTimelineToolModeUi();
        this._renderClipsOnTrack(this._getTotalDurationSec(), this._pixelsPerSecond);
    }

    _updateTimelineToolModeUi() {
        const isSelect = this._timelineToolMode === 'select';
        const isCut = this._timelineToolMode === 'cut';
        if (this._timelineToolSelectBtn) {
            this._timelineToolSelectBtn.classList.toggle('vs-active', isSelect);
            this._timelineToolSelectBtn.setAttribute('aria-pressed', isSelect ? 'true' : 'false');
        }
        if (this._timelineToolCutBtn) {
            this._timelineToolCutBtn.classList.toggle('vs-active', isCut);
            this._timelineToolCutBtn.setAttribute('aria-pressed', isCut ? 'true' : 'false');
        }
        if (this._trackEl) this._trackEl.classList.toggle('vs-tool-cut', isCut);
    }

    /**
     * 자르기로 생기는 오른쪽 구간 이름. 이미 `... (n)` 꼴이면 stem을 괄호 앞까지로 보고 `(n+1)`… 로 채번(예: `ABC (2)` → `ABC (3)`).
     * 그 외에는 전체 이름 뒤에 `(2)`, `(3)`… 를 붙인다. 이름이 비면 `편집 구간 (행번호)` 기준.
     */
    _allocateNameForClipSplit(sourceClip, sourceIdx) {
        const trimmed = String(sourceClip?.name ?? '').trim();
        const fallbackBase = trimmed !== '' ? trimmed : `편집 구간 ${sourceIdx + 1}`;
        const used = new Set(
            this._clips.map((c) => String(c.name ?? '').trim()).filter((s) => s !== '')
        );
        const parenSuffix = fallbackBase.match(/^(.+)\s\((\d+)\)$/);
        if (parenSuffix) {
            const stem = parenSuffix[1];
            const n0 = parseInt(parenSuffix[2], 10);
            if (Number.isFinite(n0)) {
                for (let k = n0 + 1; k < 10000; k++) {
                    const candidate = `${stem} (${k})`;
                    if (!used.has(candidate)) return candidate;
                }
                return `${stem} (${Date.now()})`;
            }
        }
        for (let n = 2; n < 10000; n++) {
            const candidate = `${fallbackBase} (${n})`;
            if (!used.has(candidate)) return candidate;
        }
        return `${fallbackBase} (${Date.now()})`;
    }

    _splitClipAtClientX(clipIdx, clientX, totalSec) {
        if (this._isClipListBusy()) return;
        const clip = this._clips[clipIdx];
        if (!clip) return;
        const total = totalSec !== undefined ? totalSec : this._getTotalDurationSec();
        const minD = SoopVeditorReplacement.CLIP_MIN_DURATION;
        let cut = this._roundClipSec(this._clientXToTimelineSec(clientX, total));
        if (!Number.isFinite(cut)) return;
        cut = Math.max(clip.begin + minD, Math.min(clip.end - minD, cut));
        if (!(cut > clip.begin + 1e-9 && cut < clip.end - 1e-9)) return;
        this._recordClipUndo();
        const oldEnd = clip.end;
        clip.end = cut;
        this._clips.splice(clipIdx + 1, 0, {
            name: this._allocateNameForClipSplit(clip, clipIdx),
            begin: cut,
            end: oldEnd,
            visibleOnTimeline: clip.visibleOnTimeline !== false,
        });
        this._selectedClipIndex = clipIdx + 1;
        this._syncUiFromState();
    }

    // 편집 구간 리사이즈 또는 이동 드래그를 시작하고 document에 move/up 리스너를 단다.
    /**
     * @param {VeditorClip} clip
     * @param {string} mode
     * @param {number} clientX
     * @param {number} total
     * @param {HTMLElement|null} [dragRootEl] `.vs-veditor-clip` 루트 — 있으면 드래그 중 전체 트랙 재빌드 대신 위치만 갱신
     */
    _beginClipDrag(clip, mode, clientX, total, dragRootEl) {
        if (this._isClipListBusy()) return;
        this._clipDrag = {
            clip,
            mode,
            startX: clientX,
            origBegin: clip.begin,
            origEnd: clip.end,
            total,
            undoSnapshot: this._snapshotClipStateForUndo(),
            dragEl: dragRootEl instanceof HTMLElement ? dragRootEl : null,
            moveRaf: 0,
            pendingClientX: clientX,
        };
        document.addEventListener('mousemove', this._onClipResizeMove);
        document.addEventListener('mouseup', this._onClipResizeEnd);
    }

    /**
     * 드래그 중 모델·(가능하면) 해당 편집 구간 DOM만 갱신. mousemove 는 rAF 로 합쳐 프레임당 1회.
     * @param {number} clientX
     */
    _applyClipDragAtClientX(clientX) {
        const d = this._clipDrag;
        if (!d) return;
        const { clip, mode, startX, origBegin, origEnd, total } = d;
        const pps = this._pixelsPerSecond;
        const dt = (clientX - startX) / pps;
        const minD = SoopVeditorReplacement.CLIP_MIN_DURATION;
        if (mode === 'resize-start') {
            let begin = origBegin + dt;
            begin = Math.max(0, Math.min(begin, origEnd - minD));
            clip.begin = begin;
        } else if (mode === 'resize-end') {
            let end = origEnd + dt;
            end = Math.min(total, Math.max(end, origBegin + minD));
            clip.end = end;
        } else if (mode === 'move') {
            let begin = origBegin + dt;
            let end = origEnd + dt;
            if (begin < 0) {
                end -= begin;
                begin = 0;
            }
            if (end > total) {
                const over = end - total;
                begin -= over;
                end = total;
                if (begin < 0) begin = 0;
            }
            clip.begin = begin;
            clip.end = end;
        }
        const el = d.dragEl;
        if (el && el.isConnected) {
            el.style.left = `${clip.begin * pps}px`;
            el.style.width = `${Math.max(2, (clip.end - clip.begin) * pps)}px`;
        } else {
            this._renderClipsOnTrack(total, pps);
        }
    }

    _onClipResizeMove(e) {
        const d = this._clipDrag;
        if (!d) return;
        d.pendingClientX = e.clientX;
        if (d.moveRaf) return;
        d.moveRaf = requestAnimationFrame(() => {
            if (!this._clipDrag) return;
            this._clipDrag.moveRaf = 0;
            this._applyClipDragAtClientX(this._clipDrag.pendingClientX);
        });
    }

    // 편집 구간 드래그를 끝내고 선택·전체 UI 동기화로 마무리한다 (시간순 자동 정렬 없음).
    _onClipResizeEnd() {
        const d = this._clipDrag;
        if (!d) return;
        document.removeEventListener('mousemove', this._onClipResizeMove);
        document.removeEventListener('mouseup', this._onClipResizeEnd);
        if (d.moveRaf) {
            cancelAnimationFrame(d.moveRaf);
            d.moveRaf = 0;
        }
        this._applyClipDragAtClientX(d.pendingClientX);
        const clipRef = d.clip;
        const total = d.total;
        const minD = SoopVeditorReplacement.CLIP_MIN_DURATION;
        clipRef.begin = this._roundClipSec(clipRef.begin);
        clipRef.end = this._roundClipSec(clipRef.end);
        if (Number.isFinite(clipRef.begin) && Number.isFinite(clipRef.end)) {
            if (clipRef.end < clipRef.begin + minD) clipRef.end = clipRef.begin + minD;
            if (Number.isFinite(total) && clipRef.end > total) clipRef.end = total;
        }
        const changed = Math.abs(clipRef.begin - d.origBegin) > 1e-9 || Math.abs(clipRef.end - d.origEnd) > 1e-9;
        if (changed && d.undoSnapshot) {
            this._clipUndoStack.push(d.undoSnapshot);
            if (this._clipUndoStack.length > this._clipUndoMaxDepth) {
                this._clipUndoStack.splice(0, this._clipUndoStack.length - this._clipUndoMaxDepth);
            }
        }
        this._clipDrag = null;
        this._syncSelectionToClip(clipRef);
        this._syncUiFromState();
    }

    _updateSequenceHeaderUi(totalSec) {
        const total = totalSec !== undefined ? totalSec : this._getTotalDurationSec();
        if (this._timecodeEl) {
            this._timecodeEl.textContent = this._formatSequenceTimecode(this._playheadSec);
        }
        if (this._clipPlayStatusEl) {
            const c = this._clips[this._playAllIndex];
            const show = this._playAllMode && !!c;
            this._clipPlayStatusEl.style.display = show ? 'inline' : 'none';
            this._clipPlayStatusEl.textContent = show ? `(${this._playAllIndex + 1}/${this._clips.length})` : '';
        }
        if (this._clipTotalEl) {
            const sum = this._clipTotalDurationSec();
            this._clipTotalEl.textContent = this._formatClipTotalSumLabel(sum);
        }
    }

    /** 편집 구간 시각(초)을 UI·저장용으로 소수 둘째 자리까지 맞춘다. */
    _roundClipSec(sec) {
        const n = Number(sec);
        if (!Number.isFinite(n)) return n;
        return Math.round(n * 100) / 100;
    }

    _formatClipTimeInput(sec) {
        const r = this._roundClipSec(sec);
        if (!Number.isFinite(r)) return '';
        const s = Math.max(0, r);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const secWhole = Math.floor(s % 60);
        const centi = Math.round((s - Math.floor(s)) * 100);
        const carry = centi >= 100 ? 1 : 0;
        const secNorm = secWhole + carry;
        const secDisp = secNorm % 60;
        const minNorm = m + Math.floor(secNorm / 60);
        const minDisp = minNorm % 60;
        const hourDisp = h + Math.floor(minNorm / 60);
        const centiDisp = carry ? 0 : centi;
        return `${String(hourDisp).padStart(2, '0')}:${String(minDisp).padStart(2, '0')}:${String(secDisp).padStart(2, '0')}.${String(centiDisp).padStart(2, '0')}`;
    }

    /**
     * 편집 구간 시각 입력 파서.
     * - `HH:MM:SS` 또는 `MM:SS` 허용
     * - 레거시 호환: 콜론 없는 초 실수(`123.45`)만 허용, 음수는 NaN
     * @param {string} raw
     * @returns {number}
     */
    _parseClipTimeInput(raw) {
        const v = String(raw || '').trim();
        if (!v) return Number.NaN;
        if (!v.includes(':')) {
            const x = parseFloat(v);
            if (!Number.isFinite(x) || x < 0) return Number.NaN;
            return x;
        }
        const parts = v.split(':').map((x) => x.trim());
        if (parts.length < 2 || parts.length > 3) return Number.NaN;
        const nums = parts.map((x) => parseFloat(x));
        if (nums.some((n) => !Number.isFinite(n))) return Number.NaN;
        const [a, b, c] = parts.length === 2 ? [0, nums[0], nums[1]] : nums;
        if (a < 0 || b < 0 || c < 0) return Number.NaN;
        return a * 3600 + b * 60 + c;
    }

    _formatSequenceTimecode(sec) {
        if (!Number.isFinite(sec)) return '—';
        const s = Math.max(0, sec);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const r = s - h * 3600 - m * 60;
        const frac = (r % 1).toFixed(3).slice(2);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(Math.floor(r)).padStart(2, '0')}.${frac}`;
    }

    /** 댓글 타임라인용 HH:MM:SS (소수점 버림). */
    _formatTimelineCommentTimeSec(sec) {
        const s = Math.max(0, Math.floor(Number(sec) || 0));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const r = s % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
    }

    _buildTimelineCommentCopyText() {
        const clips = this._getClips();
        const mode = this._timelineCopyActionSel?.value === 'suffix'
            ? 'suffix'
            : this._timelineCopyActionSel?.value === 'none'
                ? 'none'
                : 'prefix';
        return clips
            .map((c) => {
                const b = this._formatTimelineCommentTimeSec(c.begin);
                const e = this._formatTimelineCommentTimeSec(c.end);
                const base = `${b} ~ ${e}`;
                const name = String(c.name || '').trim();
                if (!name || mode === 'none') return base;
                return mode === 'suffix' ? `${base} ${name}` : `${name} ${base}`;
            })
            .join('\n');
    }

    async _copyClipsAsTimelineComment() {
        const text = this._buildTimelineCommentCopyText();
        if (!text) {
            window.alert('복사할 편집 구간이 없습니다.');
            return;
        }
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.setAttribute('readonly', 'true');
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
            }
            this.log('타임라인 댓글 복사 완료');
        } catch (e) {
            this.error('타임라인 댓글 복사 실패', e);
            window.alert('편집 구간 타임라인 복사에 실패했습니다.');
        }
    }

    _duplicateSelectedClip() {
        if (this._isClipListBusy()) return;
        const i = this._selectedClipIndex;
        const c = this._clips[i];
        if (!c) return;
        this._recordClipUndo();
        const nextName = `편집 구간 ${this._clips.length + 1}`;
        const copy = {
            name: nextName,
            begin: c.begin,
            end: c.end,
            visibleOnTimeline: c.visibleOnTimeline !== false,
        };
        this._clips.splice(i + 1, 0, copy);
        this._selectedClipIndex = i + 1;
        this._syncUiFromState();
    }

    _onClipListChange(e) {
        if (this._isClipListBusy()) return;
        const t = e.target;
        if (!(t instanceof HTMLInputElement) || t.dataset.clip === undefined) return;
        const clipIdx = parseInt(t.dataset.clip, 10);
        const field = t.dataset.field;
        const clips = this._getClips();
        const clipRef = clips[clipIdx];
        if (!clipRef) return;
        let changed = false;
        if (field === 'name') {
            changed = String(clipRef.name) !== t.value;
            if (!changed) return;
            this._recordClipUndo();
            this._clipUpdate(clipIdx, { name: t.value });
        } else if (field === 'begin') {
            const val = this._roundClipSec(this._parseClipTimeInput(t.value));
            if (Number.isNaN(val)) {
                window.alert('시간 형식을 인식할 수 없습니다.');
                this._syncUiFromState();
                return;
            }
            if (val > clipRef.end) {
                window.alert('시작 시각은 종점보다 뒤일 수 없습니다.');
                this._syncUiFromState();
                return;
            }
            changed = Math.abs(Number(clipRef.begin) - val) > 1e-9;
            if (!changed) return;
            this._recordClipUndo();
            this._clipUpdate(clipIdx, { begin: val });
        } else if (field === 'end') {
            const val = this._roundClipSec(this._parseClipTimeInput(t.value));
            if (Number.isNaN(val)) {
                window.alert('시간 형식을 인식할 수 없습니다.');
                this._syncUiFromState();
                return;
            }
            if (val < clipRef.begin) {
                window.alert('종점 시각은 시점보다 앞일 수 없습니다.');
                this._syncUiFromState();
                return;
            }
            changed = Math.abs(Number(clipRef.end) - val) > 1e-9;
            if (!changed) return;
            this._recordClipUndo();
            this._clipUpdate(clipIdx, { end: val });
        } else {
            return;
        }
        this._syncSelectionToClip(clipRef);
        this._syncUiFromState();
    }

    _bindClipListScrollDelegationOnce() {
        if (this._clipListDelegationBound || !this._clipListScrollEl) return;
        this._clipListDelegationBound = true;
        const el = this._clipListScrollEl;
        el.addEventListener('click', this._onClipListHostClick);
        el.addEventListener('dragstart', this._onClipListHostDragStart);
        el.addEventListener('dragover', this._onClipListHostDragOver);
        el.addEventListener('drop', this._onClipListHostDrop);
        el.addEventListener('dragend', this._onClipListHostDragEnd);
    }

    _onClipListHostClick(e) {
        const host = this._clipListScrollEl;
        if (!host) return;
        const t = e.target;
        if (!(t instanceof HTMLElement)) return;

        if (t.closest('.vs-veditor-clip-add-row .vs-veditor-clip-add-btn')) {
            if (this._isClipListBusy()) return;
            e.preventDefault();
            this._addDefaultClip();
            return;
        }

        const eye = t.closest('.vs-veditor-clip-eye-btn');
        if (eye && host.contains(eye)) {
            if (this._isClipListBusy()) return;
            e.stopPropagation();
            const row = eye.closest('.vs-veditor-clip-row');
            if (!(row instanceof HTMLElement)) return;
            const i = parseInt(row.dataset.clipRow, 10);
            const clip = this._clips[i];
            if (!clip) return;
            this._recordClipUndo();
            clip.visibleOnTimeline = clip.visibleOnTimeline === false;
            this._syncUiFromState();
            return;
        }

        const row = t.closest('.vs-veditor-clip-row:not(.vs-veditor-clip-add-row)');
        if (!(row instanceof HTMLElement) || !host.contains(row)) return;
        if (t.closest('input, button, textarea')) return;
        const i = parseInt(row.dataset.clipRow, 10);
        if (Number.isNaN(i)) return;
        this._selectedClipIndex = i;
        this._syncUiFromState();
    }

    _onClipListHostDragStart(e) {
        if (this._isClipListBusy()) return;
        const host = this._clipListScrollEl;
        if (!host) return;
        const handle = e.target.closest?.('.vs-veditor-clip-drag-handle');
        if (!(handle instanceof HTMLButtonElement) || !host.contains(handle) || handle.disabled) return;
        const row = handle.closest('.vs-veditor-clip-row:not(.vs-veditor-clip-add-row)');
        if (!(row instanceof HTMLElement) || !host.contains(row)) return;
        const i = parseInt(row.dataset.clipRow, 10);
        if (Number.isNaN(i)) return;
        this._listDnDIndex = i;
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(i));
        }
    }

    _onClipListHostDragOver(e) {
        if (this._isClipListBusy()) return;
        const host = this._clipListScrollEl;
        if (!host) return;
        const targetEl = e.target instanceof Element ? e.target : null;
        if (!targetEl) return;
        const row = targetEl.closest('.vs-veditor-clip-row');
        if (!(row instanceof HTMLElement) || !host.contains(row)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    }

    _onClipListHostDrop(e) {
        if (this._isClipListBusy()) return;
        const host = this._clipListScrollEl;
        if (!host) return;
        const targetEl = e.target instanceof Element ? e.target : null;
        if (!targetEl) return;
        const row = targetEl.closest('.vs-veditor-clip-row');
        if (!(row instanceof HTMLElement) || !host.contains(row)) return;
        e.preventDefault();
        const fromStr = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
        const from = parseInt(fromStr, 10);
        let to = -1;
        if (row.classList.contains('vs-veditor-clip-add-row')) {
            to = this._clips.length;
        } else {
            to = parseInt(row.dataset.clipRow, 10);
        }
        if (Number.isNaN(from) || Number.isNaN(to)) return;
        if (to === this._clips.length && from === this._clips.length - 1) return;
        if (from === to) return;
        this._recordClipUndo();
        const originalLen = this._clips.length;
        const item = this._clips.splice(from, 1)[0];
        let insertTo;
        if (to === originalLen) {
            insertTo = this._clips.length; // +행(drop end): 항상 맨 뒤
        } else {
            insertTo = to;
            if (from < to) insertTo -= 1;
            if (insertTo < 0) insertTo = 0;
            if (insertTo > this._clips.length) insertTo = this._clips.length;
        }
        this._clipListReorderPending = true;
        this._clips.splice(insertTo, 0, item);
        this._selectedClipIndex = insertTo;
        this._listDnDIndex = null;
        this._syncUiFromState();
    }

    _onClipListHostDragEnd() {
        this._listDnDIndex = null;
    }

    /**
     * 편집 구간 개수·빈 상태·DnD 순서 변경 시에만 전체 재빌드하고, 그 외에는 기존 행 DOM을 유지한 채 값·선택만 갱신한다.
     */
    _syncClipList() {
        const host = this._clipListScrollEl;
        if (!host) return;
        const clips = this._getClips();
        const n = clips.length;
        const clipRows = Array.from(host.querySelectorAll('.vs-veditor-clip-row:not(.vs-veditor-clip-add-row)'));
        const addRow = host.querySelector('.vs-veditor-clip-add-row');
        const emptyEl = host.querySelector('.vs-veditor-clip-list-empty');

        const needFull =
            this._clipListReorderPending ||
            !addRow ||
            n !== clipRows.length ||
            (n === 0 && !emptyEl) ||
            (n > 0 && !!emptyEl);

        if (needFull) {
            this._renderClipListFull();
            this._clipListReorderPending = false;
            return;
        }
        if (n === 0) return;
        const sel = this._selectedClipIndex;
        for (let i = 0; i < n; i++) {
            this._patchClipRow(clipRows[i], clips[i], i, i === sel);
        }
    }

    /**
     * @param {HTMLElement} row
     * @param {VeditorClip} clip
     * @param {number} index
     * @param {boolean} selected
     */
    _patchClipRow(row, clip, index, selected) {
        row.dataset.clipRow = String(index);
        row.classList.toggle('vs-veditor-clip-row--selected', selected);
        row.draggable = false;
        const nameInp = row.querySelector('.vs-veditor-clip-name');
        if (nameInp instanceof HTMLInputElement) {
            nameInp.value = clip.name;
            nameInp.dataset.clip = String(index);
            nameInp.disabled = this._isClipListBusy();
        }
        const beginInp = row.querySelector('input[data-field="begin"]');
        if (beginInp instanceof HTMLInputElement) {
            beginInp.value = this._formatClipTimeInput(clip.begin);
            beginInp.dataset.clip = String(index);
            beginInp.disabled = this._isClipListBusy();
        }
        const endInp = row.querySelector('input[data-field="end"]');
        if (endInp instanceof HTMLInputElement) {
            endInp.value = this._formatClipTimeInput(clip.end);
            endInp.dataset.clip = String(index);
            endInp.disabled = this._isClipListBusy();
        }
        const dur = row.querySelector('.vs-veditor-clip-dur');
        if (dur) dur.textContent = `${(clip.end - clip.begin).toFixed(2)}s`;
        const dragHandle = row.querySelector('.vs-veditor-clip-drag-handle');
        if (dragHandle instanceof HTMLButtonElement) {
            dragHandle.draggable = !this._isClipListBusy();
            dragHandle.disabled = this._isClipListBusy();
        }
        const eye = row.querySelector('.vs-veditor-clip-eye-btn');
        if (eye) {
            const vis = clip.visibleOnTimeline !== false;
            eye.className = 'vs-veditor-btn vs-veditor-btn-icon vs-veditor-clip-eye-btn' + (vis ? '' : ' vs-veditor-clip-eye-btn--off');
            eye.setAttribute('aria-label', vis ? '타임라인에 표시' : '타임라인에서 숨김');
            eye.setAttribute('aria-pressed', vis ? 'true' : 'false');
            eye.disabled = this._isClipListBusy();
            eye.innerHTML = vis ? SoopVeditorReplacement.CLIP_TIMELINE_VISIBILITY_SVG_ON
                : SoopVeditorReplacement.CLIP_TIMELINE_VISIBILITY_SVG_OFF;
        }
    }

    _fitTimelineToClipIndex(idx) {
        const c = this._clips[idx];
        if (!c || !this._timelineViewport) return;
        const total = this._getTotalDurationSec();
        const span = Math.max(c.end - c.begin, 0.1);
        const vp = this._timelineViewport;
        const w = Math.max(vp.clientWidth, 1);
        this._pixelsPerSecond = this._clampPps(
            Math.min(SoopVeditorReplacement.MAX_PPS, (w * 0.88) / span),
            total
        );
        const innerW = this._getTimelineInnerWidthPx(total, this._pixelsPerSecond);
        if (this._timelineInner) this._timelineInner.style.width = `${innerW}px`;
        const mid = (c.begin + c.end) / 2;
        const innerW2 = innerW;
        const sl = mid * this._pixelsPerSecond - w / 2;
        vp.scrollLeft = Math.max(0, Math.min(sl, Math.max(0, innerW2 - w)));
        this._syncUiFromState();
    }

    /**
     * @param {boolean} [pauseVideo] true 이면 마지막 편집 구간까지 재생 완료 시 `<video>` 일시정지.
     */
    _stopPlayAll(pauseVideo = false) {
        const wasPlaying = this._playAllMode || this._playSingleClipMode;
        this._playAllMode = false;
        this._playSingleClipMode = false;
        this._playbackClipEntered = false;
        this._playAllSeekGraceUntil = 0;
        if (this._playAllRaf != null) {
            cancelAnimationFrame(this._playAllRaf);
            this._playAllRaf = null;
        }
        if (pauseVideo) {
            const v = this._getVideo();
            if (v && !v.paused) v.pause();
        }
        if (wasPlaying) this._syncUiFromState();
    }

    _playAllClips() {
        if (this._playAllMode) return;
        if (this._playSingleClipMode) this._stopPlayAll(false);
        const clips = this._clips;
        if (clips.length === 0) return;
        this._playAllMode = true;
        this._playAllIndex = 0;
        this._selectedClipIndex = 0;
        this._playbackClipEntered = false;
        this._playAllSeekGraceUntil = performance.now() + 200;
        this._plSeekGlobal(clips[0].begin);
        const v = this._getVideo();
        if (v) v.play().catch(() => {});
        this._syncUiFromState();

        const tick = () => {
            if (!this._playAllMode || !this._panelVisible) return;
            if (this._playAllSeekGraceUntil && performance.now() < this._playAllSeekGraceUntil) {
                this._playAllRaf = requestAnimationFrame(tick);
                return;
            }
            this._playAllSeekGraceUntil = 0;
            this._refreshCachedGlobalPlaybackTime();
            const list = this._clips;
            let i = this._playAllIndex;
            if (i >= list.length) {
                this._stopPlayAll();
                return;
            }
            const c = list[i];
            const t = this._cachedGlobalPlaybackSec;
            if (SoopVeditorReplacement.ClipBoundaryPlayback.advance(this, t, c.begin, c.end) === 'segment_end') {
                i += 1;
                this._playAllIndex = i;
                if (i >= list.length) {
                    this._stopPlayAll(true);
                    return;
                }
                this._playbackClipEntered = false;
                this._selectedClipIndex = i;
                this._ensureSelectedClipIndex();
                const totalSel = this._getTotalDurationSec();
                const ppsSel = this._pixelsPerSecond;
                this._syncClipList();
                this._renderClipsOnTrack(totalSel, ppsSel);
                this._updatePlayheadVisual(totalSel);
                queueMicrotask(() => this._updateTimelineScrollBarUI());
                this._updateClipToolbarSelectionActions();
                this._plSeekGlobal(list[i].begin);
                this._playAllSeekGraceUntil = performance.now() + 180;
            }
            this._playAllRaf = requestAnimationFrame(tick);
        };
        this._playAllRaf = requestAnimationFrame(tick);
    }

    // 우측 편집 구간 목록을 처음부터 다시 만든다 (개수·빈 상태·DnD 순서 변경 시에만 호출).
    _renderClipListFull() {
        const host = this._clipListScrollEl;
        if (!host) return;
        host.innerHTML = '';
        const clips = this._getClips();
        if (clips.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'vs-veditor-clip-list-empty';
            empty.textContent = '편집 구간 없음 — 아래 + 버튼으로 구간을 추가합니다.';
            host.appendChild(empty);
        } else {
            clips.forEach((c, i) => {
                const row = document.createElement('div');
                row.className = 'vs-veditor-clip-row';
                if (i === this._selectedClipIndex) row.classList.add('vs-veditor-clip-row--selected');
                row.draggable = false;
                row.dataset.clipRow = String(i);

                const nameInp = document.createElement('input');
                nameInp.type = 'text';
                nameInp.className = 'vs-veditor-clip-name';
                nameInp.value = c.name;
                nameInp.disabled = this._isClipListBusy();
                nameInp.dataset.clip = String(i);
                nameInp.dataset.field = 'name';
                nameInp.title = '편집 구간 이름';

                const beginInp = document.createElement('input');
                beginInp.type = 'text';
                beginInp.inputMode = 'text';
                beginInp.autocomplete = 'off';
                beginInp.className = 'vs-veditor-clip-time-inp';
                beginInp.value = this._formatClipTimeInput(c.begin);
                beginInp.disabled = this._isClipListBusy();
                beginInp.dataset.clip = String(i);
                beginInp.dataset.field = 'begin';
                beginInp.title = '시작 시각(HH:MM:SS 또는 초)';

                const tilde = document.createElement('span');
                tilde.className = 'vs-veditor-clip-time-tilde';
                tilde.textContent = '~';
                tilde.setAttribute('aria-hidden', 'true');

                const endInp = document.createElement('input');
                endInp.type = 'text';
                endInp.inputMode = 'text';
                endInp.autocomplete = 'off';
                endInp.className = 'vs-veditor-clip-time-inp';
                endInp.value = this._formatClipTimeInput(c.end);
                endInp.disabled = this._isClipListBusy();
                endInp.dataset.clip = String(i);
                endInp.dataset.field = 'end';
                endInp.title = '끝 시각(HH:MM:SS 또는 초)';

                const dur = document.createElement('span');
                dur.className = 'vs-veditor-clip-dur';
                dur.textContent = `${(c.end - c.begin).toFixed(2)}s`;
                dur.title = '구간 길이(초)';
                const dragHandle = document.createElement('button');
                dragHandle.type = 'button';
                dragHandle.className = 'vs-veditor-clip-drag-handle';
                dragHandle.textContent = '⋮⋮';
                dragHandle.title = '드래그해서 순서 변경';
                dragHandle.setAttribute('aria-label', '드래그해서 순서 변경');
                dragHandle.draggable = !this._isClipListBusy();
                dragHandle.disabled = this._isClipListBusy();

                const eye = document.createElement('button');
                eye.type = 'button';
                const vis = c.visibleOnTimeline !== false;
                eye.className = 'vs-veditor-btn vs-veditor-btn-icon vs-veditor-clip-eye-btn' + (vis ? '' : ' vs-veditor-clip-eye-btn--off');
                eye.title = '타임라인에 표시 (끄면 그래프만 숨김 · 재생·합계에는 포함)';
                eye.setAttribute('aria-label', vis ? '타임라인에 표시' : '타임라인에서 숨김');
                eye.setAttribute('aria-pressed', vis ? 'true' : 'false');
                eye.disabled = this._isClipListBusy();
                eye.innerHTML = vis ? SoopVeditorReplacement.CLIP_TIMELINE_VISIBILITY_SVG_ON
                    : SoopVeditorReplacement.CLIP_TIMELINE_VISIBILITY_SVG_OFF;

                const left = document.createElement('div');
                left.className = 'vs-veditor-clip-row-left';
                left.appendChild(eye);
                left.appendChild(nameInp);

                const center = document.createElement('div');
                center.className = 'vs-veditor-clip-row-center';
                center.appendChild(beginInp);
                center.appendChild(tilde);
                center.appendChild(endInp);

                const right = document.createElement('div');
                right.className = 'vs-veditor-clip-row-right';
                right.appendChild(dur);
                right.appendChild(dragHandle);

                const line = document.createElement('div');
                line.className = 'vs-veditor-clip-row-line';
                line.appendChild(left);
                line.appendChild(center);
                line.appendChild(right);

                row.appendChild(line);
                host.appendChild(row);
            });
        }
        const addRow = document.createElement('div');
        addRow.className = 'vs-veditor-clip-row vs-veditor-clip-add-row';
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'vs-veditor-clip-add-btn';
        addBtn.textContent = '+';
        addBtn.setAttribute('aria-label', '편집 구간 추가');
        addBtn.title = '편집 구간 추가';
        addBtn.disabled = this._isClipListBusy();
        addRow.appendChild(addBtn);
        host.appendChild(addRow);
    }
}
        /** 라이브 중 VOD 시청 알려주기 대상 VOD 유형 (다시보기 REVIEW 제외) */
const TARGET_FILE_TYPES = new Set(['CLIP', 'CATCH', 'EDITOR', 'NORMAL']);
const DEFAULT_COMMENT_TEXT = '잘 볼게요';
const DEDUP_STORAGE_PREFIX = 'vodSync_liveWatchComment:';
const MIN_DEDUP_MS = 60 * 1000;
const TOAST_AUTO_HIDE_MS = 5000;
const DEFAULT_COOLDOWN_SECONDS = 3600;

/**
 * 확장 사용자가 라이브 중일 때 클립·캐치·편집·업로드 VOD를 열면
 * 제작자에게 UP 하기·댓글 등록 알림을 보낸다.
 * (음소거 상태에서는 보내지 않고, 음소거가 풀릴 때까지 기다린다.)
 */
class SoopLiveWatchCommentNotifier extends IVodSync {
    constructor() {
        super();
        this.likeEnabled = true;
        this.commentEnabled = false;
        this.commentText = DEFAULT_COMMENT_TEXT;
        this.toastEnabled = true;
        this.dedupMode = 'cooldown'; // existing_comment | cooldown
        this.cooldownType = 'video_duration'; // video_duration | custom_hours
        this.cooldownSeconds = DEFAULT_COOLDOWN_SECONDS;
        this._attempted = false;
        this.log('loaded');
        this.init();
    }

    async init() {
        await this._loadSettings();
        if (!this.likeEnabled && !this.commentEnabled) {
            this.log('설정 OFF — 라이브 중 VOD 시청 알려주기 건너뜀');
            return;
        }
        await this._tryNotify();
    }

    async _loadSettings() {
        if (window.VODSync?.IS_TAMPER_MONKEY_SCRIPT === true) {
            if (typeof GM_getValue === 'function') {
                this.likeEnabled = GM_getValue('soopLiveWatchLikeNotify', true) !== false;
                this.commentEnabled = GM_getValue('soopLiveWatchCommentNotify', false) === true;
                const text = GM_getValue('soopLiveWatchCommentText', DEFAULT_COMMENT_TEXT);
                this.commentText = typeof text === 'string' && text.trim() ? text : DEFAULT_COMMENT_TEXT;
                this.toastEnabled = GM_getValue('soopLiveWatchCommentToast', true) !== false;
                this._applyDedupSettings({
                    soopLiveWatchCommentDedupMode: GM_getValue('soopLiveWatchCommentDedupMode', 'cooldown'),
                    soopLiveWatchCommentCooldownType: GM_getValue('soopLiveWatchCommentCooldownType', 'video_duration'),
                    soopLiveWatchCommentCooldownSeconds: GM_getValue('soopLiveWatchCommentCooldownSeconds', null),
                    soopLiveWatchCommentCooldownHours: GM_getValue('soopLiveWatchCommentCooldownHours', null),
                });
            }
            return;
        }
        try {
            const response = await chrome.runtime.sendMessage({ action: 'getAllSettings' });
            if (response?.success && response.settings) {
                const s = response.settings;
                this.likeEnabled = s.soopLiveWatchLikeNotify !== false;
                this.commentEnabled = s.soopLiveWatchCommentNotify === true;
                const text = s.soopLiveWatchCommentText;
                if (typeof text === 'string' && text.trim()) {
                    this.commentText = text;
                }
                if (s.soopLiveWatchCommentToast !== undefined) {
                    this.toastEnabled = s.soopLiveWatchCommentToast !== false;
                }
                this._applyDedupSettings(s);
            }
        } catch (error) {
            this.warn('설정 로드 실패, 기본값 사용:', error);
        }
    }

    _applyDedupSettings(settings = {}) {
        this.dedupMode = settings.soopLiveWatchCommentDedupMode === 'existing_comment'
            ? 'existing_comment'
            : 'cooldown';
        this.cooldownType = settings.soopLiveWatchCommentCooldownType === 'custom_hours'
            ? 'custom_hours'
            : 'video_duration';
        this.cooldownSeconds = this._normalizeCooldownSeconds(
            settings.soopLiveWatchCommentCooldownSeconds,
            settings.soopLiveWatchCommentCooldownHours
        );
    }

    // 임의 지정 대기 시간(초). 예전 시간 단위 설정이 있으면 초로 변환한다.
    _normalizeCooldownSeconds(secondsValue, legacyHoursValue) {
        const seconds = Number(secondsValue);
        if (Number.isFinite(seconds) && seconds > 0) {
            return Math.max(1, Math.floor(seconds));
        }
        const hours = Number(legacyHoursValue);
        if (Number.isFinite(hours) && hours > 0) {
            return Math.max(1, Math.round(hours * 3600));
        }
        return DEFAULT_COOLDOWN_SECONDS;
    }

    async _setToastEnabled(enabled) {
        this.toastEnabled = enabled;
        if (window.VODSync?.IS_TAMPER_MONKEY_SCRIPT === true) {
            if (typeof GM_setValue === 'function') {
                GM_setValue('soopLiveWatchCommentToast', enabled);
            }
            return;
        }
        try {
            await chrome.runtime.sendMessage({
                action: 'saveSettings',
                settings: { soopLiveWatchCommentToast: enabled },
            });
        } catch (error) {
            this.warn('토스트 설정 저장 실패:', error);
        }
    }

    _getTitleNoFromUrl() {
        const m = window.location.pathname.match(/\/player\/(\d+)/);
        return m?.[1] ?? null;
    }

    _buildReferer(titleNo, fileType) {
        const base = `${window.VODSync?.SoopUrls?.VOD_ORIGIN || 'https://vod.sooplive.com'}/player/${titleNo}`;
        if (String(fileType).toUpperCase() === 'CATCH') {
            return `${base}/catch`;
        }
        return base;
    }

    _dedupKey(titleNo) {
        return `${DEDUP_STORAGE_PREFIX}${titleNo}`;
    }

    // 시간 기반 대기 남은 ms. 없거나 만료면 0.
    _getDedupRemainingMs(titleNo) {
        try {
            const raw = localStorage.getItem(this._dedupKey(titleNo));
            if (!raw) return 0;
            const parsed = JSON.parse(raw);
            const expiresAt = Number(parsed?.expiresAt);
            if (!Number.isFinite(expiresAt)) {
                localStorage.removeItem(this._dedupKey(titleNo));
                return 0;
            }
            const remainingMs = expiresAt - Date.now();
            if (remainingMs <= 0) {
                localStorage.removeItem(this._dedupKey(titleNo));
                return 0;
            }
            return remainingMs;
        } catch (_e) {
            return 0;
        }
    }

    _markDedup(titleNo, durationMs) {
        const ttl = Math.max(Number(durationMs) || 0, MIN_DEDUP_MS);
        try {
            localStorage.setItem(
                this._dedupKey(titleNo),
                JSON.stringify({ expiresAt: Date.now() + ttl })
            );
        } catch (error) {
            this.warn('중복 방지 저장 실패:', error);
        }
    }

    _resolveCooldownMs(totalFileDurationMs) {
        if (this.cooldownType === 'custom_hours') {
            return Math.max(this.cooldownSeconds * 1000, MIN_DEDUP_MS);
        }
        return Math.max(Number(totalFileDurationMs) || 0, MIN_DEDUP_MS);
    }

    /**
     * 댓글 본문 비교용 정규화. HTML 줄바꿈·태그·공백을 맞춘다.
     * @param {string} text
     * @returns {string}
     */
    _normalizeCommentText(text) {
        return String(text ?? '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * 내가 남긴 부모 댓글 중 동일 문구가 있는지 확인. (대댓글은 조회 범위 밖)
     * 조회 실패 시 false — 댓글 등록을 막지 않는다.
     */
    async _hasExistingMatchingComment(api, opts) {
        const titleNo = opts?.titleNo;
        const loginId = opts?.loginId;
        const content = opts?.content;
        if (titleNo == null || !loginId || typeof content !== 'string') {
            return false;
        }
        if (typeof api.GetSoopParentCommentsInVod !== 'function') {
            this.warn('GetSoopParentCommentsInVod 없음 — 기존 댓글 판별 스킵');
            return false;
        }

        const needle = this._normalizeCommentText(content);
        if (!needle) return false;

        try {
            const list = await api.GetSoopParentCommentsInVod(titleNo);
            if (!Array.isArray(list)) {
                this.warn('기존 댓글 목록 조회 실패 — 중복으로 보지 않음');
                return false;
            }
            const lid = String(loginId);
            return list.some(
                (c) => String(c?.user_id) === lid
                    && this._normalizeCommentText(c?.comment) === needle
            );
        } catch (error) {
            this.warn('기존 댓글 판별 실패:', error);
            return false;
        }
    }

    _getPlayerVideo() {
        const video = document.querySelector('video');
        return video instanceof HTMLVideoElement ? video : null;
    }

    // muted이거나 volume이 0이면 음소거로 본다.
    _isVideoUnmuted(video = this._getPlayerVideo()) {
        if (!(video instanceof HTMLVideoElement)) return false;
        return !video.muted && video.volume > 0;
    }

    // 음소거가 풀릴 때까지 대기. (자동재생이 음소거라서 시청 직후엔 보통 음소거 상태)
    async _waitUntilUnmuted() {
        if (this._isVideoUnmuted()) return true;
        this.log('음소거 해제 대기 중...');
        return new Promise((resolve) => {
            let attachedVideo = null;
            const onVolumeChange = () => {
                if (this._isVideoUnmuted(attachedVideo)) finish(true);
            };
            const finish = (ok) => {
                clearInterval(pollId);
                if (attachedVideo) {
                    attachedVideo.removeEventListener('volumechange', onVolumeChange);
                }
                resolve(ok);
            };
            const ensureListener = () => {
                const video = this._getPlayerVideo();
                if (!video || video === attachedVideo) return;
                if (attachedVideo) {
                    attachedVideo.removeEventListener('volumechange', onVolumeChange);
                }
                attachedVideo = video;
                attachedVideo.addEventListener('volumechange', onVolumeChange);
            };
            const pollId = setInterval(() => {
                ensureListener();
                if (this._isVideoUnmuted()) finish(true);
            }, 400);
            ensureListener();
        });
    }

    async _resolveLoginId() {
        // 확장 환경은 vodCore 고스트 동기화 직후 loginId가 비어 있을 수 있어 잠시 재시도
        for (let i = 0; i < 10; i++) {
            const vc = window.VODSync?.getVodCore?.();
            const fromVodCore = vc?.config?.loginId != null ? String(vc.config.loginId) : '';
            if (fromVodCore) return fromVodCore;
            if (i < 9) await new Promise((r) => setTimeout(r, 300));
        }
        const api = window.VODSync?.soopAPI;
        if (!api || typeof api.GetPrivateInfo !== 'function') return null;
        const priv = await api.GetPrivateInfo();
        return priv?.CHANNEL?.LOGIN_ID ?? null;
    }

    // 알림 성공 안내. UP 하기/댓글 등록 중 무엇이 됐는지 정확히 표시. 「다시 알리지 않음」으로 이후 토스트만 끈다.
    _showSuccessToast({ liked = false, commented = false, commentText = '' } = {}) {
        if (!this.toastEnabled) return;
        if (!liked && !commented) return;

        const existing = document.getElementById('vodSyncLiveWatchCommentToast');
        if (existing) existing.remove();

        let titleText = '';
        if (liked && commented) {
            titleText = 'VOD를 UP하고 댓글을 등록했습니다.';
        } else if (liked) {
            titleText = 'VOD를 UP했습니다.';
        } else {
            titleText = 'VOD에 댓글을 등록했습니다.';
        }

        const toast = document.createElement('div');
        toast.id = 'vodSyncLiveWatchCommentToast';
        toast.setAttribute('role', 'status');
        toast.style.cssText = `
            position: fixed;
            right: 16px;
            bottom: 16px;
            z-index: 2147483000;
            max-width: 320px;
            padding: 12px 14px;
            background: rgba(72, 80, 96, 0.82);
            color: #fff;
            border-radius: 10px;
            box-shadow: 0 4px 14px rgba(0,0,0,0.22);
            font-family: 'Segoe UI', Tahoma, sans-serif;
            font-size: 13px;
            line-height: 1.45;
        `;

        const title = document.createElement('div');
        title.textContent = titleText;
        title.style.fontWeight = '600';
        title.style.marginBottom = commented ? '4px' : '8px';

        toast.appendChild(title);

        if (commented) {
            const body = document.createElement('div');
            body.textContent = `댓글: ${commentText}`;
            body.style.opacity = '0.9';
            body.style.marginBottom = '8px';
            body.style.wordBreak = 'break-word';
            toast.appendChild(body);
        }

        const footer = document.createElement('div');
        footer.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-top: 2px;
        `;

        const countdown = document.createElement('span');
        countdown.style.cssText = 'opacity: 0.75; font-size: 12px; flex-shrink: 0;';

        const dismissBtn = document.createElement('button');
        dismissBtn.type = 'button';
        dismissBtn.textContent = '이 창을 다시 열지 않음';
        dismissBtn.style.cssText = `
            border: 1px solid rgba(255,255,255,0.35);
            background: transparent;
            color: #fff;
            border-radius: 6px;
            padding: 4px 8px;
            font-size: 12px;
            cursor: pointer;
            white-space: nowrap;
        `;

        let remainingSec = Math.ceil(TOAST_AUTO_HIDE_MS / 1000);
        const updateCountdown = () => {
            countdown.textContent = `${remainingSec}초후 닫음`;
        };
        updateCountdown();

        const closeToast = () => {
            clearTimeout(hideTimer);
            clearInterval(countdownTimer);
            toast.remove();
        };
        dismissBtn.addEventListener('click', async () => {
            await this._setToastEnabled(false);
            closeToast();
        });

        footer.appendChild(countdown);
        footer.appendChild(dismissBtn);
        toast.appendChild(footer);
        document.body.appendChild(toast);

        const countdownTimer = setInterval(() => {
            remainingSec -= 1;
            if (remainingSec <= 0) {
                closeToast();
                return;
            }
            updateCountdown();
        }, 1000);
        const hideTimer = setTimeout(closeToast, TOAST_AUTO_HIDE_MS);
    }

    async _tryNotify() {
        if (this._attempted) return;
        this._attempted = true;

        const titleNo = this._getTitleNoFromUrl();
        if (!titleNo) return;

        // 시간 기반 대기 모드만 localStorage로 선차단
        if (this.dedupMode === 'cooldown') {
            const remainingMs = this._getDedupRemainingMs(titleNo);
            if (remainingMs > 0) {
                const remainingSec = Math.ceil(remainingMs / 1000);
                this.log(`재등록 대기 중 — titleNo=${titleNo}, 남은 시간=${remainingSec}초`);
                return;
            }
        }

        const api = window.VODSync?.soopAPI;
        if (!api) {
            this.warn('soopAPI 없음');
            return;
        }

        const vodInfo = await api.GetSoopVodInfo(titleNo);
        const data = vodInfo?.data;
        if (!data || vodInfo?.result !== 1) {
            this.log('VOD 정보 조회 실패 또는 비공개');
            return;
        }

        const fileType = String(data.file_type || '').toUpperCase();
        if (!TARGET_FILE_TYPES.has(fileType)) {
            this.log(`대상 아님 file_type=${fileType}`);
            return;
        }

        // 댓글이 막힌 VOD는 요청하지 않음
        if (data.comment_yn === 0 || data.comment_yn === '0' || data.comment_yn === false) {
            this.warn(`댓글을 작성할 수 없는 영상입니다. titleNo=${titleNo}`);
            return;
        }

        const bjId = data.bj_id != null ? String(data.bj_id) : '';
        const writerId = data.writer_id != null ? String(data.writer_id) : '';
        if (!bjId) {
            this.warn('bj_id 없음');
            return;
        }

        const loginId = await this._resolveLoginId();
        if (!loginId) {
            this.log('로그인 ID 없음 — 건너뜀');
            return;
        }

        // 본인이 만든 VOD면 알림 대상이 없으므로 건너뜀
        if (writerId && writerId === loginId) {
            this.log('본인 작성 VOD — 건너뜀');
            return;
        }

        // 확장 사용자가 라이브 중일 때만
        let broad = await api.GetChannelBroad(loginId);
        if (!broad) {
            this.log('라이브 중이 아님 — 건너뜀');
            return;
        }

        const content = String(this.commentText || DEFAULT_COMMENT_TEXT).trim() || DEFAULT_COMMENT_TEXT;
        let skipComment = !this.commentEnabled;

        // 같은 문구의 내 댓글이 있으면 댓글만 건너뜀 (API 연동 후 동작)
        if (this.commentEnabled && this.dedupMode === 'existing_comment') {
            const exists = await this._hasExistingMatchingComment(api, {
                stationNo: data.station_no,
                bbsNo: data.bbs_no,
                titleNo: data.title_no ?? titleNo,
                bjId,
                loginId,
                content,
                fileType,
            });
            if (exists) {
                this.log(`동일 문구 댓글 이미 존재 — 댓글 건너뜀 titleNo=${titleNo}`);
                skipComment = true;
                if (!this.likeEnabled) return;
            }
        }

        // 음소거면 알림 안 보내고, 해제될 때까지 대기
        await this._waitUntilUnmuted();

        // 음소거 대기 중 방송이 끝났을 수 있어 다시 확인
        broad = await api.GetChannelBroad(loginId);
        if (!broad) {
            this.log('음소거 해제 후 라이브 종료 — 건너뜀');
            return;
        }

        if (this.commentEnabled && !skipComment && this.dedupMode === 'existing_comment') {
            const exists = await this._hasExistingMatchingComment(api, {
                stationNo: data.station_no,
                bbsNo: data.bbs_no,
                titleNo: data.title_no ?? titleNo,
                bjId,
                loginId,
                content,
                fileType,
            });
            if (exists) {
                this.log(`음소거 해제 후 동일 문구 댓글 확인 — 댓글 건너뜀 titleNo=${titleNo}`);
                skipComment = true;
                if (!this.likeEnabled) return;
            }
        }

        const referer = this._buildReferer(titleNo, fileType);
        const boardType = data.board_type ?? 105;
        const resolvedTitleNo = data.title_no ?? titleNo;
        let liked = false;
        let commented = false;

        if (this.likeEnabled) {
            if (typeof api.LikeVodTitle !== 'function') {
                this.warn('LikeVodTitle API 없음');
            } else {
                const likeResult = await api.LikeVodTitle({
                    stationNo: data.station_no,
                    titleNo: resolvedTitleNo,
                    boardType,
                    referer,
                });
                if (likeResult) {
                    liked = true;
                    this.log(`라이브 시청 UP 완료 titleNo=${titleNo} fileType=${fileType}`);
                } else {
                    liked = false;
                    this.warn(`UP 하기 실패 titleNo=${titleNo}`);
                }
            }
        }

        if (this.commentEnabled && !skipComment) {
            const commentResult = await api.WriteVodComment({
                stationNo: data.station_no,
                bbsNo: data.bbs_no,
                titleNo: resolvedTitleNo,
                bjId,
                boardType,
                content,
                fileType,
                referer,
            });
            if (commentResult) {
                commented = true;
                this.log(`라이브 시청 댓글 작성 완료 titleNo=${titleNo} fileType=${fileType}`);
            } else {
                commented = false;
                this.warn(`댓글을 작성할 수 없는 영상이거나 작성에 실패했습니다. titleNo=${titleNo}`);
            }
        }

        if (!liked && !commented) return;

        if (this.dedupMode === 'cooldown') {
            this._markDedup(titleNo, this._resolveCooldownMs(data.total_file_duration));
        }
        this._showSuccessToast({ liked, commented, commentText: content });
    }
}
        /**
 * SOOP VOD 다음 영상 자동 재생을 막는다. (라이브 여부와 무관)
 * #video의 ended 전파를 막되, 분할 파일의 중간 전환(ended)은 그대로 둔다.
 * playIdx가 files 마지막일 때만 차단한다.
 */
class SoopNextVideoAutoplayGuard extends IVodSync {
    constructor() {
        super();
        this.enabled = true;
        this._timer = null;
        this._boundVideos = new WeakSet();
        this._onVideoEndedCapture = (e) => {
            if (!this._shouldBlockEndedPropagation()) return;
            e.stopPropagation();
        };
        this.log('loaded');
        this.init();
    }

    async init() {
        if (!/\/player\/\d+/.test(window.location.pathname)) {
            return;
        }
        await this._loadSettings();
        if (!this.enabled) {
            this.log('설정 OFF — 다음 영상 자동 재생 방지 건너뜀');
            return;
        }
        this._start();
    }

    async _loadSettings() {
        if (window.VODSync?.IS_TAMPER_MONKEY_SCRIPT === true) {
            if (typeof GM_getValue === 'function') {
                this.enabled = GM_getValue('soopLiveWatchDisableAutoplay', true) !== false;
            }
            return;
        }
        try {
            const response = await chrome.runtime.sendMessage({ action: 'getAllSettings' });
            if (response?.success && response.settings) {
                this.enabled = response.settings.soopLiveWatchDisableAutoplay !== false;
            }
        } catch (error) {
            this.warn('설정 로드 실패, 기본값 사용:', error);
        }
    }

    _start() {
        if (this._timer != null) return;
        this.log('다음 영상 자동 재생 방지 시작 (1초 간격, 마지막 파일 ended만 차단)');
        this._bindEndedGuards();
        this._timer = setInterval(() => this._bindEndedGuards(), 1000);
    }

    // ended가 상위로 전파되지 않게 해서 다음 영상 자동 재생을 막는다.
    _bindEndedGuards() {
        document.querySelectorAll('#video').forEach((video) => {
            if (!(video instanceof HTMLMediaElement)) return;
            if (this._boundVideos.has(video)) return;
            video.addEventListener('ended', this._onVideoEndedCapture, true);
            this._boundVideos.add(video);
            this.log('video ended 가드 등록');
        });
    }

    /**
     * 분할 VOD 중간 파일 ended는 허용하고, 마지막 파일일 때만 차단한다.
     */
    _shouldBlockEndedPropagation() {
        const { playIdx, fileCount } = this._readPlayIdxState();

        if (playIdx != null && fileCount != null && fileCount > 0) {
            const isLast = playIdx >= fileCount - 1;
            this.log(
                isLast
                    ? `마지막 파일 ended — 다음 영상 자동재생 차단 (playIdx=${playIdx}/${fileCount - 1})`
                    : `중간 파일 ended — 전파 허용 (playIdx=${playIdx}, last=${fileCount - 1})`
            );
            return isLast;
        }

        // playIdx를 못하면 단일 파일로 보고 차단 (중간 전환 오탐보다 다음 영상 방지 우선)
        this.log('playIdx/files 확인 불가 — 다음 영상 자동재생 차단');
        return true;
    }

    _readPlayIdxState() {
        const vc = window.VODSync?.getVodCore?.() ?? null;
        let playIdx = null;
        let fileCount = null;
        if (!vc) return { playIdx, fileCount };

        const rawIdx = vc.playerController?.playIdx;
        if (Number.isFinite(Number(rawIdx))) {
            playIdx = Math.floor(Number(rawIdx));
        }

        const files = vc.config?.files;
        if (Array.isArray(files) && files.length > 0) {
            fileCount = files.length;
        } else if (Array.isArray(vc.fileItems) && vc.fileItems.length > 0) {
            fileCount = vc.fileItems.length;
        } else if (Number.isFinite(Number(vc.filesLength)) && Number(vc.filesLength) > 0) {
            fileCount = Math.floor(Number(vc.filesLength));
        }

        return { playIdx, fileCount };
    }
}
        /**
 * SOOP 원본 다시보기에서 파생된 클립·캐치가 원본의 어느 구간인지 지도로 보여준다. (구간은 재생 시간축 기준, changeSecond)
 *
 * - 원본 다시보기일 때만 동작한다. video info로 먼저 확인하고, 아니면 버튼도 만들지 않는다.
 * - 클립·캐치 검색은 사용자가 열기 버튼을 눌러 패널이 처음 만들어진 뒤에 시작한다.
 * - 상수와 순수 함수는 static 멤버라 인스턴스 없이 쓸 수 있다. 최상위에 클래스만 두는 건, TamperMonkey 빌드가
 *   모듈을 한 스코프에 이어 붙여서 최상위 이름이 다른 모듈과 충돌할 수 있기 때문이다.
 */
class SoopClipMap extends IVodSync {
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
        this._pollTimer = null;
        this._renderQueued = false;
        this._drag = null;
        this._toastTimer = null;
        this._geom = { W: 0 };

        /** @type {ReturnType<SoopClipMap['_newData']>|null} 열린 다시보기의 데이터 */
        this._d = null;
        this._ui = {
            view: { s: 0, e: 1 }, ph: 0, hover: null, sort: 'start', axis: 'play',
            kinds: { CLIP: true, CATCH: true }, listOpen: true, // listOpen: 오른쪽 클립·캐치 목록을 펼쳐 두었는가
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
        <button class="btn" id="btnList" aria-expanded="true">목록 접기 ▸</button>
        <button class="btn" id="btnRescan">다시 검색</button>
        <button class="btn" id="btnClose" aria-label="탐색기 닫기">닫기 ✕</button>
      </div>
    </div>
    <div class="body" id="body">
      <div class="main">
        <div class="sumrow">
          <div class="hot" id="hot"></div>
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
        this._open = false;
        this._host.hidden = true;
        this.openButton?.setAttribute('aria-expanded', 'false');
        document.removeEventListener('keydown', this._onKeyDown, true);
        clearInterval(this._pollTimer);
        this._pollTimer = null;
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
                const h = SoopClipMap.clamp(h0 + (y0 - ev.clientY), SoopClipMap.PANEL_MIN_H, window.innerHeight - 16);
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
        tip.style.left = `${SoopClipMap.clamp(x + (small ? 12 : 14), 8, window.innerWidth - w - 8)}px`;
        if (small) tip.style.top = `${y - h - 8 < 4 ? y + 16 : y - h - 8}px`;
        else tip.style.top = `${y + 18 + h > window.innerHeight ? y - h - 12 : y + 18}px`;
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
    static PANEL_MIN_H = 460; // 손잡이로 줄일 수 있는 패널 최소 높이(px). 이보다 작으면 내용이 넘친다. 최대는 창 높이 - 16px (CSS와 같은 값)

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

        // 타 플랫폼 동기화 iframe: API·링커·라이브 시청 댓글 알림·자동재생 방지만 기동
        if (isIframe) {
            new SoopAPI();
            new SoopVODLinker(true);
            if (/\/player\/\d+/.test(window.location.pathname)) {
                new SoopLiveWatchCommentNotifier();
                new SoopNextVideoAutoplayGuard();
            }
            return;
        }

        new SoopAPI();
        const tsManager = new SoopTimestampManager();
        new SoopVODLinker();
        if (/\/player\/\d+/.test(window.location.pathname)) {
            new SoopTimelineCommentProcessor();
            new SoopVeditorReplacement();
            new SoopPrevChatViewer();
            new SoopLiveWatchCommentNotifier();
            new SoopNextVideoAutoplayGuard();
            new SoopClipMap();
        }

        // 동기화 요청이 있는 경우 타임스탬프 매니저에게 요청
        const params = new URLSearchParams(window.location.search);
        const url_request_vod_ts = params.get("request_vod_ts");
        const url_request_real_ts = params.get("request_real_ts");
        if (url_request_vod_ts && tsManager){
            const request_vod_ts = parseInt(url_request_vod_ts);
            if (url_request_real_ts){ // 페이지 로딩 시간을 추가해야하는 경우.
                const request_real_ts = parseInt(url_request_real_ts);
                tsManager.RequestGlobalTSAsync(request_vod_ts, request_real_ts);
            }
            else{
                tsManager.RequestGlobalTSAsync(request_vod_ts);
            }
            
            // url 지우기
            const url = new URL(window.location.href);
            url.searchParams.delete('request_vod_ts');
            url.searchParams.delete('request_real_ts');
            window.history.replaceState({}, '', url.toString());
        }

        // timeline_sync=1 이면 localStorage에서 페이로드 로드 후 URL에서 제거
        const timelineSyncVal = params.get('timeline_sync');
        if (timelineSyncVal) {
            logToExtension('[content.user] timeline_sync 요청 감지:', timelineSyncVal);
            let payload = null;
            try {
                const storageKey = 'vodSync_timeline';
                const raw = localStorage.getItem(storageKey);
                if (raw) {
                    payload = JSON.parse(raw);
                    localStorage.removeItem(storageKey);
                    logToExtension('[content.user] timeline_sync localStorage 로드 성공', {
                        length: Array.isArray(payload) ? payload.length : null,
                        sample: Array.isArray(payload) ? payload.slice(0, 8) : payload,
                    });
                } else {
                    logToExtension('[content.user] timeline_sync localStorage 비어 있음 (키:', storageKey, ')');
                }
            } catch (e) {
                logToExtension('[content.user] timeline_sync localStorage 파싱 실패', e);
            }
            const processor = window.VODSync.timelineCommentProcessor;
            if (Array.isArray(payload)) {
                if (processor?.receiveTimelineSyncPayload) {
                    logToExtension('[content.user] timeline_sync → receiveTimelineSyncPayload 호출');
                    processor.receiveTimelineSyncPayload(payload);
                } else {
                    logToExtension('[content.user] timeline_sync 실패 — timelineCommentProcessor.receiveTimelineSyncPayload 없음', {
                        hasProcessor: !!processor,
                    });
                }
            } else {
                logToExtension('[content.user] timeline_sync 실패 — 페이로드가 배열이 아님', { payload });
            }
            const url = new URL(window.location.href);
            url.searchParams.delete('timeline_sync');
            window.history.replaceState({}, '', url.toString());
            logToExtension('[content.user] timeline_sync URL 파라미터 제거 완료');
        }
    }

    // iframe에서는 업데이트 알림·유저스크립트 메뉴 등 이후 로직을 실행하지 않음
    if (isIframe) return;

    // ===================== 라이브 시청 댓글 알림 설정 (유저스크립트 메뉴) =====================
    (function initLiveWatchCommentSettingsMenuTM() {
        if (
            typeof GM_registerMenuCommand !== 'function'
            || typeof GM_getValue !== 'function'
            || typeof GM_setValue !== 'function'
        ) {
            return;
        }

        const KEY_LIKE = 'soopLiveWatchLikeNotify';
        const KEY_COMMENT = 'soopLiveWatchCommentNotify';
        const KEY_DISABLE_AUTOPLAY = 'soopLiveWatchDisableAutoplay';
        const KEY_TEXT = 'soopLiveWatchCommentText';
        const KEY_TOAST = 'soopLiveWatchCommentToast';
        const KEY_DEDUP_MODE = 'soopLiveWatchCommentDedupMode';
        const KEY_COOLDOWN_TYPE = 'soopLiveWatchCommentCooldownType';
        const KEY_COOLDOWN_SECONDS = 'soopLiveWatchCommentCooldownSeconds';
        const KEY_COOLDOWN_HOURS_LEGACY = 'soopLiveWatchCommentCooldownHours';
        const DEFAULT_TEXT = '잘 볼게요';
        const DEFAULT_COOLDOWN_SECONDS = 3600;

        function getLikeEnabled() {
            return GM_getValue(KEY_LIKE, true) !== false;
        }
        function getCommentEnabled() {
            return GM_getValue(KEY_COMMENT, false) === true;
        }
        function getDisableAutoplayEnabled() {
            return GM_getValue(KEY_DISABLE_AUTOPLAY, true) !== false;
        }
        function getCommentText() {
            const text = GM_getValue(KEY_TEXT, DEFAULT_TEXT);
            return typeof text === 'string' && text.trim() ? text : DEFAULT_TEXT;
        }
        function getToastEnabled() {
            return GM_getValue(KEY_TOAST, true) !== false;
        }
        function getDedupMode() {
            return GM_getValue(KEY_DEDUP_MODE, 'cooldown') === 'existing_comment'
                ? 'existing_comment'
                : 'cooldown';
        }
        function getCooldownType() {
            return GM_getValue(KEY_COOLDOWN_TYPE, 'video_duration') === 'custom_hours'
                ? 'custom_hours'
                : 'video_duration';
        }
        function normalizeCooldownSeconds(secondsValue, legacyHoursValue) {
            const seconds = Number(secondsValue);
            if (Number.isFinite(seconds) && seconds > 0) {
                return Math.max(1, Math.floor(seconds));
            }
            const hours = Number(legacyHoursValue);
            if (Number.isFinite(hours) && hours > 0) {
                return Math.max(1, Math.round(hours * 3600));
            }
            return DEFAULT_COOLDOWN_SECONDS;
        }
        function getCooldownSeconds() {
            return normalizeCooldownSeconds(
                GM_getValue(KEY_COOLDOWN_SECONDS, null),
                GM_getValue(KEY_COOLDOWN_HOURS_LEGACY, null)
            );
        }
        function formatCooldownDuration(totalSeconds) {
            const normalized = normalizeCooldownSeconds(totalSeconds);
            const hours = Math.floor(normalized / 3600);
            const minutes = Math.floor((normalized % 3600) / 60);
            const seconds = normalized % 60;
            const parts = [];
            if (hours > 0) parts.push(`${hours}시간`);
            if (minutes > 0) parts.push(`${minutes}분`);
            if (seconds > 0 || parts.length === 0) parts.push(`${seconds}초`);
            return parts.join(' ');
        }
        function describeDedupPolicy() {
            if (getDedupMode() === 'existing_comment') {
                return '동일 문구 내 댓글이 있으면 댓글 등록 안 함';
            }
            if (getCooldownType() === 'custom_hours') {
                return `최초 알림 후 ${formatCooldownDuration(getCooldownSeconds())} 대기`;
            }
            return '최초 알림 후 영상 총 길이만큼 대기';
        }

        GM_registerMenuCommand('라이브 중 VOD 시청 알려주기: 상태 보기', () => {
            alert(
                `[라이브 중 VOD 시청 알려주기]\n`
                + `UP 하기: ${getLikeEnabled() ? 'ON' : 'OFF'}\n`
                + `댓글 등록: ${getCommentEnabled() ? 'ON' : 'OFF'}\n`
                + `다음 영상 자동 재생 끄기: ${getDisableAutoplayEnabled() ? 'ON' : 'OFF'}\n`
                + `토스트: ${getToastEnabled() ? 'ON' : 'OFF'}\n`
                + `문구: ${getCommentText()}\n`
                + `재등록 방지: ${describeDedupPolicy()}`
            );
        });

        GM_registerMenuCommand('라이브 중 VOD 시청 알려주기: UP 하기 ON/OFF', () => {
            const next = !getLikeEnabled();
            GM_setValue(KEY_LIKE, next);
            alert(
                `UP 하기 알림이 ${next ? 'ON' : 'OFF'}으로 설정되었습니다.\n`
                + `(다음 VOD 페이지 로드부터 적용)`
            );
        });

        GM_registerMenuCommand('라이브 중 VOD 시청 알려주기: 댓글 등록 ON/OFF', () => {
            const next = !getCommentEnabled();
            GM_setValue(KEY_COMMENT, next);
            alert(
                `댓글 등록 알림이 ${next ? 'ON' : 'OFF'}으로 설정되었습니다.\n`
                + `(다음 VOD 페이지 로드부터 적용)`
            );
        });

        GM_registerMenuCommand('라이브 중 VOD 시청 알려주기: 자동 재생 끄기 ON/OFF', () => {
            const next = !getDisableAutoplayEnabled();
            GM_setValue(KEY_DISABLE_AUTOPLAY, next);
            alert(
                `다음 영상 자동 재생 끄기가 ${next ? 'ON' : 'OFF'}으로 설정되었습니다.\n`
                + `(다음 VOD 페이지 로드부터 적용)`
            );
        });

        GM_registerMenuCommand('라이브 중 VOD 시청 알려주기: 토스트 ON/OFF', () => {
            const next = !getToastEnabled();
            GM_setValue(KEY_TOAST, next);
            alert(
                `안내 토스트가 ${next ? 'ON' : 'OFF'}으로 설정되었습니다.\n`
                + `(다음 성공 시점부터 적용)`
            );
        });

        GM_registerMenuCommand('라이브 중 VOD 시청 알려주기: 댓글 문구 설정', () => {
            const next = prompt('댓글 등록 문구를 입력하세요.', getCommentText());
            if (next === null) return;
            const saved = next.trim() || DEFAULT_TEXT;
            GM_setValue(KEY_TEXT, saved);
            alert(
                `댓글 등록 문구가 저장되었습니다.\n`
                + `문구: ${saved}\n`
                + `(다음 VOD 페이지 로드부터 적용)`
            );
        });

        GM_registerMenuCommand('라이브 중 VOD 시청 알려주기: 재등록 방지 설정', () => {
            const modeInput = prompt(
                '재등록 방지 방식을 고르세요.\n'
                + '1 = 동일 문구 내 댓글이 있으면 등록 안 함\n'
                + '2 = 최초 등록 후 일정 시간 대기',
                getDedupMode() === 'existing_comment' ? '1' : '2'
            );
            if (modeInput === null) return;
            const mode = String(modeInput).trim() === '1' ? 'existing_comment' : 'cooldown';
            GM_setValue(KEY_DEDUP_MODE, mode);

            if (mode === 'existing_comment') {
                alert(
                    '재등록 방지: 동일 문구 내 댓글이 있으면 등록하지 않음\n'
                    + '(다음 VOD 로드부터 적용)'
                );
                return;
            }

            const typeInput = prompt(
                '대기 시간 기준을 고르세요.\n'
                + '1 = 영상 총 길이\n'
                + '2 = 임의 지정 시간',
                getCooldownType() === 'custom_hours' ? '2' : '1'
            );
            if (typeInput === null) return;
            const type = String(typeInput).trim() === '2' ? 'custom_hours' : 'video_duration';
            GM_setValue(KEY_COOLDOWN_TYPE, type);

            if (type === 'custom_hours') {
                const current = getCooldownSeconds();
                const currentH = Math.floor(current / 3600);
                const currentM = Math.floor((current % 3600) / 60);
                const currentS = current % 60;
                const hoursInput = prompt('대기 시간 — 시간(정수)', String(currentH));
                if (hoursInput === null) return;
                const minutesInput = prompt('대기 시간 — 분(정수)', String(currentM));
                if (minutesInput === null) return;
                const secondsInput = prompt('대기 시간 — 초(정수)', String(currentS));
                if (secondsInput === null) return;
                const hours = Math.max(0, Math.floor(Number(hoursInput) || 0));
                const minutes = Math.max(0, Math.floor(Number(minutesInput) || 0));
                const seconds = Math.max(0, Math.floor(Number(secondsInput) || 0));
                const savedSeconds = normalizeCooldownSeconds(hours * 3600 + minutes * 60 + seconds);
                GM_setValue(KEY_COOLDOWN_SECONDS, savedSeconds);
                alert(
                    `재등록 방지: 최초 등록 후 ${formatCooldownDuration(savedSeconds)} 대기\n`
                    + `(다음 VOD 페이지 로드부터 적용)`
                );
                return;
            }

            alert(
                '재등록 방지: 최초 등록 후 영상 총 길이만큼 대기\n'
                + `(다음 VOD 페이지 로드부터 적용)`
            );
        });
    })();

    // ===================== 클립 탐색기 설정 (유저스크립트 메뉴) =====================
    (function initClipMapSettingsMenuTM() {
        if (
            typeof GM_registerMenuCommand !== 'function'
            || typeof GM_getValue !== 'function'
            || typeof GM_setValue !== 'function'
        ) {
            return;
        }
        const KEY_ENABLE = 'enableClipMap';
        GM_registerMenuCommand('클립 탐색기 버튼 표시 ON/OFF', () => {
            const next = GM_getValue(KEY_ENABLE, true) === false;
            GM_setValue(KEY_ENABLE, next);
            alert(
                `클립 탐색기 버튼이 ${next ? 'ON' : 'OFF'}으로 설정되었습니다.\n`
                + `(다음 VOD 페이지 로드부터 적용)`
            );
        });
    })();

    // ===================== 탬퍼몽키 업데이트 알림 =====================
    (function initUpdateNotificationTM() {
        if (typeof GM_info === 'undefined' || !GM_info.script || typeof GM_getValue !== 'function' || typeof GM_setValue !== 'function') return;

        function compareVersions(version1, version2) {
            const v1parts = version1.split('.').map(Number);
            const v2parts = version2.split('.').map(Number);
            for (let i = 0; i < Math.max(v1parts.length, v2parts.length); i++) {
                const v1part = v1parts[i] || 0;
                const v2part = v2parts[i] || 0;
                if (v1part > v2part) return 1;
                if (v1part < v2part) return -1;
            }
            return 0;
        }
        // 네 번째 자릿수만 바뀐 경우 false. 메이저·마이너·패치가 바뀌면 true.
        function shouldShowUpdateNotification(oldVersion, newVersion) {
            const oldParts = (oldVersion || '').split('.').map(Number);
            const newParts = (newVersion || '').split('.').map(Number);
            const oldMajor = oldParts[0] || 0, oldMinor = oldParts[1] || 0, oldPatch = oldParts[2] || 0;
            const newMajor = newParts[0] || 0, newMinor = newParts[1] || 0, newPatch = newParts[2] || 0;
            return oldMajor !== newMajor || oldMinor !== newMinor || oldPatch !== newPatch;
        }

        const MODAL_HTML_TEMPLATE = `
    <div id="vodSyncUpdateModal" style="
        position: fixed;
        z-index: 999999;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        ">
        <div id="modalContent" style="
            background-color: #fefefe;
            margin: auto;
            padding: 0;
            border-radius: 10px;
            width: auto;
            min-width: 300px;
            max-width: 90vw;
            height: auto;
            min-height: 200px;
            max-height: 90vh;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            animation: vodSyncModalSlideIn 0.3s ease-out;
            position: relative;
            ">
            <div style="
                background: linear-gradient(135deg, #007bff, #0056b3);
                color: white;
                padding: 15px 20px;
                border-radius: 10px 10px 0 0;
                display: flex;
                justify-content: space-between;
                align-items: center;
                ">
                <h2 style="margin: 0; font-size: 18px; font-weight: 600;"> VOD Master 업데이트 알림</h2>
                <span class="vod-sync-close" style="
                color: white;
                font-size: 28px;
                font-weight: bold;
                cursor: pointer;
                line-height: 1;
                ">&times;</span>
            </div>
            <iframe id="updateIframe" style="
            width: 500px;
            height: 300px;
            border: none;
            border-radius: 0 0 10px 10px;
            transition: width 0.3s ease, height 0.3s ease;
            "></iframe>
        </div>
    </div>
    <style>
        @keyframes vodSyncModalSlideIn {
            from { opacity: 0; transform: translateY(-50px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .vod-sync-close:hover { opacity: 0.7; }
    </style>
`;

        const SETUP_DOCS_URL = 'https://khassarion.github.io/VOD-Master/doc/index.html';

        function createAndShowUpdateModal(version, onClose) {
            const existingModal = document.getElementById('vodSyncUpdateModal');
            if (existingModal) existingModal.remove();
            document.body.insertAdjacentHTML('beforeend', MODAL_HTML_TEMPLATE);
            const modal = document.getElementById('vodSyncUpdateModal');
            const iframe = document.getElementById('updateIframe');
            if (modal && iframe) {
                modal.style.display = 'flex';
                iframe.src = 'https://khassarion.github.io/VOD-Master/doc/update_notification_v' + version + '.html';
                let closed = false;
                const closeModal = function() {
                    if (closed) return;
                    closed = true;
                    modal.remove();
                    document.removeEventListener('keydown', handleEscKey);
                    if (typeof onClose === 'function') onClose();
                };
                modal.querySelector('.vod-sync-close').onclick = closeModal;
                modal.onclick = function(e) { if (e.target === modal) closeModal(); };
                const handleEscKey = function(e) {
                    if (e.key === 'Escape') closeModal();
                };
                document.addEventListener('keydown', handleEscKey);
            } else if (typeof onClose === 'function') {
                onClose();
            }
        }

        // 최초 설치 시에만: 설치 완료 문구와 문서 새 탭 버튼. 설정은 유저스크립트 메뉴 안내.
        function createAndShowSetupModalTM() {
            const existing = document.getElementById('vodSyncSetupModal');
            if (existing) existing.remove();
            document.body.insertAdjacentHTML('beforeend', `
    <div id="vodSyncSetupModal" style="
        position: fixed; z-index: 999998; left: 0; top: 0; width: 100%; height: 100%;
        background-color: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
        <div style="background:#fff; border-radius:10px; width:min(440px,92vw); max-height:90vh; overflow:auto;
            box-shadow:0 4px 20px rgba(0,0,0,0.3);">
            <div style="background:linear-gradient(135deg,#007bff,#0056b3); color:#fff; padding:14px 18px; border-radius:10px 10px 0 0;">
                <h2 style="margin:0; font-size:18px;">VOD Master 설치 완료</h2>
            </div>
            <div style="padding:20px 18px;">
                <p style="margin:0 0 12px; font-size:15px; color:#333; line-height:1.55;">
                    VOD Master 설치가 완료되었습니다.<br>
                    기능 설명은 아래 버튼으로 새 탭에서 열 수 있습니다.
                </p>
                <p style="margin:0 0 18px; font-size:13px; color:#666; line-height:1.45;">
                    세부 설정은 Tampermonkey 유저스크립트 메뉴에서 변경할 수 있습니다.
                </p>
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <button id="vodSyncSetupDocsBtn" type="button" style="
                        background:#007bff; color:#fff; border:none; border-radius:6px;
                        padding:12px 16px; font-size:14px; cursor:pointer; width:100%;">기능 설명 문서 열기</button>
                    <button id="vodSyncSetupCloseBtn" type="button" style="
                        background:transparent; color:#666; border:none; border-radius:6px;
                        padding:8px 16px; font-size:13px; cursor:pointer; width:100%;">닫기</button>
                </div>
            </div>
        </div>
    </div>`);
            const modal = document.getElementById('vodSyncSetupModal');
            const closeBtn = document.getElementById('vodSyncSetupCloseBtn');
            // 문서를 열어 본 뒤에는 닫기 문구를 부드럽게 바꾼다.
            const markExplored = function() {
                closeBtn.textContent = '이제 닫을래요';
            };
            const closeModal = function() {
                modal.remove();
            };
            document.getElementById('vodSyncSetupDocsBtn').onclick = function() {
                window.open(SETUP_DOCS_URL, '_blank', 'noopener,noreferrer');
                markExplored();
            };
            closeBtn.onclick = closeModal;
            modal.onclick = function(e) {
                if (e.target === modal) closeModal();
            };
        }

        function resizeIframe(iframe, contentWidth, contentHeight) {
            try {
                const minWidth = 300, maxWidth = 600, minHeight = 200, maxHeight = 960, headerHeight = 60;
                const maxModalHeight = Math.floor(window.innerHeight * 0.9);
                const maxIframeHeight = Math.max(minHeight, maxModalHeight - headerHeight);
                const newWidth = Math.max(minWidth, Math.min(maxWidth, contentWidth));
                const newHeight = Math.max(minHeight, Math.min(maxHeight, maxIframeHeight, contentHeight));
                iframe.style.width = newWidth + 'px';
                iframe.style.height = newHeight + 'px';
                const modalContent = document.getElementById('modalContent');
                if (modalContent) {
                    modalContent.style.width = newWidth + 'px';
                    modalContent.style.height = Math.min(newHeight + headerHeight, maxModalHeight) + 'px';
                }
            } catch (e) {
                const iframe = document.getElementById('updateIframe');
                const modalContent = document.getElementById('modalContent');
                if (iframe) { iframe.style.width = '500px'; iframe.style.height = '300px'; }
                if (modalContent) { modalContent.style.width = '500px'; modalContent.style.height = '360px'; }
            }
        }

        window.addEventListener('message', function(event) {
            if (event.data && event.data.type === 'vodSync-iframe-resize') {
                const iframe = document.getElementById('updateIframe');
                if (iframe) resizeIframe(iframe, event.data.width, event.data.height);
            }
        });

        async function checkForUpdatesTM() {
            try {
                const currentVersion = (GM_info.script && GM_info.script.version) ? GM_info.script.version : '';
                if (!currentVersion) return;
                let lastCheckedVersion = GM_getValue('vodSync_lastCheckedVersion', null);
                lastCheckedVersion = await Promise.resolve(lastCheckedVersion);
                if (typeof lastCheckedVersion !== 'string') lastCheckedVersion = null;

                // lastCheckedVersion 없음 = 진짜 첫 설치 → 설치 완료 안내만
                if (!lastCheckedVersion) {
                    createAndShowSetupModalTM();
                    const setResult = GM_setValue('vodSync_lastCheckedVersion', currentVersion);
                    await Promise.resolve(setResult);
                    return;
                }

                if (compareVersions(currentVersion, lastCheckedVersion) > 0) {
                    if (shouldShowUpdateNotification(lastCheckedVersion, currentVersion)) {
                        createAndShowUpdateModal(currentVersion);
                    }
                    const setResult = GM_setValue('vodSync_lastCheckedVersion', currentVersion);
                    await Promise.resolve(setResult);
                }
            } catch (err) {
                logToExtension('업데이트 확인 중 오류:', err);
            }
        }

        setTimeout(checkForUpdatesTM, 2000);
    })();
})(); 