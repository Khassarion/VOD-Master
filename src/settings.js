// 설정 창 JavaScript
class settingPageManager {
    constructor() {
        this.log('constructor');
        this.defaultSettings = {};
        this.settings = {};
        this.savedSnapshot = null; // 마지막으로 저장(또는 불러온) 시점의 입력값. 지금 입력값과 다르면 저장하지 않은 변경사항이 있는 것이다.
        this.init();
    }
    log(...data){
        console.log(`[${this.constructor.name}] `, ...data);
    }

    init() {
        this.loadSettings();
        this.setupEventListeners();
        this.displayVersion();
    }

    loadSettings() {
        this.log('loadSettings');
        chrome.runtime.sendMessage({ action: 'getDefaultSettings'}, (response) => {
            this.defaultSettings = response.defaultSettings;
        });
        chrome.runtime.sendMessage({ action: 'getAllSettings'}, (response) => {
            this.settings = { ...this.defaultSettings, ...response.settings };
            this.displaySettings();
            this.markSaved();
        });
    }

    saveSettings() {
        chrome.runtime.sendMessage({ action: 'saveSettings', settings: this.settings}, (response) => {
            if (response.success) {
                this.markSaved();
                this.showStatus('설정이 저장되었습니다. 일부 설정은 페이지 새로고침이 필요할 수 있습니다.', 'success');
            } else {
                this.showStatus('설정 저장에 실패했습니다.', 'error');
            }
        });
    }

    resetSettings() {
        this.settings = { ...this.defaultSettings };
        this.displaySettings();
        this.updateUnsavedNotice(); // 초기화는 저장 전까지 적용되지 않으므로 변경사항으로 표시된다.
        this.showStatus('설정이 초기화되었습니다.', 'success');
    }

    // 지금 입력칸의 값을 "저장했을 때의 설정"으로 만들어 문자열로 돌려준다. (this.settings는 바꾸지 않는다.)
    snapshotForm() {
        const current = this.settings;
        this.settings = { ...current };
        this.collectSettings();
        const snapshot = JSON.stringify(Object.entries(this.settings).sort(([a], [b]) => a.localeCompare(b)));
        this.settings = current;
        return snapshot;
    }

    // 지금 입력칸의 값을 저장된 상태로 기억하고 경고를 지운다.
    markSaved() {
        this.savedSnapshot = this.snapshotForm();
        this.updateUnsavedNotice();
    }

    // 저장하지 않은 변경사항이 있으면 저장 막대에 경고 문구를 보여준다.
    updateUnsavedNotice() {
        const notice = document.getElementById('unsavedNotice');
        if (!notice) return;
        notice.hidden = this.savedSnapshot === null || this.snapshotForm() === this.savedSnapshot;
    }

