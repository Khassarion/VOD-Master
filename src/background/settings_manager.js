// 설정 관리자
export class SettingsManager {
    constructor() {
        this.log('constructor');
        this.defaultSettings = {
            enableTimestamp: true,
            enableSyncPanel: true,
            enableRpPanel: false,
            enableUpdateNotification: true,
            soopRestoreInterval: 30,
            soopExcludeEmoticonOnlyChat: false,
            soopAutoRestoreChat: false,
            soopAutoRestorePeriod: 30,
            // 라이브 중 VOD 시청 알려주기: UP 하기 기본 ON, 댓글 등록 기본 OFF
            soopLiveWatchLikeNotify: true,
            soopLiveWatchCommentNotify: false,
            soopLiveWatchCommentText: '잘 볼게요',
            soopLiveWatchCommentToast: true,
            // 다음 영상 자동 재생을 계속 끔 (기본 ON)
            soopLiveWatchDisableAutoplay: true,
            // 클립 탐색기: 플레이어에 "클립 탐색기" 버튼 표시 (기본 ON, 버튼을 누르기 전에는 요청하지 않음)
            enableClipMap: true,
            // existing_comment | cooldown
            soopLiveWatchCommentDedupMode: 'cooldown',
            // video_duration | custom_hours (cooldown 모드일 때)
            soopLiveWatchCommentCooldownType: 'video_duration',
            // 임의 지정 대기 시간(초). 예전 soopLiveWatchCommentCooldownHours는 로드 시 초로 변환
            soopLiveWatchCommentCooldownSeconds: 3600,
        };
        this.settings = { ...this.defaultSettings };
        this.isLoaded = false;
        this.loadPromise = null;
        this.activatedTabs = new Set();
        /** @type {Set<number>} VOD 플레이어 탭(tabId). 전역 동기화 시 sender 제외하고 메시지 전달. */
        this.broadcastSyncTabIds = new Set();
        this.init();
    }

    log(...data){
        console.log(`[${this.constructor.name}] `, ...data);
    }

    // 임의 지정 대기 시간을 초 단위 정수로 맞춘다. 예전 시간(소수) 값이 있으면 초로 변환한다.
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

    async init() {
        this.loadPromise = this.loadSettings();
        await this.loadPromise;
    }

    /**
     * @description 설정 로드
     * @returns {Promise<boolean>} 설정 로드 성공 여부
     */
    async loadSettings() {
        try {
            const result = await chrome.storage.sync.get('vodSyncSettings');
            this.settings = { ...this.defaultSettings, ...result.vodSyncSettings };
            this.settings.soopLiveWatchCommentCooldownSeconds = this.normalizeCooldownSeconds(
                this.settings.soopLiveWatchCommentCooldownSeconds,
                this.settings.soopLiveWatchCommentCooldownHours
            );
            this.isLoaded = true;
            this.log('설정 로드 완료:', this.settings);
            return true;
        } catch (error) {
            console.error('[SettingsManager] 설정 로드 실패:', error);
            this.settings = { ...this.defaultSettings };
            this.isLoaded = true;
            return false;
        }
    }

    /**
     * @description 모든 설정 조회
     * @returns {Promise<Object>} 모든 설정 값
     */
    async getAllSettings() {
        this.log('getAllSettings');
        if (!this.isLoaded && this.loadPromise) {
            this.log('loadPromise');
            await this.loadPromise;
        }
        this.log('return settings:', { ...this.settings });
        return { ...this.settings };
    }

    /**
     * @description 설정 조회
     * @param {string} key 설정 키
     * @returns {Promise<any>} 설정 값
     */
    async getSetting(key) {
        // 설정이 로드되지 않았다면 로드 완료까지 기다림
        if (!this.isLoaded && this.loadPromise) {
            await this.loadPromise;
        }
        return this.settings[key];
    }

    /**
     * @description 기능 활성화 여부 조회
     * @param {string} feature 기능 키
     * @returns {boolean} 기능 활성화 여부
     */
    isFeatureEnabled(feature) {
        return this.getSetting(feature);
    }

