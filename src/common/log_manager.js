// ===================== 로그 관리자 =====================
// Background script로 중앙 집중식 로그 관리
// 모든 context에서 동일한 로그 저장소 사용

// 탭 정보를 가져오는 함수 (ID와 제목)
async function getTabInfo() {
    const response = await chrome.runtime.sendMessage({ action: 'getTabId' });
    return {
        id: response.tabId || 'unknown',
        title: response.tabTitle || document.title || 'unknown'
    };
}

// 탭 제목에서 식별자 생성
function createTabDisplayName(tabTitle) {
    if (!tabTitle || tabTitle === 'unknown') {
        return 'Unknown';
    }
    
    // 제목의 앞부분 10자까지 사용
    let displayName = tabTitle.substring(0, 10);
    
    // 특수문자 제거 및 정리
    displayName = displayName.replace(/[^\w\s가-힣]/g, '');
    
    // 공백이 많으면 줄이기
    displayName = displayName.replace(/\s+/g, ' ').trim();
    
    // 원본 제목이 10자보다 길면 ... 추가
    if (tabTitle.length > 10) {
        displayName += '...';
    }
    
    return displayName || 'Tab';
}

// 탭 정보를 포함한 로그 메시지 생성
function createLogMessage(tabId, tabTitle, ...args) {
    const timestamp = new Date().toLocaleTimeString();
    const displayName = createTabDisplayName(tabTitle);
    return [`[${displayName}] [${timestamp}]`, ...args];
}

// 디버깅용 함수 - 현재 탭 정보 확인
async function debugTabInfo() {
    const tabInfo = await getTabInfo();
    const displayName = createTabDisplayName(tabInfo.title);
    
    console.log('Tab ID:', tabInfo.id);
    console.log('Tab Title:', tabInfo.title);
    console.log('Display Name:', displayName);
    console.log('Current URL:', window.location.href);
    
    return { 
        tabId: tabInfo.id, 
        tabTitle: tabInfo.title,
        displayName: displayName,
        url: window.location.href
    };
}

// 공통 로깅 함수 (모든 파일에서 사용) - Background script로 직접 전송
async function logToExtension(...args) {
    try {
        const tabInfo = await getTabInfo();
        const logMessage = createLogMessage(tabInfo.id, tabInfo.title, ...args);
        
        chrome.runtime.sendMessage({
            action: 'addLog',
            level: 'log',
            args: logMessage
        }).catch(() => {
            // Background script에 접근할 수 없는 경우 콘솔에 출력
            console.error(...logMessage);
        });
        // console.log(...logMessage);
    } catch (error) {
        console.log(...args);
    }
}

async function infoToExtension(...args) {
    try {
        const tabInfo = await getTabInfo();
        const logMessage = createLogMessage(tabInfo.id, tabInfo.title, ...args);
        
        chrome.runtime.sendMessage({
            action: 'addLog',
            level: 'info',
            args: logMessage
        }).catch(() => {
            console.error(...logMessage);
        });
        // console.info(...logMessage);
    } catch (error) {
        console.log(...args);
    }
}

async function warnToExtension(...args) {
    try {
        const tabInfo = await getTabInfo();
        const logMessage = createLogMessage(tabInfo.id, tabInfo.title, ...args);
        
        chrome.runtime.sendMessage({
            action: 'addLog',
            level: 'warn',
            args: logMessage
        }).catch(() => {
            console.error(...logMessage);
        });
        // console.warn(...logMessage);
    } catch (error) {
        console.log(...args);
    }
}

async function errorToExtension(...args) {
    try {
        const tabInfo = await getTabInfo();
        const logMessage = createLogMessage(tabInfo.id, tabInfo.title, ...args);
        
        chrome.runtime.sendMessage({
            action: 'addLog',
            level: 'error',
            args: logMessage
        }).catch(() => {
            console.error(...logMessage);
        });
        // console.error(...logMessage);
    } catch (error) {
        console.log(...args);
    }
}

async function debugToExtension(...args) {
    try {
        const tabInfo = await getTabInfo();
        const logMessage = createLogMessage(tabInfo.id, tabInfo.title, ...args);
        
        chrome.runtime.sendMessage({
            action: 'addLog',
            level: 'debug',
            args: logMessage
        }).catch(() => {
            console.error(...logMessage);
        });
        // console.debug(...logMessage);
    } catch (error) {
        console.debug(...args);
    }
}

// ===================== 업데이트 관리자 =====================
// 버전 업데이트 감지 및 알림 기능


// 현재 버전 가져오기
function getCurrentVersion() {
    return chrome.runtime.getManifest().version;
}

// 저장된 마지막 확인 버전 가져오기
async function getLastCheckedVersion() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['lastCheckedVersion'], (result) => {
            resolve(result.lastCheckedVersion || null);
        });
    });
}