    displaySettings() {
        // 체크박스 설정
        document.getElementById('enableTimestamp').checked = this.settings.enableTimestamp;
        document.getElementById('enableSyncPanel').checked = this.settings.enableSyncPanel;
        document.getElementById('enableRpPanel').checked = this.settings.enableRpPanel;
        document.getElementById('enableUpdateNotification').checked = this.settings.enableUpdateNotification;
        document.getElementById('soopRestoreInterval').value = this.clampRestoreSeconds(this.settings.soopRestoreInterval, 30);
        document.getElementById('soopExcludeEmoticonOnlyChat').checked = !!this.settings.soopExcludeEmoticonOnlyChat;
        document.getElementById('soopAutoRestoreChat').checked = !!this.settings.soopAutoRestoreChat;
        document.getElementById('soopAutoRestorePeriod').value = this.clampRestoreSeconds(this.settings.soopAutoRestorePeriod, 30);
        document.getElementById('soopLiveWatchLikeNotify').checked = this.settings.soopLiveWatchLikeNotify !== false;
        document.getElementById('soopLiveWatchCommentNotify').checked = !!this.settings.soopLiveWatchCommentNotify;
        document.getElementById('soopLiveWatchDisableAutoplay').checked = this.settings.soopLiveWatchDisableAutoplay !== false;
        document.getElementById('enableClipMap').checked = this.settings.enableClipMap !== false;
        document.getElementById('soopLiveWatchCommentToast').checked = this.settings.soopLiveWatchCommentToast !== false;
        document.getElementById('soopLiveWatchCommentText').value =
            typeof this.settings.soopLiveWatchCommentText === 'string' && this.settings.soopLiveWatchCommentText.trim()
                ? this.settings.soopLiveWatchCommentText
                : '잘 볼게요';
        this.setRadioValue(
            'soopLiveWatchCommentDedupMode',
            this.settings.soopLiveWatchCommentDedupMode === 'existing_comment' ? 'existing_comment' : 'cooldown'
        );
        this.setRadioValue(
            'soopLiveWatchCommentCooldownType',
            this.settings.soopLiveWatchCommentCooldownType === 'custom_hours' ? 'custom_hours' : 'video_duration'
        );
        this.setCooldownDurationFields(
            this.normalizeCooldownSeconds(
                this.settings.soopLiveWatchCommentCooldownSeconds,
                this.settings.soopLiveWatchCommentCooldownHours
            )
        );
        this.updateAutoRestoreOptionsState();
        this.updateLiveWatchNotifyOptionsState();
    }

    setRadioValue(name, value) {
        const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
        if (input) input.checked = true;
    }

    getRadioValue(name, fallback) {
        const checked = document.querySelector(`input[name="${name}"]:checked`);
        return checked ? checked.value : fallback;
    }

    // 임의 지정 대기 시간(초). 예전 시간 단위 값이 있으면 초로 변환한다.
    normalizeCooldownSeconds(secondsValue, legacyHoursValue) {
        const seconds = Number(secondsValue);
        if (Number.isFinite(seconds) && seconds > 0) {
            return Math.max(1, Math.floor(seconds));
        }
        const hours = Number(legacyHoursValue);
        if (Number.isFinite(hours) && hours > 0) {
            return Math.max(1, Math.round(hours * 3600));
        }
        return 3600;
    }

    // 시·분·초 입력칸 값을 모아 총 초로 만든다. (0 허용 — 저장 시 별도 검사)
    readCooldownSecondsFromFields() {
        const hours = Math.max(0, Math.floor(Number(document.getElementById('soopLiveWatchCommentCooldownHoursPart').value) || 0));
        const minutes = Math.max(0, Math.floor(Number(document.getElementById('soopLiveWatchCommentCooldownMinutesPart').value) || 0));
        const seconds = Math.max(0, Math.floor(Number(document.getElementById('soopLiveWatchCommentCooldownSecondsPart').value) || 0));
        return hours * 3600 + minutes * 60 + seconds;
    }

    // 총 초를 시·분·초 칸에 나눠 채운다. (양수일 때만 호출)
    setCooldownDurationFields(totalSeconds) {
        const normalized = this.normalizeCooldownSeconds(totalSeconds);
        const hours = Math.floor(normalized / 3600);
        const minutes = Math.floor((normalized % 3600) / 60);
        const seconds = normalized % 60;
        document.getElementById('soopLiveWatchCommentCooldownHoursPart').value = hours;
        document.getElementById('soopLiveWatchCommentCooldownMinutesPart').value = minutes;
        document.getElementById('soopLiveWatchCommentCooldownSecondsPart').value = seconds;
    }

    // 입력값을 정수로만 정리한다. 총합이 양수면 시·분·초로 다시 나눠 표시한다.
    normalizeCooldownFieldsOnEdit() {
        const hours = Math.max(0, Math.floor(Number(document.getElementById('soopLiveWatchCommentCooldownHoursPart').value) || 0));
        const minutes = Math.max(0, Math.floor(Number(document.getElementById('soopLiveWatchCommentCooldownMinutesPart').value) || 0));
        const seconds = Math.max(0, Math.floor(Number(document.getElementById('soopLiveWatchCommentCooldownSecondsPart').value) || 0));
        const total = hours * 3600 + minutes * 60 + seconds;
        if (total > 0) {
            this.setCooldownDurationFields(total);
            return;
        }
        document.getElementById('soopLiveWatchCommentCooldownHoursPart').value = hours;
        document.getElementById('soopLiveWatchCommentCooldownMinutesPart').value = minutes;
        document.getElementById('soopLiveWatchCommentCooldownSecondsPart').value = seconds;
    }

