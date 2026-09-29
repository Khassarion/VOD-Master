// ==UserScript==
// @name         VOD Master (SOOP)
// @namespace    http://tampermonkey.net/
// @version      1.8.0.1
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
        {{IVodSync}}
        {{SoopAPI}}
        {{TimestampManagerBase}}
        // TamperMonkey 환경은 페이지와 같은 월드이므로 실제 vodCore를 그대로 반환한다.
        window.VODSync.getVodCore = () => {
            if (typeof unsafeWindow === 'undefined') return null;
            const vc = unsafeWindow.vodCore;
            return vc && typeof vc === 'object' ? vc : null;
        };
        const MAX_DURATION_DIFF = 30*1000;
        {{SoopTimestampManager}}
        {{VODLinkerBase}}
        {{SoopVODLinker}}
        {{TimelineCommentProcessorBase}}
        {{SoopTimelineCommentProcessor}}
        {{SoopPrevChatViewer}}
        {{SoopVeditorReplacement}}
        {{SoopLiveWatchCommentNotifier}}
        {{SoopNextVideoAutoplayGuard}}
        {{SoopClipMap}}

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