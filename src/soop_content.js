window.VODSync = window.VODSync || {};
window.VODSync.SoopUrls = {
    VOD_ORIGIN: 'https://vod.sooplive.com',
    WWW_ORIGIN: 'https://www.sooplive.com',
    ...(window.VODSync.SoopUrls || {}),
};

/**
 * vodCore ghost: 페이지 MAIN 에 `soop_vodcore_page_bridge.js` 를 ES 모듈로 주입한다.
 * 해당 파일이 `export class VodCorePageBridge` + `mountVodCorePageBridge()` 로 스스로 기동한다.
 * top·iframe 플레이어 모두에서 호출한다.
 */
function initVodCorePageBridgeHost() {
    window.VODSync = window.VODSync || {};
    window.VODSync.IS_TAMPER_MONKEY_SCRIPT = false;
    const GHOST_ID = '__vs_vodcore_ghost';
    const PAGE_SCRIPT_PATH = 'src/module/soop_vodcore_page_bridge.js';
    let scriptInjected = false;
    let injectUnavailable = false;
    function installPageScript() {
        if (scriptInjected || injectUnavailable) return;
        if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) {
            injectUnavailable = true;
            return;
        }
        scriptInjected = true;
        const url = chrome.runtime.getURL(PAGE_SCRIPT_PATH);
        const s = document.createElement('script');
        s.type = 'module';
        s.src = url;
        s.onload = () => s.remove();
        s.onerror = () => {
            scriptInjected = false;
            console.error(
                '[VOD-Master] vodCore page bridge failed to load (check manifest web_accessible_resources):',
                url
            );
        };
        (document.documentElement || document.head || document.body).appendChild(s);
    }
    window.VODSync.vodCoreBridge = {
        GHOST_ID,
        installPageScript,
        getGhost: () => document.getElementById(GHOST_ID),
    };
    // 격리 월드에서 페이지 vodCore 대신 쓰는 파사드(형태는 vodCore와 유사).
    window.VODSync.getVodCore = () => {
        const getNode = () => document.getElementById(GHOST_ID);
        if (!getNode()) return null;
        const readDataset = (key) => {
            const node = getNode();
            if (!node || !node.dataset) return '';
            const raw = node.dataset[key];
            return raw == null ? '' : String(raw);
        };
        return {
            playerController: {
                get playingTime() {
                    const pt = parseFloat(readDataset('playingTime'));
                    return Number.isFinite(pt) ? Math.max(0, pt) : NaN;
                },
                get playIdx() {
                    const idx = parseInt(readDataset('playIdx'), 10);
                    return Number.isFinite(idx) ? idx : NaN;
                },
            },
            get filesLength() {
                const n = parseInt(readDataset('filesLength'), 10);
                return Number.isFinite(n) && n > 0 ? n : 0;
            },
            config: new Proxy(
                {},
                {
                    get(_target, prop) {
                        if (typeof prop !== 'string') return undefined;
                        const raw = readDataset(prop);
                        return raw === '' ? undefined : raw;
                    },
                }
            ),
            seek(sec) {
                const node = getNode();
                if (!node) return false;
                const s = Math.max(0, Number(sec));
                node.setAttribute('data-vs-seek', String(Number.isFinite(s) ? s : 0));
                return true;
            },
            get speed() {
                const v = document.querySelector('video');
                if (!(v instanceof HTMLVideoElement)) return 1;
                return Number.isFinite(v.playbackRate) && v.playbackRate > 0 ? v.playbackRate : 1;
            },
            set speed(rate) {
                const node = getNode();
                if (!node) return;
                const r = Number(rate);
                if (!Number.isFinite(r) || r <= 0) return;
                node.setAttribute('data-vs-playback-rate', String(r));
            },
        };
    };
    installPageScript();
}