    // 임의 지정 시간이 선택된 상태에서 0초 이하면 저장을 막는다.
    validateLiveWatchCooldownBeforeSave() {
        const cooldownType = this.getRadioValue('soopLiveWatchCommentCooldownType', 'video_duration');
        if (cooldownType !== 'custom_hours') return true;
        if (this.readCooldownSecondsFromFields() > 0) return true;
        alert('임의 지정 시간은 1초 이상이어야 합니다.');
        return false;
    }

    trySaveSettings() {
        if (!this.validateLiveWatchCooldownBeforeSave()) return false;
        this.collectSettings();
        this.saveSettings();
        return true;
    }

    // 이전 채팅 복원 구간: 10~300초, 10초 단위
    clampRestoreSeconds(value, fallback = 30) {
        const parsed = parseInt(value, 10);
        if (Number.isNaN(parsed)) return fallback;
        const clamped = Math.min(300, Math.max(10, parsed));
        return Math.round(clamped / 10) * 10;
    }

    // 자동 복원이 꺼져 있으면 자동 복원 구간을 수정할 수 없게 한다.
    updateAutoRestoreOptionsState() {
        const enabled = document.getElementById('soopAutoRestoreChat').checked;
        const options = document.getElementById('soopAutoRestoreOptions');
        const periodInput = document.getElementById('soopAutoRestorePeriod');
        periodInput.disabled = !enabled;
        if (options) {
            options.classList.toggle('is-disabled', !enabled);
        }
    }

    // 댓글 등록 OFF면 문구·재등록 방지 하위 항목 비활성화. 안내 메시지는 UP·댓글 둘 다 OFF일 때만 비활성화.
    updateLiveWatchNotifyOptionsState() {
        const likeOn = document.getElementById('soopLiveWatchLikeNotify').checked;
        const commentOn = document.getElementById('soopLiveWatchCommentNotify').checked;
        const commentOptions = document.getElementById('soopLiveWatchCommentOptions');
        commentOptions?.classList.toggle('is-disabled', !commentOn);
        commentOptions?.querySelectorAll('input').forEach((input) => {
            input.disabled = !commentOn;
        });

        const toastInput = document.getElementById('soopLiveWatchCommentToast');
        if (toastInput) {
            toastInput.disabled = !likeOn && !commentOn;
        }

        if (commentOn) {
            this.updateLiveWatchDedupOptionsState();
        } else {
            document.getElementById('soopLiveWatchCooldownOptions')?.classList.add('is-disabled');
            document.getElementById('soopLiveWatchCustomHoursRow')?.classList.add('is-disabled');
        }
    }

    // 재등록 방지 방식에 따라 대기시간 하위 옵션 활성/비활성.
    updateLiveWatchDedupOptionsState() {
        if (!document.getElementById('soopLiveWatchCommentNotify').checked) return;

        const dedupMode = this.getRadioValue('soopLiveWatchCommentDedupMode', 'cooldown');
        const cooldownOptions = document.getElementById('soopLiveWatchCooldownOptions');
        const cooldownEnabled = dedupMode === 'cooldown';
        cooldownOptions?.classList.toggle('is-disabled', !cooldownEnabled);
        cooldownOptions?.querySelectorAll('input[type="radio"]').forEach((input) => {
            input.disabled = !cooldownEnabled;
        });

        const cooldownType = this.getRadioValue('soopLiveWatchCommentCooldownType', 'video_duration');
        const customEnabled = cooldownEnabled && cooldownType === 'custom_hours';
        [
            'soopLiveWatchCommentCooldownHoursPart',
            'soopLiveWatchCommentCooldownMinutesPart',
            'soopLiveWatchCommentCooldownSecondsPart',
        ].forEach((id) => {
            const input = document.getElementById(id);
            if (input) input.disabled = !customEnabled;
        });
        document.getElementById('soopLiveWatchCustomHoursRow')?.classList.toggle('is-disabled', !customEnabled);
    }