// 마지막 확인 버전 저장
async function setLastCheckedVersion(version) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ lastCheckedVersion: version }, () => {
            resolve();
        });
    });
}

// 버전 비교 함수 (semantic versioning)
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

// 네 번째 자릿수만 바뀐 경우 false(빌드/리비전만 갱신). 그 앞 메이저·마이너·패치가 바뀌면 true.
function shouldShowUpdateNotification(oldVersion, newVersion) {
    const oldParts = (oldVersion || '').split('.').map(Number);
    const newParts = (newVersion || '').split('.').map(Number);
    const oldMajor = oldParts[0] || 0;
    const oldMinor = oldParts[1] || 0;
    const oldPatch = oldParts[2] || 0;
    const newMajor = newParts[0] || 0;
    const newMinor = newParts[1] || 0;
    const newPatch = newParts[2] || 0;
    return oldMajor !== newMajor || oldMinor !== newMinor || oldPatch !== newPatch;
}

// 간단한 iframe 모달 템플릿
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
            from {
                opacity: 0;
                transform: translateY(-50px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        .vod-sync-close:hover {
            opacity: 0.7;
        }
    </style>
`;

/** 설치 완료 안내·기능 설명 문서 URL */
const FEATURE_DOCS_URL = 'https://khassarion.github.io/VOD-Master/doc/index.html';

// 동적 모달 생성 및 표시 (iframe 방식)
function createAndShowUpdateModal(version, onClose) {
    logToExtension(`업데이트 알림 표시됨: v${version}`);
    // 기존 모달이 있으면 제거
    const existingModal = document.getElementById('vodSyncUpdateModal');
    if (existingModal) {
        existingModal.remove();
    }
    
    // 모달을 body에 추가
    document.body.insertAdjacentHTML('beforeend', MODAL_HTML_TEMPLATE);
    
    // 모달 표시
    const modal = document.getElementById('vodSyncUpdateModal');
    const iframe = document.getElementById('updateIframe');
    
    if (modal && iframe) {
        modal.style.display = 'flex';
        
        // URL 파라미터로 업데이트 정보 전달
        const iframeUrl = `https://khassarion.github.io/VOD-Master/doc/update_notification_v${version}.html`;
        
        iframe.src = iframeUrl;
        
        // 모달 닫기 이벤트 설정
        const closeBtn = modal.querySelector('.vod-sync-close');
        let closed = false;
        
        const closeModal = () => {
            if (closed) return;
            closed = true;
            modal.remove();
            document.removeEventListener('keydown', handleEscKey);
            if (typeof onClose === 'function') onClose();
        };
        
        closeBtn.onclick = closeModal;
        
        // 모달 외부 클릭 시 닫기
        modal.onclick = (e) => {
            if (e.target === modal) closeModal();
        };
        
        // ESC 키로 닫기
        const handleEscKey = (e) => {
            if (e.key === 'Escape') {
                closeModal();
            }
        };
        document.addEventListener('keydown', handleEscKey);
    } else if (typeof onClose === 'function') {
        onClose();
    }
}