if (window == top && window.location.origin.includes(new URL(window.VODSync.SoopUrls.VOD_ORIGIN).host)) {
    let tsManager = null;
    let syncPanel = null;
    let rpPanel = null;
    let cachedSettings = {};
    
    function log(...data){
        if (typeof logToExtension !== 'function') {
            console.log('[soop_content.js:top]', ...data);
            return;
        }
        logToExtension('[soop_content.js:top]', ...data);
    }
    log('loaded');

    // 설정 관련 함수들
    async function getAllSettings() {
        try {
            const response = await chrome.runtime.sendMessage({ action: 'getAllSettings' });
            if (response.success) {
                cachedSettings = response.settings;
            }
        } catch (error) {
            console.error('설정 조회 실패:', error);
        }
    }

    // 설정에 따라 기능 초기화
    async function initializeFeatures() {
        // SOOP 플랫폼에서 필요한 클래스들 구성
        const classConfig = {
            'SoopAPI': 'src/module/soop_api.js',
            'SoopTimestampManager': 'src/module/soop_timestamp_manager.js',
            'SoopVODLinker': 'src/module/soop_vod_linker.js',
            'SoopTimelineCommentProcessor': 'src/module/soop_timeline_comment_processor.js',
            'OtherPlatformSyncPanel': 'src/module/other_platform_sync_panel.js',
            'RPNicknamePanel': 'src/module/rp_nickname_panel.js',
            'SoopPrevChatViewer': 'src/module/soop_prev_chat_viewer.js',
            'SoopVeditorReplacement': 'src/module/soop_veditor_replacement.js',
            'SoopLiveWatchCommentNotifier': 'src/module/soop_live_watch_comment_notifier.js',
            'SoopNextVideoAutoplayGuard': 'src/module/soop_next_video_autoplay_guard.js',
            'SoopClipMap': 'src/module/soop_clip_map.js',
        };
        
        // 클래스 로더를 통해 필요한 클래스들 로드
        const classes = await window.VODSync.classLoader.loadClasses(classConfig);

        // 필요한 클래스들 생성
        new classes.SoopAPI();
        tsManager = new classes.SoopTimestampManager();
        new classes.SoopVODLinker(false);
        rpPanel = new classes.RPNicknamePanel();
        if (/\/player\/\d+/.test(window.location.pathname)) {
            new classes.SoopTimelineCommentProcessor();
            new classes.SoopVeditorReplacement();
            syncPanel = new classes.OtherPlatformSyncPanel('soop');
            new classes.SoopPrevChatViewer();
            
            initVodCorePageBridgeHost();
            new classes.SoopLiveWatchCommentNotifier();
            new classes.SoopNextVideoAutoplayGuard();
            new classes.SoopClipMap();
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
            log('timeline_sync 요청 감지:', timelineSyncVal);
            let payload = null;
            try {
                const storageKey = 'vodSync_timeline';
                const raw = localStorage.getItem(storageKey);
                if (raw) {
                    payload = JSON.parse(raw);
                    localStorage.removeItem(storageKey);
                    log('timeline_sync localStorage 로드 성공', {
                        length: Array.isArray(payload) ? payload.length : null,
                        sample: Array.isArray(payload) ? payload.slice(0, 8) : payload,
                    });
                } else {
                    log('timeline_sync localStorage 비어 있음 (키:', storageKey, ')');
                }
            } catch (e) {
                log('timeline_sync localStorage 파싱 실패', e);
            }
            const processor = window.VODSync.timelineCommentProcessor;
            if (Array.isArray(payload)) {
                if (processor?.receiveTimelineSyncPayload) {
                    log('timeline_sync → receiveTimelineSyncPayload 호출');
                    processor.receiveTimelineSyncPayload(payload);
                } else {
                    log('timeline_sync 실패 — timelineCommentProcessor.receiveTimelineSyncPayload 없음', {
                        hasProcessor: !!processor,
                    });
                }
            } else {
                log('timeline_sync 실패 — 페이로드가 배열이 아님', { payload });
            }
            const url = new URL(window.location.href);
            url.searchParams.delete('timeline_sync');
            window.history.replaceState({}, '', url.toString());
            log('timeline_sync URL 파라미터 제거 완료');
        }

        // 설정 로딩이 완료될 때까지 기다림
        await getAllSettings();
        
        updateFeaturesState();
        
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.action === 'notifyChangeCallbacks') {
                log('설정 변경 감지, 기능 업데이트 중...');
                // 캐싱된 설정 갱신
                cachedSettings = message.settings;
                updateFeaturesState();
            }
            sendResponse({ success: true });
            return true;
        });
    }
    // 기능 업데이트 함수
    function updateFeaturesState() {
        const enableSyncPanel = cachedSettings.enableSyncPanel || false;
        const enableRpPanel = cachedSettings.enableRpPanel || false;
        const enableTimestamp = cachedSettings.enableTimestamp || false;

        log('기능 업데이트:', {
            enableSyncPanel,
            enableRpPanel,
            enableTimestamp
        });

        // 동기화 패널 토글
        if (enableSyncPanel) {
            log('동기화 패널 활성화');
            syncPanel.closePanel();
        } else {
            log('동기화 패널 비활성화');
            syncPanel.hideCompletely();
        }

        // RP 패널 토글
        if (enableRpPanel) {
            log('RP 패널 활성화');
            rpPanel.closePanel();
        } else {
            log('RP 패널 비활성화');
            rpPanel.hideCompletely();
        }

        // 타임스탬프 매니저 초기화
        if (enableTimestamp) {
            log('타임스탬프 매니저 활성화');
            tsManager.enable();
        } else {
            log('타임스탬프 매니저 비활성화');
            tsManager.disable();
        }
    }

    // 기능 초기화 실행
    initializeFeatures().catch(error => {
        const detail = error instanceof Error
            ? `${error.name}: ${error.message}\n${error.stack || ''}`
            : String(error);
        log('기능 초기화 중 오류 발생:', detail);
        console.error('[soop_content.js:top] 기능 초기화 중 오류:', error);
    });

}
// 타 플랫폼에서 실행되는 경우(iframe)
else {
    function log(...data){
        if (typeof logToExtension !== 'function') {
            console.log('[soop_content.js:iframe]', ...data);
            return;
        }
        logToExtension('[soop_content.js:iframe]', ...data);
    }
    log('loaded');

    // 필요한 클래스들 구성 (타 플랫폼 동기화 iframe 등)
    const classConfig = {
        'SoopAPI': 'src/module/soop_api.js',
        'SoopVODLinker': 'src/module/soop_vod_linker.js',
        'SoopLiveWatchCommentNotifier': 'src/module/soop_live_watch_comment_notifier.js',
        'SoopNextVideoAutoplayGuard': 'src/module/soop_next_video_autoplay_guard.js',
    };
    window.VODSync.classLoader.loadClasses(classConfig).then(classes => {
        new classes.SoopAPI();
        new classes.SoopVODLinker(true);
        // vod 플레이어 iframe에서도 라이브 시청 댓글 알림·다음 영상 자동 재생 방지 동작
        if (
            window.location.origin.includes(new URL(window.VODSync.SoopUrls.VOD_ORIGIN).host)
            && /\/player\/\d+/.test(window.location.pathname)
        ) {
            initVodCorePageBridgeHost();
            new classes.SoopLiveWatchCommentNotifier();
            new classes.SoopNextVideoAutoplayGuard();
        }
    });
}