    /**
     * @description 설정 저장
     * @param {Object} newSettings 새로운 설정 값
     * @returns {Promise<boolean>} 설정 저장 성공 여부
     */
    async saveSettings(newSettings) {
        try {
            const oldSettings = { ...this.settings };
            // 기존 설정을 유지하면서 파라미터로 받은 설정만 업데이트
            this.settings = { ...this.settings, ...newSettings };
            this.settings.soopLiveWatchCommentCooldownSeconds = this.normalizeCooldownSeconds(
                this.settings.soopLiveWatchCommentCooldownSeconds,
                this.settings.soopLiveWatchCommentCooldownHours
            );
            await chrome.storage.sync.set({ vodSyncSettings: this.settings });
            this.log('설정 저장 완료:', this.settings);
            
            // 설정이 실제로 변경되었는지 확인하고 콜백 호출
            this.checkAndNotifyChanges(oldSettings, this.settings);
            
            return true;
        } catch (error) {
            console.error('[SettingsManager] 설정 저장 실패:', error);
            return false;
        }
    }

    /**
     * @description 설정 초기화
     * @returns {Promise<boolean>} 설정 초기화 성공 여부
     */
    async resetSettings() {
        try {
            const oldSettings = { ...this.settings };
            this.settings = { ...this.defaultSettings };
            await chrome.storage.sync.set({ vodSyncSettings: this.settings });
            this.log('설정 초기화 완료:', this.settings);
            
            // 설정이 실제로 변경되었는지 확인하고 콜백 호출
            this.checkAndNotifyChanges(oldSettings, this.settings);
            return true;
        } catch (error) {
            console.error('[SettingsManager] 설정 초기화 실패:', error);
            return false;
        }
    }

    // 설정이 실제로 변경되었는지 확인하고 콜백 호출
    /**
     * @description 설정 변경 감지 및 콜백 호출
     * @param {Object} oldSettings 이전 설정 값
     * @param {Object} newSettings 새로운 설정 값
     * @returns {boolean} 설정 변경 여부
     */
    checkAndNotifyChanges(oldSettings, newSettings) {
        const hasChanged = JSON.stringify(oldSettings) !== JSON.stringify(newSettings);
        if (hasChanged) {
            this.log('설정 변경 감지:', newSettings);
            this.notifyChangeCallbacks();
        }
        return hasChanged;
    }

    // 설정 변경 콜백 등록
    /**
     * @description 설정 변경 콜백 등록
     * @param {Function} callback 콜백 함수
     */
    addChangeCallback(tabId) {
        this.activatedTabs.add(tabId);
        this.log('설정 변경 콜백 등록됨', this.activatedTabs);
    }

    // 설정 변경 콜백 해제
    /**
     * @description 설정 변경 콜백 해제
     * @param {Function} callback 콜백 함수
     */
    removeChangeCallback(tabId) {
        if (this.activatedTabs.has(tabId)) {
            this.activatedTabs.delete(tabId);
            this.log('설정 변경 콜백 해제됨', this.activatedTabs);
        }
    }

    registerBroadcastSyncTab(tabId) {
        if (tabId == null) return;
        this.broadcastSyncTabIds.add(tabId);
        this.log('전역 동기화 대상 탭 등록', tabId, this.broadcastSyncTabIds);
    }

    unregisterBroadcastSyncTab(tabId) {
        if (this.broadcastSyncTabIds.delete(tabId)) {
            this.log('전역 동기화 대상 탭 해제', tabId, this.broadcastSyncTabIds);
        }
    }

    sendBroadcastSyncToRegistered(excludeTabId, requestVodTs) {
        this.broadcastSyncTabIds.forEach((tabId) => {
            if (tabId === excludeTabId) return;
            chrome.tabs.sendMessage(tabId, {
                action: 'broadCastSync',
                request_vod_ts: requestVodTs
            }, () => {
                void chrome.runtime.lastError;
            });
        });
    }

    // 등록된 모든 콜백에 설정 변경 알림
    /**
     * @description 등록된 모든 콜백에 설정 변경 알림
     */
    notifyChangeCallbacks() {
        this.activatedTabs.forEach(tabId => {
            console.log('notifyChangeCallbacks to tab:', tabId);
            chrome.tabs.sendMessage(tabId, {
                action:'notifyChangeCallbacks', 
                settings: {...this.settings}
            });
        });
    }
}