    displayVersion() {
        try {
            // Chrome 확장 프로그램의 버전 정보 가져오기
            const manifest = chrome.runtime.getManifest();
            const version = manifest.version;
            const versionElement = document.getElementById('versionInfo');
            if (versionElement) {
                versionElement.textContent = `버전 ${version}`;
            }
        } catch (error) {
            console.error('버전 정보 로드 실패:', error);
            const versionElement = document.getElementById('versionInfo');
            if (versionElement) {
                versionElement.textContent = '버전 정보를 불러올 수 없습니다.';
            }
        }
    }

    collectSettings() {
        this.settings.enableTimestamp = document.getElementById('enableTimestamp').checked;
        this.settings.enableSyncPanel = document.getElementById('enableSyncPanel').checked;
        this.settings.enableRpPanel = document.getElementById('enableRpPanel').checked;
        this.settings.enableUpdateNotification = document.getElementById('enableUpdateNotification').checked;
        this.settings.soopRestoreInterval = this.clampRestoreSeconds(
            document.getElementById('soopRestoreInterval').value, 30
        );
        this.settings.soopExcludeEmoticonOnlyChat = document.getElementById('soopExcludeEmoticonOnlyChat').checked;
        this.settings.soopAutoRestoreChat = document.getElementById('soopAutoRestoreChat').checked;
        this.settings.soopAutoRestorePeriod = this.clampRestoreSeconds(
            document.getElementById('soopAutoRestorePeriod').value, 30
        );
        this.settings.soopLiveWatchLikeNotify = document.getElementById('soopLiveWatchLikeNotify').checked;
        this.settings.soopLiveWatchCommentNotify = document.getElementById('soopLiveWatchCommentNotify').checked;
        this.settings.soopLiveWatchDisableAutoplay = document.getElementById('soopLiveWatchDisableAutoplay').checked;
        this.settings.enableClipMap = document.getElementById('enableClipMap').checked;
        this.settings.soopLiveWatchCommentToast = document.getElementById('soopLiveWatchCommentToast').checked;
        const commentText = document.getElementById('soopLiveWatchCommentText').value.trim();
        this.settings.soopLiveWatchCommentText = commentText || '잘 볼게요';
        this.settings.soopLiveWatchCommentDedupMode =
            this.getRadioValue('soopLiveWatchCommentDedupMode', 'cooldown') === 'existing_comment'
                ? 'existing_comment'
                : 'cooldown';
        this.settings.soopLiveWatchCommentCooldownType =
            this.getRadioValue('soopLiveWatchCommentCooldownType', 'video_duration') === 'custom_hours'
                ? 'custom_hours'
                : 'video_duration';
        this.settings.soopLiveWatchCommentCooldownSeconds = this.readCooldownSecondsFromFields();
    }