// 최초 설치 시에만: 설치 완료 문구와 문서/설정 새 탭 버튼만 보여 준다.
function createAndShowSetupModal() {
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
                <p style="margin:0 0 18px; font-size:15px; color:#333; line-height:1.55;">
                    VOD Master 설치가 완료되었습니다.<br>
                    기능 설명과 설정은 아래 버튼으로 새 탭에서 열 수 있습니다.
                </p>
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <button id="vodSyncSetupSettingsBtn" type="button" style="
                        background:#007bff; color:#fff; border:none; border-radius:6px;
                        padding:12px 16px; font-size:14px; cursor:pointer; width:100%;">설정 페이지 열기</button>
                    <button id="vodSyncSetupDocsBtn" type="button" style="
                        background:#fff; color:#007bff; border:1px solid #007bff; border-radius:6px;
                        padding:12px 16px; font-size:14px; cursor:pointer; width:100%;">기능 설명 문서 열기</button>
                    <button id="vodSyncSetupCloseBtn" type="button" style="
                        background:transparent; color:#666; border:none; border-radius:6px;
                        padding:8px 16px; font-size:13px; cursor:pointer; width:100%;">안 봤지만 그냥 닫을래요</button>
                </div>
            </div>
        </div>
    </div>`);

    const modal = document.getElementById('vodSyncSetupModal');
    const closeBtn = document.getElementById('vodSyncSetupCloseBtn');
    // 설정·문서를 열어 본 뒤에는 닫기 문구를 부드럽게 바꾼다.
    const markExplored = () => {
        closeBtn.textContent = '봤어요, 이제 닫을래요';
    };
    const closeModal = () => {
        modal.remove();
        logToExtension('설치 완료 안내 닫음');
    };

    document.getElementById('vodSyncSetupDocsBtn').onclick = () => {
        window.open(FEATURE_DOCS_URL, '_blank', 'noopener,noreferrer');
        markExplored();
    };
    // 웹 페이지에서 chrome-extension:// 을 window.open 하면 차단되므로 백그라운드에 위임
    document.getElementById('vodSyncSetupSettingsBtn').onclick = () => {
        chrome.runtime.sendMessage({ action: 'openSettings' });
        markExplored();
    };
    closeBtn.onclick = closeModal;
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };
}


// iframe 크기 자동 조절 함수 (postMessage로 받은 크기 정보 사용)
function resizeIframe(iframe, contentWidth, contentHeight) {
    try {
        const minWidth = 300;
        const maxWidth = 600;
        const minHeight = 200;
        const maxHeight = 960;
        const headerHeight = 60;
        // SOOP 등 스크롤 있는 페이지에서 모달이 뷰포트를 뚫고 나가지 않도록 90vh 이내로 제한
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
    } catch (error) {
        console.error('iframe 크기 조절 중 오류:', error);
        iframe.style.width = '500px';
        iframe.style.height = '300px';
        const modalContent = document.getElementById('modalContent');
        if (modalContent) {
            modalContent.style.width = '500px';
            modalContent.style.height = '360px';
        }
    }
}

// postMessage 이벤트 리스너 추가
window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'vodSync-iframe-resize') {
        const iframe = document.getElementById('updateIframe');
        if (iframe) {
            resizeIframe(iframe, event.data.width, event.data.height);
        }
    }
});
// 업데이트 확인 및 알림
async function checkForUpdates() {
    try {
        const currentVersion = getCurrentVersion();
        const lastCheckedVersion = await getLastCheckedVersion();

        logToExtension(`업데이트 확인 중... 현재 버전: ${currentVersion}, 마지막 확인: ${lastCheckedVersion || '없음'}`);

        // lastCheckedVersion 없음 = 진짜 첫 설치 → 설치 완료 안내만
        if (!lastCheckedVersion) {
            logToExtension(`첫 설치 감지: v${currentVersion} — 설치 완료 안내 표시`);
            if (window === top) createAndShowSetupModal();
            await setLastCheckedVersion(currentVersion);
            return;
        }

        if (compareVersions(currentVersion, lastCheckedVersion) > 0) {
            logToExtension(`새로운 업데이트 감지됨: v${currentVersion}`);
            // 네 번째 자릿수만 바뀐 경우 알림 표시 안 함.
            if (shouldShowUpdateNotification(lastCheckedVersion, currentVersion)) {
                const settings = await getSettings();
                if (settings.enableUpdateNotification) {
                    createAndShowUpdateModal(currentVersion);
                } else {
                    logToExtension(`업데이트 알림이 비활성화되어 있습니다.`);
                }
            } else {
                logToExtension(`네 번째 세그먼트만 변경된 업데이트(v${currentVersion})라 알림을 표시하지 않습니다.`);
            }
            await setLastCheckedVersion(currentVersion);
        } else {
            logToExtension(`업데이트 없음. 현재 버전: ${currentVersion}`);
        }
    } catch (error) {
        errorToExtension('업데이트 확인 중 오류 발생:', error);
    }
}

// 설정 가져오기 함수
async function getSettings() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getAllSettings' });
        if (response.success) {
            return response.settings;
        } else {
            // 기본값도 SettingsManager에서 가져오기
            const defaultResponse = await chrome.runtime.sendMessage({ action: 'getDefaultSettings' });
            return defaultResponse.defaultSettings;
        }
    } catch (error) {
        logToExtension('설정 로드 실패:', error);
        return {};
    }
}

// 로그 매니저 로드 시 자동으로 업데이트 확인
// 약간의 지연을 두고 업데이트 확인 (페이지 로딩 완료 후)
setTimeout(() => {
    checkForUpdates();
}, 2000);

const registerTab = () => {
    try{
        if (window !== top) return;
        chrome.runtime.sendMessage({ action: 'addChangeCallback' });
        const isSoopVodPage = /^https:\/\/vod\.sooplive\.com\/player\/\d+/.test(window.location.href);
        const isChzzkVodPage = /^https:\/\/chzzk\.naver\.com\/video\/\d+/.test(window.location.href);
        if (isSoopVodPage || isChzzkVodPage) {
            chrome.runtime.sendMessage({action: 'registerBroadcastSyncTab',});
        } else {
            chrome.runtime.sendMessage({action: 'unregisterBroadcastSyncTab',});
        }
    } catch (error) {
        console.warn('[VOD Master] 설정 변경 콜백 등록 실패. 확장프로그램이 리로드되었거나 비활성화된 것 같습니다. 페이지를 새로고침하십시오.', error);
    }
}
registerTab();
setInterval(registerTab, 25000);