    setupEventListeners() {
        document.getElementById('soopAutoRestoreChat').addEventListener('change', () => {
            this.updateAutoRestoreOptionsState();
        });
        document.getElementById('soopLiveWatchLikeNotify').addEventListener('change', () => {
            this.updateLiveWatchNotifyOptionsState();
        });
        document.getElementById('soopLiveWatchCommentNotify').addEventListener('change', () => {
            this.updateLiveWatchNotifyOptionsState();
        });
        document.querySelectorAll('input[name="soopLiveWatchCommentDedupMode"]').forEach((input) => {
            input.addEventListener('change', () => this.updateLiveWatchDedupOptionsState());
        });
        document.querySelectorAll('input[name="soopLiveWatchCommentCooldownType"]').forEach((input) => {
            input.addEventListener('change', () => this.updateLiveWatchDedupOptionsState());
        });
        [
            'soopLiveWatchCommentCooldownHoursPart',
            'soopLiveWatchCommentCooldownMinutesPart',
            'soopLiveWatchCommentCooldownSecondsPart',
        ].forEach((id) => {
            document.getElementById(id).addEventListener('change', () => {
                this.normalizeCooldownFieldsOnEdit();
            });
        });
        // 저장 전 입력값이 범위 밖으로 남지 않도록 표시도 맞춰 둔다.
        ['soopRestoreInterval', 'soopAutoRestorePeriod'].forEach((id) => {
            document.getElementById(id).addEventListener('change', (e) => {
                e.target.value = this.clampRestoreSeconds(e.target.value, 30);
            });
        });

        // 입력칸이 바뀔 때마다 저장하지 않은 변경사항이 있는지 확인한다.
        const generalTab = document.getElementById('general');
        ['input', 'change'].forEach((type) => {
            generalTab.addEventListener(type, () => this.updateUnsavedNotice());
        });

        // 저장 버튼
        document.getElementById('saveSettings').addEventListener('click', () => {
            this.trySaveSettings();
        });

        // 설정 내보내기
        document.getElementById('exportSettings').addEventListener('click', () => {
            this.exportSettings();
        });

        // 설정 가져오기
        document.getElementById('importSettings').addEventListener('click', () => {
            this.importSettings();
        });

        // 설정 초기화
        document.getElementById('resetSettings').addEventListener('click', () => {
            if (confirm('모든 설정을 초기화하시겠습니까?')) {
                this.resetSettings();
            }
        });

        // 문의하기 링크
        document.getElementById('inquiryLink').addEventListener('click', showInquiryAlert);

        // 데이터 관리 섹션 접기/펼치기
        const dataManagementHeader = document.querySelector('.collapsible-header');
        const dataManagementContent = document.getElementById('dataManagementContent');
        const dataManagementToggle = document.getElementById('dataManagementToggle');
        
        dataManagementHeader.addEventListener('click', () => {
            const isHidden = dataManagementContent.style.display === 'none';
            dataManagementContent.style.display = isHidden ? 'block' : 'none';
            dataManagementToggle.textContent = isHidden ? '▲' : '▼';
        });

        // Storage 초기화 버튼
        document.getElementById('clearStorage').addEventListener('click', () => {
            this.clearAllStorage();
        });

        // Storage 정보 보기 버튼
        document.getElementById('showStorageInfo').style.display = 'none'; // 디버깅용이므로 비활성화
        document.getElementById('showStorageInfo').addEventListener('click', () => {
            this.showStorageInfo();
        });

        // Enter 키로 저장
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.trySaveSettings();
            }
        });
    }

    exportSettings() {
        const dataStr = JSON.stringify(this.settings, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = 'vod-master-settings.json';
        link.click();
        
        URL.revokeObjectURL(url);
        this.showStatus('설정이 내보내졌습니다.', 'success');
    }

    importSettings() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const importedSettings = JSON.parse(e.target.result);
                        this.settings = { ...this.defaultSettings, ...importedSettings };
                        this.displaySettings();
                        this.saveSettings();
                        this.showStatus('설정이 가져와졌습니다.', 'success');
                    } catch (error) {
                        this.showStatus('설정 파일 형식이 올바르지 않습니다.', 'error');
                    }
                };
                reader.readAsText(file);
            }
        };
        
        input.click();
    }

    showStatus(message, type) {
        const statusElement = document.getElementById('status');
        statusElement.textContent = message;
        statusElement.className = `status ${type}`;
        statusElement.style.display = 'block';
        
        setTimeout(() => {
            statusElement.style.display = 'none';
        }, 3000);
    }

    // Storage 초기화 (디버깅용)
    async clearAllStorage() {
        if (!confirm('모든 저장된 데이터를 삭제하시겠습니까?\n\n삭제될 데이터:\n• 확장 프로그램 설정\n• 업데이트 확인 정보\n이 작업은 되돌릴 수 없습니다.')) {
            return;
        }

        try {
            // Chrome Storage API로 모든 데이터 삭제
            await chrome.storage.sync.clear();
            await chrome.storage.local.clear();
            this.showStatus('모든 저장된 데이터가 삭제되었습니다.', 'success');
            this.log('Storage 초기화 완료 - 모든 데이터 삭제됨');
        } catch (error) {
            console.error('Storage 초기화 실패:', error);
            this.showStatus('Storage 초기화에 실패했습니다.', 'error');
        }
    }

    // Storage 정보 보기 (디버깅용)
    async showStorageInfo() {
        try {
            const MAX_DISPLAY_LEN = 200;
            const syncData = await chrome.storage.sync.get(null);
            const localData = await chrome.storage.local.get(null);
            
            const syncKeys = Object.keys(syncData);
            const localKeys = Object.keys(localData);
            
            let message = `📊 Storage 정보\n\n`;
            message += `🔄 Sync Storage (${syncKeys.length}개 항목):\n`;
            if (syncKeys.length > 0) {
                syncKeys.forEach(key => {
                    const value = syncData[key];
                    const valueStr = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
                    message += `  • ${key}: ${valueStr.substring(0, MAX_DISPLAY_LEN)}${valueStr.length > MAX_DISPLAY_LEN ? '...' : ''}\n`;
                });
            } else {
                message += `  (비어있음)\n`;
            }
            
            message += `\n💾 Local Storage (${localKeys.length}개 항목):\n`;
            if (localKeys.length > 0) {
                localKeys.forEach(key => {
                    const value = localData[key];
                    const valueStr = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
                    message += `  • ${key}: ${valueStr.substring(0, MAX_DISPLAY_LEN)}${valueStr.length > MAX_DISPLAY_LEN ? '...' : ''}\n`;
                });
            } else {
                message += `  (비어있음)\n`;
            }
            
            // 콘솔에도 상세 정보 출력
            this.log('=== Storage 정보 ===');
            this.log('Sync Storage:', syncData);
            this.log('Local Storage:', localData);
            
            alert(message);
            
        } catch (error) {
            console.error('Storage 정보 조회 실패:', error);
            this.showStatus('Storage 정보를 가져올 수 없습니다.', 'error');
        }
    }
}

// 설정 창이 로드되면 초기화
document.addEventListener('DOMContentLoaded', () => {
    new settingPageManager();
    
    // 탭 기능 설정
    function setupTabs() {
        const tabs = document.querySelectorAll('.tab');
        const tabContents = document.querySelectorAll('.tab-content');
        const container = document.querySelector('.container');

        const applyTabLayout = (targetTab) => {
            // 로그 탭은 가로 폭을 최대로 쓰고, 일반 설정은 좁은 카드로 되돌린다.
            container?.classList.toggle('wide-layout', targetTab === 'logs');
        };

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetTab = tab.getAttribute('data-tab');

                tabs.forEach(t => t.classList.remove('active'));
                tabContents.forEach(content => content.classList.remove('active'));

                tab.classList.add('active');
                document.getElementById(targetTab).classList.add('active');
                applyTabLayout(targetTab);
            });
        });

        const activeTab = document.querySelector('.tab.active')?.getAttribute('data-tab') || 'general';
        applyTabLayout(activeTab);
    }
    
    // 로그 기능 설정
    function setupLogs() {
        const logContainer = document.getElementById('logContainer');
        const clearLogsBtn = document.getElementById('clearLogs');
        const refreshLogsBtn = document.getElementById('refreshLogs');
        
        // 체크박스 필터들
        const filterDebug = document.getElementById('filterDebug');
        filterDebug.checked = false;
        const filterInfo = document.getElementById('filterInfo');
        const filterLog = document.getElementById('filterLog');
        const filterWarn = document.getElementById('filterWarn');
        const filterError = document.getElementById('filterError');
        
        let lastLogCount = 0; // 마지막 로그 개수 추적
        let allLogs = []; // 모든 로그 저장
        
        // 로그가 새로 추가되었는지 추적
        let hasNewLogs = false;
        
        // 활성화된 필터 레벨들 가져오기
        function getActiveFilters() {
            const activeFilters = [];
            if (filterDebug.checked) activeFilters.push('debug');
            if (filterInfo.checked) activeFilters.push('info');
            if (filterLog.checked) activeFilters.push('log');
            if (filterWarn.checked) activeFilters.push('warn');
            if (filterError.checked) activeFilters.push('error');
            return activeFilters;
        }
        
        // 로그 새로고침
        async function refreshLogs() {
            chrome.runtime.sendMessage({action: 'getLogs'}, (response) => {
                try {
                    allLogs = response.logs || [];
                    const currentLogCount = allLogs.length;
                    
                    // 로그가 추가되었는지 확인
                    hasNewLogs = currentLogCount > lastLogCount;
                    
                    // 기존 로그 개수 업데이트
                    lastLogCount = currentLogCount;

                    // 필터 적용
                    const activeFilters = getActiveFilters();
                    const filteredLogs = allLogs.filter(log => activeFilters.includes(log.level));
                    
                    logContainer.innerHTML = '';
                    
                    if (filteredLogs.length === 0) {
                        if (allLogs.length === 0) {
                            logContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">로그가 없습니다.</div>';
                        } else {
                            logContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">선택된 레벨의 로그가 없습니다.</div>';
                        }
                        return;
                    }
                    
                    filteredLogs.forEach(log => {
                        const logElement = document.createElement('div');
                        logElement.style.padding = '8px 12px';
                        logElement.style.borderBottom = '1px solid #eee';
                        logElement.style.fontFamily = 'monospace';
                        logElement.style.fontSize = '12px';
                        logElement.style.whiteSpace = 'pre-wrap';
                        logElement.style.wordBreak = 'break-all';
                        
                        // 로그 레벨에 따른 색상
                        const levelColors = {
                            debug: '#6c757d',
                            info: '#007bff',
                            log: '#28a745',
                            warn: '#ffc107',
                            error: '#dc3545'
                        };
                        
                        logElement.style.color = levelColors[log.level] || '#000';
                        logElement.textContent = `[${log.level.toUpperCase()}] ${log.message}`;
                        
                        logContainer.appendChild(logElement);
                    });
                    
                    // 새 로그가 추가되었으면 항상 맨 아래로 스크롤
                    if (hasNewLogs) {
                        logContainer.scrollTop = logContainer.scrollHeight;
                    }
                } catch (error) {
                    logContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">로그를 가져올 수 없습니다.</div>';
                }
            });
        }
        
        // 로그 지우기
        clearLogsBtn.addEventListener('click', async () => {
            try {
                await chrome.runtime.sendMessage({ action: 'clearLogs'});
                refreshLogs();
            } catch (error) {
                console.error('로그 지우기 실패:', error);
            }
        });
        
        // 로그 새로고침
        refreshLogsBtn.addEventListener('click', refreshLogs);
        
        // 체크박스 필터 변경 이벤트
        filterDebug.addEventListener('change', refreshLogs);
        filterInfo.addEventListener('change', refreshLogs);
        filterLog.addEventListener('change', refreshLogs);
        filterWarn.addEventListener('change', refreshLogs);
        filterError.addEventListener('change', refreshLogs);
        
        // 초기 로그 로드
        refreshLogs();
        
        // 5초마다 자동 새로고침
        setInterval(refreshLogs, 5000);
    }
    
    setupTabs();
    setupLogs();
});

// 문의하기 기능
function showInquiryAlert(event) {
    event.preventDefault();
    if (confirm('카카오톡 1:1 오픈채팅입니다.\n버그 신고, 기능 요청, 사용법 문의 등 언제든지 편하게 문의해주세요!')) {
        window.open('https://open.kakao.com/o/sqBqEFSh');
    }
} 